import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReminderDispatcher } from "../../app/domain/reminders/dispatcher";
import { planReminders } from "../../app/domain/reminders/planner";
import { createScheduledReminderDispatcher } from "../../app/domain/reminders/scheduled";
import type { TextbeltSmsInput } from "../../app/domain/reminders/textbelt";
import {
  getHouseholdList,
  type ReadModelContext,
} from "../../app/domain/read-models";
import { createCloudflareRuntimeContext } from "../../app/runtime/context";
import { validTestEnvironment } from "../../app/runtime/test-fixtures";

function d1(): D1Database {
  if (env.DB === undefined)
    throw new Error("Workerd D1 test binding is missing");
  return env.DB;
}

beforeEach(async () => {
  const database = d1();
  const existing = await database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY rowid DESC`,
    )
    .all<{ name: string }>();
  if (existing.results.length > 0) {
    await database.exec("PRAGMA foreign_keys = OFF");
    await database.batch(
      existing.results.map(({ name }) =>
        database.prepare(`DROP TABLE "${name.replaceAll('"', '""')}"`),
      ),
    );
    await database.exec("PRAGMA foreign_keys = ON");
  }
  await applyD1Migrations(database, env.TEST_MIGRATIONS);
});

async function seed(): Promise<void> {
  await d1().exec(`
    INSERT INTO households (id,name,time_zone,week_start,created_at) VALUES ('h','Home','UTC',1,'2026-01-01T00:00:00Z');
    INSERT INTO members (id,household_id,display_name,active,created_at,sms_phone_e164,sms_consent_status,sms_suppression_status,sms_contact_updated_at) VALUES ('m1','h','One',1,'2026-01-01T00:00:00Z','+15555550101','consented','not_suppressed','2026-01-01T00:00:00Z');
    INSERT INTO chores (id,household_id,name,active,created_at,instructions,ownership_start_weekday) VALUES ('c1','h','Dishwasher',1,'2026-01-01T00:00:00Z','Reset it.',1);
    INSERT INTO weekly_assignments (id,household_id,local_week_start,chore_id,member_id,version,source,actor_member_id,request_id,operation_id,operation_kind,occurred_at) VALUES ('a1','h','2026-03-09','c1','m1',1,'rotation',NULL,'request-a1','operation-a1','materialize','2026-01-01T00:00:00Z');
  `);
}

async function seedCadence(): Promise<void> {
  await seed();
  await d1().batch([
    d1().prepare(
      `INSERT INTO members
       (id,household_id,display_name,active,created_at,sms_phone_e164,
        sms_consent_status,sms_suppression_status,sms_contact_updated_at)
       VALUES ('m2','h','Two',1,'2026-01-01T00:00:00Z','+15555550102',
               'consented','not_suppressed','2026-01-01T00:00:00Z')`,
    ),
    d1().prepare(
      `INSERT INTO chores
       (id,household_id,name,active,created_at,instructions,ownership_start_weekday)
       VALUES ('trash','h','Trash',1,'2026-01-01T00:00:00Z','Take it out.',5)`,
    ),
    d1().prepare(
      `INSERT INTO weekly_assignments
       (id,household_id,local_week_start,chore_id,member_id,version,source,
        actor_member_id,request_id,operation_id,operation_kind,occurred_at)
       VALUES ('bins','h','2026-03-13','trash','m2',1,'rotation',NULL,
               'request-bins','operation-bins','materialize','2026-01-01T00:00:00Z')`,
    ),
  ]);
}

function runtime() {
  return createCloudflareRuntimeContext(
    validTestEnvironment({ DB: d1() }),
    {} as ExecutionContext,
  );
}

function readContext(): ReadModelContext {
  return {
    database: d1(),
    authorizer: {
      async requireAuthorizedMember() {
        return { id: "m1", householdId: "h", displayName: "One" };
      },
    },
  };
}

const dispatchInput = {
  now: new Date("2026-03-08T20:01:00.000Z"),
  leaseOwner: "cron-old",
  batchSize: 1,
  leaseMilliseconds: 30_000,
  providerTimeoutMilliseconds: 10_000,
};

describe("SMS reminder reliability on workerd D1", () => {
  it("runs the Cron cadence once on local Sunday, Monday, Thursday, and Friday and projects only redacted evidence", async () => {
    await seedCadence();
    let clock = new Date("2026-03-08T20:01:00.000Z");
    let textId = 8000;
    const send = vi.fn(async (_input: TextbeltSmsInput) => ({
      success: true as const,
      textId: ++textId,
      quotaRemaining: 0,
    }));
    const scheduled = createScheduledReminderDispatcher({
      now: () => clock,
      randomId: () => `at-${clock.toISOString()}`,
      createTransport: () => ({ send }),
    });
    const cronInstants = [
      ["2026-03-08T20:01:00.000Z", 1],
      ["2026-03-09T08:01:00.000Z", 2],
      ["2026-03-10T20:01:00.000Z", 2],
      ["2026-03-11T20:01:00.000Z", 2],
      ["2026-03-12T20:01:00.000Z", 3],
      ["2026-03-13T08:01:00.000Z", 4],
      ["2026-03-14T20:01:00.000Z", 4],
    ] as const;

    for (const [instant, expectedSendCount] of cronInstants) {
      clock = new Date(instant);
      const controller = {
        scheduledTime: clock.valueOf(),
      } as ScheduledController;
      await scheduled(controller, runtime());
      await scheduled(controller, runtime());
      expect(send).toHaveBeenCalledTimes(expectedSendCount);
    }

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      {
        phone: "+15555550101",
        message:
          "ChoRotate evening reminder: Dishwasher, Mar 9 to Mar 15, 2026 inclusive. Reply STOP to opt out.",
      },
      {
        phone: "+15555550101",
        message:
          "ChoRotate morning reminder: Dishwasher, Mar 9 to Mar 15, 2026 inclusive. Reply STOP to opt out.",
      },
      {
        phone: "+15555550102",
        message:
          "ChoRotate evening reminder: Trash, Mar 13 to Mar 19, 2026 inclusive. Reply STOP to opt out.",
      },
      {
        phone: "+15555550102",
        message:
          "ChoRotate morning reminder: Trash, Mar 13 to Mar 19, 2026 inclusive. Reply STOP to opt out.",
      },
    ]);
    const outbox = await d1()
      .prepare(
        `SELECT status,textbelt_quota_remaining,correction_needed
         FROM reminder_outbox ORDER BY available_at`,
      )
      .all();
    expect(outbox.results).toEqual(
      Array.from({ length: 4 }, () => ({
        status: "accepted",
        textbelt_quota_remaining: 0,
        correction_needed: 0,
      })),
    );
    const projected = await getHouseholdList(readContext(), {
      request: new Request("https://app.example.test/?view=household"),
      fromDate: "2026-03-09",
      toDate: "2026-03-13",
    });
    expect(projected.items).toHaveLength(2);
    expect(
      projected.items.flatMap(({ reminder }) => reminder.occurrences),
    ).toHaveLength(4);
    expect(JSON.stringify(projected)).not.toMatch(
      /\+1555|textbelt|quota|text.?id/i,
    );
    const evidenceColumns = await d1()
      .prepare("PRAGMA table_info(reminder_delivery_attempts)")
      .all<{ name: string }>();
    expect(evidenceColumns.results.map(({ name }) => name)).not.toContain(
      "phone",
    );
    expect(JSON.stringify(outbox.results)).not.toContain("+1555");
  });

  it.each([
    ["missing_contact", null, "consented", "not_suppressed", "missing_contact"],
    [
      "contact_unconsented",
      "+15555550101",
      "revoked",
      "not_suppressed",
      "unconsented",
    ],
    [
      "contact_suppressed",
      "+15555550101",
      "consented",
      "suppressed",
      "suppressed",
    ],
  ] as const)(
    "records sanitized %s evidence without contacting the provider",
    async (category, phone, consent, suppression, projectedStatus) => {
      await seed();
      await d1()
        .prepare(
          `UPDATE members SET sms_phone_e164=?,sms_consent_status=?,
                              sms_suppression_status=? WHERE id='m1'`,
        )
        .bind(phone, consent, suppression)
        .run();
      const send = vi.fn();
      const scheduled = createScheduledReminderDispatcher({
        now: () => dispatchInput.now,
        randomId: () => "blocked-contact",
        createTransport: () => ({ send }),
      });

      await scheduled({ scheduledTime: 1 } as ScheduledController, runtime());

      expect(send).not.toHaveBeenCalled();
      const evidence = await d1()
        .prepare(
          `SELECT status,sanitized_error_category FROM reminder_outbox
           ORDER BY occurrence_phase`,
        )
        .all();
      expect(evidence.results).toEqual([
        { status: "failed", sanitized_error_category: category },
        { status: "failed", sanitized_error_category: category },
      ]);
      const projected = await getHouseholdList(readContext(), {
        request: new Request("https://app.example.test/"),
        fromDate: "2026-03-09",
        toDate: "2026-03-09",
      });
      expect(projected.items[0]?.reminder.contactStatus).toBe(projectedStatus);
      expect(JSON.stringify(projected)).not.toMatch(/\+1555|textbelt|quota/i);
    },
  );

  it.each(["malformed provider response", "provider timeout"])(
    "makes a %s terminally ambiguous with no duplicate or next-day catch-up",
    async (privateDetail) => {
      await seed();
      let clock = dispatchInput.now;
      const send = vi.fn(async () => {
        throw new Error(`${privateDetail}: +15555550101 private body`);
      });
      const scheduled = createScheduledReminderDispatcher({
        now: () => clock,
        randomId: () => "ambiguous",
        createTransport: () => ({ send }),
      });

      await scheduled({ scheduledTime: 1 } as ScheduledController, runtime());
      await scheduled({ scheduledTime: 1 } as ScheduledController, runtime());
      clock = new Date("2026-03-10T08:01:00.000Z");
      await scheduled({ scheduledTime: 2 } as ScheduledController, runtime());

      expect(send).toHaveBeenCalledOnce();
      const evidence = await d1()
        .prepare(
          `SELECT occurrence_phase,status,attempt_count,sanitized_error_category
           FROM reminder_outbox ORDER BY occurrence_phase`,
        )
        .all();
      expect(evidence.results).toEqual([
        {
          occurrence_phase: "evening",
          status: "delivery_unknown",
          attempt_count: 1,
          sanitized_error_category: "ambiguous_transport_result",
        },
        {
          occurrence_phase: "morning",
          status: "failed",
          attempt_count: 0,
          sanitized_error_category: "missed_occurrence",
        },
      ]);
      expect(JSON.stringify(evidence.results)).not.toMatch(
        /\+1555|private body/,
      );
    },
  );

  it("surfaces post-send correction evidence and sends only the next regular occurrence to the current assignee", async () => {
    await seedCadence();
    let clock = new Date("2026-03-08T20:01:00.000Z");
    let textId = 9000;
    const send = vi.fn(async (_input: TextbeltSmsInput) => ({
      success: true as const,
      textId: ++textId,
      quotaRemaining: 0,
    }));
    const scheduled = createScheduledReminderDispatcher({
      now: () => clock,
      randomId: () => `correction-${clock.toISOString()}`,
      createTransport: () => ({ send }),
    });
    await scheduled({ scheduledTime: 1 } as ScheduledController, runtime());
    await d1()
      .prepare(
        `UPDATE weekly_assignments
         SET member_id='m2',version=2,source='reassignment',actor_member_id='m1',
             request_id='post-send',operation_id='post-send-op',
             operation_kind='reassign',occurred_at='2026-03-08T20:30:00Z'
         WHERE id='a1'`,
      )
      .run();
    clock = new Date("2026-03-08T21:00:00.000Z");

    await scheduled({ scheduledTime: 2 } as ScheduledController, runtime());

    expect(send).toHaveBeenCalledOnce();
    const afterChange = await getHouseholdList(readContext(), {
      request: new Request("https://app.example.test/"),
      fromDate: "2026-03-09",
      toDate: "2026-03-09",
    });
    expect(afterChange.items[0]?.member.id).toBe("m2");
    expect(afterChange.items[0]?.reminder).toMatchObject({
      correctionNeeded: true,
      occurrences: [{ phase: "morning", result: "pending" }],
    });
    const correctionRows = await d1()
      .prepare(
        `SELECT assignment_version,occurrence_phase,status,recipient_member_id,
                correction_needed
         FROM reminder_outbox WHERE assignment_id='a1'
         ORDER BY assignment_version,occurrence_phase`,
      )
      .all();
    expect(correctionRows.results).toEqual([
      {
        assignment_version: 1,
        occurrence_phase: "evening",
        status: "accepted",
        recipient_member_id: "m1",
        correction_needed: 1,
      },
      {
        assignment_version: 1,
        occurrence_phase: "morning",
        status: "failed",
        recipient_member_id: "m1",
        correction_needed: 0,
      },
      {
        assignment_version: 2,
        occurrence_phase: "morning",
        status: "pending",
        recipient_member_id: "m2",
        correction_needed: 0,
      },
    ]);

    clock = new Date("2026-03-09T08:01:00.000Z");
    await scheduled({ scheduledTime: 3 } as ScheduledController, runtime());

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      phone: "+15555550102",
      message: expect.stringContaining("morning reminder: Dishwasher"),
    });
  });

  it("persists immutable occurrence and accepted Textbelt quota evidence", async () => {
    await seed();
    await planReminders(d1(), { now: dispatchInput.now });
    const send = vi.fn(async () => ({
      success: true as const,
      textId: 7001,
      quotaRemaining: 0,
    }));

    await expect(
      createReminderDispatcher(d1(), { send }).dispatch(dispatchInput),
    ).resolves.toMatchObject({ accepted: 1 });
    await expect(
      d1()
        .prepare(
          `SELECT status,textbelt_text_id,textbelt_quota_remaining
           FROM reminder_outbox WHERE occurrence_phase='evening'`,
        )
        .first(),
    ).resolves.toEqual({
      status: "accepted",
      textbelt_text_id: "7001",
      textbelt_quota_remaining: 0,
    });
    await expect(
      d1()
        .prepare(
          `UPDATE reminder_delivery_attempts SET provider_status='changed'
           WHERE textbelt_text_id='7001'`,
        )
        .run(),
    ).rejects.toThrow(/immutable/);
    await createReminderDispatcher(d1(), { send }).dispatch({
      ...dispatchInput,
      leaseOwner: "duplicate-cron",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("makes an expired in-flight claim terminally unknown without a second send", async () => {
    await seed();
    await planReminders(d1(), { now: dispatchInput.now });
    await d1()
      .prepare(
        `UPDATE reminder_outbox
         SET status='leased',lease_owner='dead',lease_expires_at=?,attempt_count=1
         WHERE occurrence_phase='evening'`,
      )
      .bind("2026-03-08T20:00:00.000Z")
      .run();
    const send = vi.fn(async () => ({
      success: true as const,
      textId: 7002,
      quotaRemaining: 0,
    }));

    await createReminderDispatcher(d1(), { send }).dispatch(dispatchInput);

    expect(send).not.toHaveBeenCalled();
    await expect(
      d1()
        .prepare(
          `SELECT status,sanitized_error_category
           FROM reminder_outbox WHERE occurrence_phase='evening'`,
        )
        .first(),
    ).resolves.toEqual({
      status: "delivery_unknown",
      sanitized_error_category: "expired_in_flight_lease",
    });
  });

  it("reconciles a late accepted result after lease ownership turnover", async () => {
    await seed();
    await planReminders(d1(), { now: dispatchInput.now });
    let release!: () => void;
    let started!: () => void;
    const wasStarted = new Promise<void>((resolve) => (started = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const pending = createReminderDispatcher(d1(), {
      async send() {
        started();
        await blocked;
        return { success: true, textId: 7003, quotaRemaining: 0 };
      },
    }).dispatch(dispatchInput);
    await wasStarted;
    await d1()
      .prepare(
        `UPDATE reminder_outbox
         SET lease_owner='cron-new',lease_expires_at='2026-03-08T20:10:00.000Z',
             attempt_count=2
         WHERE status='leased'`,
      )
      .run();
    release();

    await expect(pending).resolves.toMatchObject({ accepted: 1 });
    await expect(
      d1()
        .prepare(
          `SELECT status,textbelt_text_id,lease_owner
           FROM reminder_outbox WHERE occurrence_phase='evening'`,
        )
        .first(),
    ).resolves.toEqual({
      status: "accepted",
      textbelt_text_id: "7003",
      lease_owner: null,
    });
  });
});
