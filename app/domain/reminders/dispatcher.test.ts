import { describe, expect, it, vi } from "vitest";

import {
  buildReminderSms,
  createReminderDispatcher,
  type DispatchInput,
} from "./dispatcher";
import { planReminders } from "./planner";
import type { TextbeltTransport } from "./textbelt";
import { insertAssignment, outboxRows, reminderDatabase } from "./test-support";

const now = new Date("2026-03-08T20:01:00.000Z");

function input(overrides: Partial<DispatchInput> = {}): DispatchInput {
  return {
    now,
    leaseOwner: "cron-a",
    batchSize: 1,
    leaseMilliseconds: 30_000,
    providerTimeoutMilliseconds: 10_000,
    ...overrides,
  };
}

async function dueDatabase() {
  const database = reminderDatabase("UTC");
  insertAssignment(database, "assigned", "2026-03-09", "m2");
  await planReminders(database, { now });
  return database;
}

function acceptedTransport(textId = 42, quotaRemaining = 0): TextbeltTransport {
  return {
    send: vi.fn(async () => ({
      success: true as const,
      textId,
      quotaRemaining,
    })),
  };
}

describe("SMS reminder content", () => {
  it("identifies ChoRotate, phase, chore, inclusive range, and opt-out", () => {
    const sms = buildReminderSms({
      phase: "morning",
      choreName: "Dishwasher",
      localPeriodStart: "2026-03-09",
    });

    expect(sms).toBe(
      "ChoRotate morning reminder: Dishwasher, Mar 9 to Mar 15, 2026 inclusive. Reply STOP to opt out.",
    );
  });
});

describe("reminder dispatcher", () => {
  it("accepts once and retains Textbelt receipt and quota evidence", async () => {
    const database = await dueDatabase();
    const transport = acceptedTransport(42, 0);

    await expect(
      createReminderDispatcher(database, transport).dispatch(input()),
    ).resolves.toEqual({
      claimed: 1,
      accepted: 1,
      failed: 0,
      deliveryUnknown: 0,
      ownershipLost: 0,
    });

    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledWith({
      phone: "+15555550102",
      message:
        "ChoRotate evening reminder: Dishwasher, Mar 9 to Mar 15, 2026 inclusive. Reply STOP to opt out.",
    });
    expect(outboxRows(database)[0]).toMatchObject({
      status: "accepted",
      textbelt_text_id: "42",
      textbelt_quota_remaining: 0,
      attempt_count: 1,
    });
    expect(
      database.database
        .prepare(
          `SELECT outcome,textbelt_text_id,textbelt_quota_remaining
           FROM reminder_delivery_attempts`,
        )
        .get(),
    ).toEqual({
      outcome: "accepted",
      textbelt_text_id: "42",
      textbelt_quota_remaining: 0,
    });

    await createReminderDispatcher(database, transport).dispatch(
      input({ leaseOwner: "duplicate-cron" }),
    );
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("persists the claimed attempt state before invoking Textbelt", async () => {
    const database = await dueDatabase();
    const send = vi.fn(async () => {
      expect(outboxRows(database)[0]).toMatchObject({
        status: "leased",
        lease_owner: "cron-a",
        attempt_count: 1,
      });
      return { success: true as const, textId: 43, quotaRemaining: 0 };
    });

    await createReminderDispatcher(database, { send }).dispatch(input());

    expect(send).toHaveBeenCalledOnce();
  });

  it("maps an explicit non-accepted response to terminal sanitized failure", async () => {
    const database = await dueDatabase();
    const transport: TextbeltTransport = {
      send: vi.fn(async () => ({
        success: false as const,
        quotaRemaining: 0,
        error: "Out of quota for +15555550102",
      })),
    };
    const dispatcher = createReminderDispatcher(database, transport);

    await expect(dispatcher.dispatch(input())).resolves.toMatchObject({
      failed: 1,
    });
    expect(outboxRows(database)[0]).toMatchObject({
      status: "failed",
      sanitized_error_category: "out_of_quota",
      textbelt_quota_remaining: 0,
    });
    await dispatcher.dispatch(
      input({
        now: new Date("2026-03-08T20:02:00.000Z"),
        leaseOwner: "cron-b",
      }),
    );
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it.each(["malformed response", "network timeout"])(
    "makes %s terminal delivery_unknown and never retries",
    async () => {
      const database = await dueDatabase();
      const transport: TextbeltTransport = {
        send: vi.fn(async () => {
          throw new Error("private provider detail +15555550102");
        }),
      };
      const dispatcher = createReminderDispatcher(database, transport);

      await expect(dispatcher.dispatch(input())).resolves.toMatchObject({
        deliveryUnknown: 1,
      });
      expect(outboxRows(database)[0]).toMatchObject({
        status: "delivery_unknown",
        sanitized_error_category: "ambiguous_transport_result",
      });
      await dispatcher.dispatch(
        input({
          now: new Date("2026-03-08T20:02:00.000Z"),
          leaseOwner: "later-cron",
        }),
      );
      expect(transport.send).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["missing_contact", { sms_phone_e164: null }],
    ["invalid_contact", { sms_phone_e164: "+0123" }],
    ["contact_unconsented", { sms_consent_status: "revoked" }],
    ["contact_suppressed", { sms_suppression_status: "suppressed" }],
  ])(
    "revalidates and blocks %s immediately before send",
    async (category, patch) => {
      const database = await dueDatabase();
      const transport = acceptedTransport();
      const assignments = Object.keys(patch)
        .map((column) => `${column} = ?`)
        .join(",");
      if (category === "invalid_contact") {
        database.database.exec("PRAGMA ignore_check_constraints = ON");
      }
      database.database
        .prepare(`UPDATE members SET ${assignments} WHERE id = 'm2'`)
        .run(...Object.values(patch));
      database.database.exec("PRAGMA ignore_check_constraints = OFF");

      await createReminderDispatcher(database, transport).dispatch(input());

      expect(transport.send).not.toHaveBeenCalled();
      expect(outboxRows(database)[0]).toMatchObject({
        status: "failed",
        sanitized_error_category: category,
      });
    },
  );

  it("rejects unsupported or multi-segment generated content before network", async () => {
    const database = await dueDatabase();
    database.database
      .prepare("UPDATE chores SET name = ? WHERE id = 'dishwasher'")
      .run(`Dishwasher ${"A".repeat(150)}`);
    const transport = acceptedTransport();

    await createReminderDispatcher(database, transport).dispatch(input());

    expect(transport.send).not.toHaveBeenCalled();
    expect(outboxRows(database)[0]).toMatchObject({
      status: "failed",
      sanitized_error_category: "invalid_sms_content",
    });
  });

  it("expires stale prior-local-date pending work instead of catching up", async () => {
    const database = await dueDatabase();
    database.database
      .prepare(
        `UPDATE reminder_outbox SET status='failed',terminal_at=?
         WHERE occurrence_phase='morning'`,
      )
      .run("2026-03-08T20:01:00.000Z");
    const transport = acceptedTransport();

    await createReminderDispatcher(database, transport).dispatch(
      input({ now: new Date("2026-03-09T20:01:00.000Z") }),
    );

    expect(transport.send).not.toHaveBeenCalled();
    expect(outboxRows(database)[0]).toMatchObject({
      status: "failed",
      sanitized_error_category: "missed_occurrence",
    });
  });

  it("turns an expired in-flight lease into delivery_unknown without another send", async () => {
    const database = await dueDatabase();
    database.database
      .prepare(
        `UPDATE reminder_outbox
         SET status='leased',lease_owner='dead',lease_expires_at=?,attempt_count=1`,
      )
      .run("2026-03-08T20:00:00.000Z");
    const transport = acceptedTransport();

    await createReminderDispatcher(database, transport).dispatch(input());

    expect(transport.send).not.toHaveBeenCalled();
    expect(outboxRows(database)[0]).toMatchObject({
      status: "delivery_unknown",
      sanitized_error_category: "expired_in_flight_lease",
    });
    expect(
      database.database
        .prepare("SELECT outcome FROM reminder_delivery_attempts")
        .get(),
    ).toEqual({ outcome: "delivery_unknown" });
  });

  it("fences late non-accepted completion after lease ownership changes", async () => {
    const database = await dueDatabase();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const transport: TextbeltTransport = {
      send: vi.fn(async () => {
        await blocked;
        return { success: false as const, error: "Rejected" };
      }),
    };
    const pending = createReminderDispatcher(database, transport).dispatch(
      input({ leaseOwner: "old" }),
    );
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce());
    database.database
      .prepare(
        `UPDATE reminder_outbox
         SET lease_owner='new',lease_expires_at='2026-03-08T20:10:00.000Z',attempt_count=2
         WHERE status='leased'`,
      )
      .run();
    release();

    await expect(pending).resolves.toMatchObject({ ownershipLost: 1 });
    expect(outboxRows(database)[0]).toMatchObject({
      status: "leased",
      lease_owner: "new",
      attempt_count: 2,
    });
  });

  it("rechecks lease ownership after contact gating and immediately before send", async () => {
    const database = await dueDatabase();
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql) => {
      const statement = originalPrepare(sql);
      if (sql.includes("SELECT member.sms_phone_e164")) {
        const originalAll = statement.all.bind(statement);
        vi.spyOn(statement, "all").mockImplementation(async () => {
          const result = await originalAll();
          database.database
            .prepare(
              `UPDATE reminder_outbox
               SET lease_owner='new',lease_expires_at='2026-03-08T20:10:00.000Z',
                   attempt_count=2
               WHERE status='leased'`,
            )
            .run();
          return result;
        });
      }
      return statement;
    });
    const transport = acceptedTransport();

    await expect(
      createReminderDispatcher(database, transport).dispatch(input()),
    ).resolves.toMatchObject({ ownershipLost: 1, accepted: 0 });
    expect(transport.send).not.toHaveBeenCalled();
  });
});
