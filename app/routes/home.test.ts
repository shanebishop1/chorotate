/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AuthorizationError, type AuthorizedMember } from "../auth/access";
import type { D1DatabaseLike, D1StatementLike } from "../domain/storage/d1";
import {
  MATERIALIZATION_HORIZON_PERIODS,
  prepareCurrentSchedule,
} from "../domain/rotation/prepare";
import type { RuntimeConfig } from "../runtime/environment";
import {
  householdUpcomingWindow,
  loadHomeData,
  shouldRevalidate,
} from "./home";
import { runHomeAction } from "./home-action";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const actor: AuthorizedMember = {
  id: "member-d",
  householdId: "chorotate",
  displayName: "Member D",
};
const now = new Date("2026-08-31T12:00:00Z");
const config = {
  canonicalOrigin: "https://app.example.test",
  applicationEnvironment: "test",
  localAuthEnabled: false,
  household: {
    timeZone: "UTC",
    weekStart: "monday",
    ownerEmail: "member-d@example.test",
    allowedEmails: ["member-d@example.test"],
  },
  reminders: {
    smsEnabled: true,
    batchSize: 25,
    leaseMilliseconds: 300_000,
    maxAttempts: 5,
    providerTimeoutMilliseconds: 10_000,
    retryBaseMilliseconds: 60_000,
    retryMaxMilliseconds: 900_000,
  },
  secrets: {
    betterAuthSecret: "x".repeat(32),
    googleClientId: "test",
    googleClientSecret: "test",
    textbeltApiKey: "test-only-textbelt-api-key",
  },
} satisfies RuntimeConfig;

describe("home view navigation", () => {
  it("uses explicit local boundaries for the current overlap and next month", () => {
    expect(householdUpcomingWindow("2026-08-31")).toEqual({
      fromDate: "2026-08-25",
      toDate: "2026-09-30",
    });
  });

  it("does not reload private schedule data for a view-only query change", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL("https://app.example.test/?view=now"),
        nextUrl: new URL("https://app.example.test/?view=history"),
        formMethod: undefined,
        defaultShouldRevalidate: true,
      } as Parameters<typeof shouldRevalidate>[0]),
    ).toBe(false);
  });

  it("does not reload private schedule data when the household range changes", () => {
    expect(
      shouldRevalidate({
        currentUrl: new URL(
          "https://app.example.test/?view=household&range=upcoming",
        ),
        nextUrl: new URL("https://app.example.test/?view=household&range=all"),
        formMethod: undefined,
        defaultShouldRevalidate: true,
      } as Parameters<typeof shouldRevalidate>[0]),
    ).toBe(false);
  });
});

class LocalStatement implements D1StatementLike {
  private values: SQLInputValue[] = [];
  constructor(
    private database: DatabaseSync,
    private sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }
  async run() {
    const statement = this.database.prepare(this.sql);
    const result = /\?\d+/.test(this.sql)
      ? statement.run(
          Object.fromEntries(
            this.values.map((value, index) => [String(index + 1), value]),
          ),
        )
      : statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async all<T>() {
    const statement = this.database.prepare(this.sql);
    return {
      results: (/\?\d+/.test(this.sql)
        ? statement.all(
            Object.fromEntries(
              this.values.map((value, index) => [String(index + 1), value]),
            ),
          )
        : statement.all(...this.values)) as T[],
    };
  }
}

function d1(database: DatabaseSync): D1DatabaseLike {
  return {
    prepare(sql) {
      return new LocalStatement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of [
    "migrations/0001_domain_schema.sql",
    "migrations/0002_assignment_audit_triggers.sql",
    "migrations/0003_chore_instructions.sql",
    "migrations/0004_better_auth.sql",
    "migrations/0005_reminder_reliability.sql",
    "migrations/0006_assignment_integrity.sql",
    "migrations/0007_sms_contact_period_outbox.sql",
    "seed/chorotate-local.template.sql",
  ])
    sqlite.exec(readFileSync(resolve(root, file), "utf8"));
  return { sqlite, database: d1(sqlite) as unknown as D1Database };
}

const loaderServices = {
  async authorize() {
    return actor;
  },
  now: () => now,
};
const actionServices = {
  ...loaderServices,
  async prepare() {},
};
function request(body: URLSearchParams, origin = config.canonicalOrigin) {
  if (!body.has("requestId")) body.set("requestId", "request:client-stable");
  return new Request(`${config.canonicalOrigin}/`, {
    method: "POST",
    headers: {
      origin,
      cookie: "session=test",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

describe("authenticated home route integration", () => {
  it("keeps GET read-only and materializes through an authenticated exact-origin action", async () => {
    const fixture = database();
    fixture.sqlite.exec(
      "DROP TRIGGER weekly_assignments_no_delete; DELETE FROM weekly_assignments",
    );
    const loaded = await loadHomeData(
      new Request(config.canonicalOrigin),
      fixture.database,
      config,
      loaderServices,
    );
    expect(loaded.state).toBe("ready");
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS count FROM weekly_assignments")
        .get(),
    ).toEqual({ count: 0 });

    const result = await runHomeAction(
      request(new URLSearchParams({ intent: "materialize" })),
      fixture.database,
      config,
      { ...actionServices, prepare: prepareCurrentSchedule },
    );
    expect(result).toEqual({ state: "success", intent: "materialize" });
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS count FROM weekly_assignments")
        .get(),
    ).toEqual({ count: 106 });
    expect(MATERIALIZATION_HORIZON_PERIODS).toBe(53);
  });

  it("materializes from configuration membership snapshots after deactivation", async () => {
    const fixture = database();
    fixture.sqlite.exec(
      "DROP TRIGGER weekly_assignments_no_delete; DELETE FROM weekly_assignments; UPDATE members SET active=0 WHERE id='member-b'",
    );

    await expect(
      runHomeAction(
        request(new URLSearchParams({ intent: "materialize" })),
        fixture.database,
        config,
        { ...actionServices, prepare: prepareCurrentSchedule },
      ),
    ).resolves.toEqual({ state: "success", intent: "materialize" });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT member_id FROM weekly_assignments WHERE local_period_start='2026-09-04' AND chore_id='trash'",
        )
        .get(),
    ).toEqual({ member_id: "member-b" });
  });

  it("loads consistent Now, Mine, Household, active members, and grouped History from D1", async () => {
    const fixture = database();
    const result = await loadHomeData(
      new Request(`${config.canonicalOrigin}/?view=household`),
      fixture.database,
      config,
      loaderServices,
    );
    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(result.view).toBe("household");
    expect(
      result.current.handoffs.map(({ chore }) => [
        chore.name,
        chore.instructions,
      ]),
    ).toEqual([
      ["Dishwasher", "Empty the completed dishwasher."],
      ["Trash", "Take the trash out and replace bags."],
    ]);
    expect(result.mine.items.map(({ chore }) => chore.name)).toContain(
      "Dishwasher",
    );
    expect(result.household.periods).toHaveLength(8);
    expect(result.householdList.items).toHaveLength(8);
    expect(result.activeMembers).toHaveLength(4);
    expect(
      result.history.operations.every(({ changes }) => changes.length >= 1),
    ).toBe(true);
  });

  it("loads the full household list once so range tabs switch without refetching", async () => {
    const fixture = database();
    await prepareCurrentSchedule(fixture.database, actor, { now });
    fixture.sqlite
      .prepare(
        `INSERT INTO weekly_assignments
         (id,household_id,local_week_start,chore_id,member_id,version,source,
          actor_member_id,request_id,operation_id,operation_kind,occurred_at)
         VALUES (?,?,?,?,?,1,'rotation',NULL,?,?, 'materialize',?)`,
      )
      .run(
        "assignment:chorotate:2026-08-14:trash",
        "chorotate",
        "2026-08-14",
        "trash",
        "member-a",
        "seed:past",
        "seed:past",
        "2026-08-14T00:00:00Z",
      );

    const upcoming = await loadHomeData(
      new Request(`${config.canonicalOrigin}/?view=household&range=upcoming`),
      fixture.database,
      config,
      loaderServices,
    );
    const allTime = await loadHomeData(
      new Request(`${config.canonicalOrigin}/?view=household&range=all`),
      fixture.database,
      config,
      loaderServices,
    );

    expect(
      upcoming.state === "ready" &&
        upcoming.householdList.items.some(
          ({ assignmentId }) =>
            assignmentId === "assignment:chorotate:2026-08-14:trash",
        ),
    ).toBe(true);
    expect(
      allTime.state === "ready" &&
        allTime.householdList.items.some(
          ({ assignmentId }) =>
            assignmentId === "assignment:chorotate:2026-08-14:trash",
        ),
    ).toBe(true);
    expect(upcoming.state === "ready" && upcoming.householdRange).toBe(
      "upcoming",
    );
    expect(allTime.state === "ready" && allTime.householdRange).toBe("all");
    if (upcoming.state !== "ready" || allTime.state !== "ready") return;
    expect(upcoming.householdList.items).toHaveLength(107);
    expect(upcoming.householdList.page.nextOffset).toBeNull();
    expect(
      upcoming.household.periods.every(
        ({ period }) =>
          period.localStartDate >= "2026-08-25" &&
          period.localStartDate <= "2026-09-30",
      ),
    ).toBe(true);
    expect(allTime.householdList.items).toHaveLength(107);
    expect(allTime.householdList.page.nextOffset).toBeNull();
    expect(allTime.assignmentCandidates).toHaveLength(106);
  });

  it("performs a direct reassignment with server IDs and exposes it once in grouped history", async () => {
    const fixture = database();
    const result = await runHomeAction(
      request(
        new URLSearchParams({
          intent: "reassign",
          assignmentId: "assignment:chorotate:2026-08-28:trash",
          recipientMemberId: "member-b",
          expectedVersion: "1",
        }),
      ),
      fixture.database,
      config,
      actionServices,
    );
    expect(result).toEqual({ state: "success", intent: "reassign" });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT member_id,version,request_id,operation_id FROM weekly_assignments WHERE id=?",
        )
        .get("assignment:chorotate:2026-08-28:trash"),
    ).toMatchObject({
      member_id: "member-b",
      version: 2,
      request_id: "request:client-stable",
      operation_id: "operation:client-stable",
    });
    const history = await loadHomeData(
      new Request(`${config.canonicalOrigin}/?view=history`),
      fixture.database,
      config,
      loaderServices,
    );
    expect(
      history.state === "ready" &&
        history.history.operations.filter(({ kind }) => kind === "reassign"),
    ).toHaveLength(1);
    expect(
      history.state === "ready" &&
        history.history.operations.find(({ kind }) => kind === "reassign")
          ?.changes[0]?.period.localStartDate,
    ).toBe("2026-08-28");
  });

  it("uses each staggered chore period at the Friday boundary", async () => {
    const fixture = database();
    const boundaryServices = {
      ...actionServices,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    };

    await expect(
      runHomeAction(
        request(
          new URLSearchParams({
            intent: "reassign",
            assignmentId: "assignment:chorotate:2026-08-28:trash",
            recipientMemberId: "member-b",
            expectedVersion: "1",
          }),
        ),
        fixture.database,
        config,
        boundaryServices,
      ),
    ).resolves.toMatchObject({ state: "validation" });
    await expect(
      runHomeAction(
        request(
          new URLSearchParams({
            intent: "reassign",
            assignmentId: "assignment:chorotate:2026-08-31:dishwasher",
            recipientMemberId: "member-b",
            expectedVersion: "1",
            requestId: "request:friday-dishwasher-current",
          }),
        ),
        fixture.database,
        config,
        boundaryServices,
      ),
    ).resolves.toEqual({ state: "success", intent: "reassign" });
  });

  it("swaps two assignments atomically and groups both audit legs", async () => {
    const fixture = database();
    const result = await runHomeAction(
      request(
        new URLSearchParams({
          intent: "swap",
          firstAssignmentId: "assignment:chorotate:2026-08-28:trash",
          firstExpectedVersion: "1",
          secondAssignmentId: "assignment:chorotate:2026-08-31:dishwasher",
          secondExpectedVersion: "1",
        }),
      ),
      fixture.database,
      config,
      actionServices,
    );
    expect(result).toEqual({ state: "success", intent: "swap" });
    expect(
      fixture.sqlite
        .prepare(
          `SELECT group_concat(member_id, ',') AS owners FROM weekly_assignments
           WHERE id IN ('assignment:chorotate:2026-08-28:trash',
                        'assignment:chorotate:2026-08-31:dishwasher')
           ORDER BY chore_id`,
        )
        .get(),
    ).toEqual({ owners: "member-c,member-a" });
    const operation = fixture.sqlite
      .prepare(
        "SELECT operation_id,count(*) AS legs FROM assignment_audit_events WHERE operation_kind='swap' GROUP BY operation_id",
      )
      .get() as { operation_id: string; legs: number };
    expect(operation.legs).toBe(2);
  });

  it("returns current values on a stale conflict without overwriting", async () => {
    const fixture = database();
    const body = new URLSearchParams({
      intent: "reassign",
      assignmentId: "assignment:chorotate:2026-08-28:trash",
      recipientMemberId: "member-b",
      expectedVersion: "1",
    });
    expect(
      (
        await runHomeAction(
          request(body),
          fixture.database,
          config,
          actionServices,
        )
      ).state,
    ).toBe("success");
    body.set("requestId", "request:separate-stale-attempt");
    const stale = await runHomeAction(
      request(body),
      fixture.database,
      config,
      actionServices,
    );
    expect(stale).toMatchObject({
      state: "conflict",
      current: [{ memberId: "member-b", version: 2 }],
    });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS count FROM assignment_audit_events WHERE operation_kind='reassign'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("replays a retry carrying the same client request ID as success", async () => {
    const fixture = database();
    const body = new URLSearchParams({
      intent: "reassign",
      assignmentId: "assignment:chorotate:2026-08-28:trash",
      recipientMemberId: "member-b",
      expectedVersion: "1",
      requestId: "request:retry-stable",
    });

    await expect(
      runHomeAction(request(body), fixture.database, config, actionServices),
    ).resolves.toEqual({ state: "success", intent: "reassign" });
    await expect(
      runHomeAction(request(body), fixture.database, config, actionServices),
    ).resolves.toEqual({ state: "success", intent: "reassign" });
    expect(
      fixture.sqlite
        .prepare(
          "SELECT count(*) AS count FROM assignment_audit_events WHERE request_id='request:retry-stable'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("denies authorization and non-exact origins without an auth bypass", async () => {
    const fixture = database();
    const denied = {
      ...actionServices,
      async authorize() {
        throw new AuthorizationError(403);
      },
    };
    const body = new URLSearchParams({
      intent: "reassign",
      assignmentId: "assignment:chorotate:2026-08-28:trash",
      recipientMemberId: "member-b",
      expectedVersion: "1",
    });
    expect(
      await runHomeAction(request(body), fixture.database, config, denied),
    ).toMatchObject({ state: "denial" });
    expect(
      await runHomeAction(
        request(body, "https://evil.example"),
        fixture.database,
        config,
        actionServices,
      ),
    ).toEqual({ state: "denial", message: "Request origin denied." });
    const loadDenied = await loadHomeData(
      new Request(config.canonicalOrigin),
      fixture.database,
      config,
      {
        ...loaderServices,
        async authorize() {
          throw new AuthorizationError(403);
        },
      },
    );
    expect(loadDenied).toEqual({
      state: "unauthorized",
      view: "now",
      localAuthAvailable: false,
    });

    const localConfig = {
      ...config,
      applicationEnvironment: "local" as const,
      canonicalOrigin: "http://localhost:5173",
      localAuthEnabled: true,
      reminders: { ...config.reminders, smsEnabled: false },
    };
    const localLoadDenied = await loadHomeData(
      new Request(localConfig.canonicalOrigin),
      fixture.database,
      localConfig,
      {
        ...loaderServices,
        async authorize() {
          throw new AuthorizationError(403);
        },
      },
    );
    expect(localLoadDenied).toEqual({
      state: "unauthorized",
      view: "now",
      localAuthAvailable: true,
    });
  });

  it("strictly rejects unknown, duplicate, and malformed form values", async () => {
    const fixture = database();
    const unknown = new URLSearchParams({
      intent: "reassign",
      assignmentId: "x",
      recipientMemberId: "member-b",
      expectedVersion: "1",
      admin: "true",
    });
    expect(
      (
        await runHomeAction(
          request(unknown),
          fixture.database,
          config,
          actionServices,
        )
      ).state,
    ).toBe("validation");
    const duplicate = new URLSearchParams({
      intent: "reassign",
      assignmentId: "x",
      recipientMemberId: "member-b",
      expectedVersion: "01",
    });
    duplicate.append("assignmentId", "other");
    expect(
      (
        await runHomeAction(
          request(duplicate),
          fixture.database,
          config,
          actionServices,
        )
      ).state,
    ).toBe("validation");
  });
});
