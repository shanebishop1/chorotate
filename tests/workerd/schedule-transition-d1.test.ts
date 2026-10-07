import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCurrentSchedule } from "../../app/domain/rotation/prepare";
import {
  getCurrentAndNext,
  getGroupedHistory,
  getHouseholdList,
} from "../../app/domain/read-models";
import { createAssignmentCommandService } from "../../app/domain/commands/assignment-commands";
import { planReminders } from "../../app/domain/reminders/planner";
import { createReminderDispatcher } from "../../app/domain/reminders/dispatcher";
import type { TextbeltSmsInput } from "../../app/domain/reminders/textbelt";

function db() {
  if (!env.DB) throw new Error("Missing D1");
  return env.DB;
}
const actor = {
  id: "member-a",
  householdId: "chorotate",
  displayName: "Member A",
};
const now = new Date("2026-10-07T16:00:00Z");
const context = () => ({
  database: db(),
  authorizer: {
    async requireAuthorizedMember() {
      return actor;
    },
  },
});
const request = new Request("https://example.com");
async function atomic(sql: string) {
  await db().batch(
    sql
      .split(";\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db().prepare(s)),
  );
}
beforeEach(async () => {
  const existing = await db()
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
    )
    .all<{ name: string }>();
  if (existing.results.length) {
    await db().exec("PRAGMA foreign_keys=OFF");
    await db().batch(
      existing.results.map((r) =>
        db().prepare(`DROP TABLE "${r.name.replaceAll('"', '""')}"`),
      ),
    );
    await db().exec("PRAGMA foreign_keys=ON");
  }
  await applyD1Migrations(db(), env.TEST_MIGRATIONS);
  await atomic(env.TEST_FOUR_MEMBER_BOOTSTRAP_SQL);
  await atomic(env.TEST_ADD_CHORES_SQL);
  await prepareCurrentSchedule(db(), actor, {
    now: new Date("2026-09-28T16:00:00Z"),
    horizonPeriods: 6,
  });
});

async function transition() {
  const offsets: { [key: string]: number } = {
    dishwasher: 2,
    trash: 1,
    wipe: 2,
    sweep: 3,
  };
  for (const chore of ["trash", "dishwasher", "wipe", "sweep"]) {
    await db()
      .prepare(
        "INSERT INTO rotation_configs (id,household_id,chore_id,effective_from,rotation_offset,created_at,ownership_start_weekday) VALUES (?,'chorotate',?,'2026-10-12',?,'2026-10-07T16:00:00Z',1)",
      )
      .bind(`monday-${chore}`, chore, offsets[chore])
      .run();
    await db()
      .prepare(
        "INSERT INTO rotation_config_members (household_id,rotation_config_id,member_id,position) SELECT household_id,?,member_id,position FROM rotation_config_members WHERE rotation_config_id=(SELECT id FROM rotation_configs WHERE chore_id=? AND effective_from<'2026-10-12' ORDER BY effective_from DESC LIMIT 1)",
      )
      .bind(`monday-${chore}`, chore)
      .run();
  }
  await db().prepare("UPDATE chores SET ownership_start_weekday=1").run();
  await db()
    .prepare("UPDATE households SET balanced_rotation_from='2026-10-12'")
    .run();
  await db()
    .prepare(
      "INSERT INTO assignment_schedule_retirements SELECT id,'2026-10-07T16:00:00Z','Monday transition' FROM weekly_assignments WHERE local_period_start>='2026-10-12' AND chore_id<>'dishwasher'",
    )
    .run();
  await db()
    .prepare(
      "UPDATE weekly_assignments SET member_id='member-a',version=version+1,source='reassignment',actor_member_id='member-a',request_id='bridge-wipe',operation_id='bridge-wipe',operation_kind='correct',occurred_at='2026-10-07T16:00:00Z' WHERE chore_id='wipe' AND local_period_start='2026-10-09'",
    )
    .run();
  await prepareCurrentSchedule(db(), actor, { now, horizonPeriods: 55 });
}

describe("safe synchronized Monday cutover", () => {
  it("preserves current/history, handles the three-day bridge, and gives every future week four distinct owners", async () => {
    const before = await getCurrentAndNext(context(), { request, now });
    await transition();
    const current = await getCurrentAndNext(context(), { request, now });
    expect(current.handoffs.map((h) => h.current?.member.id)).toEqual(
      before.handoffs.map((h) => h.current?.member.id),
    );
    expect(
      current.handoffs.find((h) => h.chore.id === "trash")?.nextPeriod,
    ).toMatchObject({
      localStartDate: "2026-10-09",
      localEndDateInclusive: "2026-10-11",
    });
    const bridge = await getCurrentAndNext(context(), {
      request,
      now: new Date("2026-10-09T16:00:00Z"),
    });
    expect(new Set(bridge.handoffs.map((h) => h.current?.member.id)).size).toBe(
      4,
    );
    for (const h of bridge.handoffs)
      expect(h.nextPeriod.localStartDate).toBe("2026-10-12");
    const monday = await getCurrentAndNext(context(), {
      request,
      now: new Date("2026-10-12T16:00:00Z"),
    });
    expect(
      monday.handoffs.every(
        (h) =>
          h.currentPeriod.localStartDate === "2026-10-12" &&
          h.chore.ownershipStartWeekday === 1,
      ),
    ).toBe(true);
    const list = await getHouseholdList(context(), {
      request,
      fromDate: "2026-10-12",
      toDate: "2026-11-02",
      limit: 100,
    });
    expect(list.items).toHaveLength(16);
    for (const week of [
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]) {
      expect(
        new Set(
          list.items
            .filter((a) => a.period.localStartDate === week)
            .map((a) => a.member.id),
        ).size,
      ).toBe(4);
    }
    for (const member of ["member-a", "member-b", "member-c", "member-d"]) {
      expect(
        new Set(
          list.items
            .filter((a) => a.member.id === member)
            .map((a) => a.chore.id),
        ).size,
      ).toBe(4);
    }
    const old = await getHouseholdList(context(), {
      request,
      fromDate: "2026-09-25",
      toDate: "2026-09-25",
      limit: 100,
    });
    expect(
      old.items.find((a) => a.chore.id === "trash")?.period
        .localEndDateInclusive,
    ).toBe("2026-10-01");
    await expect(
      getGroupedHistory(context(), { request, limit: 100 }),
    ).resolves.toMatchObject({ state: "ready" });
    await expect(
      db()
        .prepare("DELETE FROM weekly_assignments WHERE chore_id='trash'")
        .run(),
    ).rejects.toThrow();
  });

  it("blocks stacking and cross-week swaps but permits same-week swaps; shortened periods end on Monday", async () => {
    await transition();
    const service = createAssignmentCommandService(db());
    const commandContext = {
      actor,
      timeZone: "America/New_York",
      occurredAt: now.toISOString(),
    };
    const id = (chore: string, date = "2026-10-12") =>
      `assignment:chorotate:${date}:${chore}`;
    await expect(
      service.reassign(
        {
          assignmentId: id("dishwasher"),
          recipientMemberId: "member-b",
          expectedVersion: 1,
          requestId: "stack",
          operationId: "stack",
        },
        commandContext,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "recipient_ineligible" });
    await expect(
      service.swap(
        {
          first: { assignmentId: id("dishwasher"), expectedVersion: 1 },
          second: {
            assignmentId: id("trash", "2026-10-19"),
            expectedVersion: 1,
          },
          requestId: "cross",
          operationId: "cross",
        },
        commandContext,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "recipient_ineligible" });
    await expect(
      service.swap(
        {
          first: { assignmentId: id("dishwasher"), expectedVersion: 1 },
          second: { assignmentId: id("trash"), expectedVersion: 1 },
          requestId: "same-week",
          operationId: "same-week",
        },
        commandContext,
      ),
    ).resolves.toMatchObject({ status: "success" });
    await expect(
      service.reassign(
        {
          assignmentId: id("trash", "2026-10-09"),
          recipientMemberId: "member-b",
          expectedVersion: 1,
          requestId: "ended",
          operationId: "ended",
        },
        { ...commandContext, occurredAt: "2026-10-12T04:00:00.000Z" },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "past_assignment" });
    await expect(
      service.reassign(
        {
          assignmentId: id("trash", "2026-10-16"),
          recipientMemberId: "member-b",
          expectedVersion: 1,
          requestId: "retired",
          operationId: "retired",
        },
        commandContext,
      ),
    ).resolves.toEqual({ status: "rejected", reason: "assignment_not_found" });
  });

  it("cancels obsolete Friday SMS and sends the same four Monday reminders once", async () => {
    await planReminders(db(), { now });
    await transition();
    await planReminders(db(), { now });
    const obsolete = await db()
      .prepare(
        "SELECT status,sanitized_error_category FROM reminder_outbox WHERE local_period_start='2026-10-16' AND chore_id<>'dishwasher'",
      )
      .all();
    expect(obsolete.results).toHaveLength(3);
    for (const row of obsolete.results)
      expect(row).toEqual({
        status: "failed",
        sanitized_error_category: "schedule_changed",
      });
    let textId = 100;
    const send = vi.fn(async (_input: TextbeltSmsInput) => ({
      success: true as const,
      textId: textId++,
      quotaRemaining: 100,
    }));
    const dispatcher = createReminderDispatcher(db(), { send });
    const input = {
      now: new Date("2026-10-12T13:01:00Z"),
      leaseOwner: "cutover",
      batchSize: 25,
      leaseMilliseconds: 300000,
      providerTimeoutMilliseconds: 10000,
    };
    await dispatcher.dispatch(input);
    await dispatcher.dispatch({ ...input, leaseOwner: "duplicate" });
    expect(send).toHaveBeenCalledTimes(4);
    for (const [message] of send.mock.calls)
      expect(message.message).toMatch(/Oct 12 to Oct 18/);
  });
});
