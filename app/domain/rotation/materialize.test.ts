import { describe, expect, it } from "vitest";

import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";
import { materializeRollingHorizon } from "./materialize";
import type { ChoreRotation } from "./rotation";

interface StoredAssignment {
  id: string;
  householdId: string;
  period: string;
  choreId: string;
  memberId: string;
  source: string;
}

class AssignmentD1 implements D1DatabaseLike {
  readonly assignments = new Map<string, StoredAssignment>();
  readonly preparedSql: string[] = [];

  prepare(sql: string): D1StatementLike {
    this.preparedSql.push(sql);
    return {
      bind: (...values: unknown[]) => this.prepareBound(values),
      run: async () => ({}),
      all: async <T>() => ({ results: [] as T[] }),
    };
  }

  async batch(statements: D1StatementLike[]): Promise<unknown> {
    for (const statement of statements) await statement.run();
    return [];
  }

  private prepareBound(values: unknown[]): D1StatementLike {
    return {
      bind: () => {
        throw new Error("statement is already bound");
      },
      run: async () => {
        const [id, householdId, period, choreId, memberId, , source] =
          values as string[];
        const key = `${householdId}:${period}:${choreId}`;
        if (!this.assignments.has(key)) {
          this.assignments.set(key, {
            id: id!,
            householdId: householdId!,
            period: period!,
            choreId: choreId!,
            memberId: memberId!,
            source: source!,
          });
        }
        return { meta: { changes: 1 } };
      },
      all: async <T>() => ({ results: [] as T[] }),
    };
  }
}

const members = ["Member A", "Member B", "Member C", "Member D"];
const choreRotations: ChoreRotation[] = [
  {
    choreId: "Trash",
    anchorPeriodStart: "2026-08-28",
    ownershipStartWeekday: 5,
    configurations: [
      {
        id: "trash-initial",
        effectiveFrom: "2026-08-28",
        memberIds: members,
        rotationOffset: 0,
      },
    ],
  },
  {
    choreId: "Dishwasher",
    anchorPeriodStart: "2026-08-31",
    ownershipStartWeekday: 1,
    configurations: [
      {
        id: "dishwasher-initial",
        effectiveFrom: "2026-08-31",
        memberIds: members,
        rotationOffset: 2,
      },
    ],
  },
];

function materialize(database: AssignmentD1, horizonPeriods = 4) {
  return materializeRollingHorizon(database, {
    householdId: "home",
    timeZone: "America/New_York",
    now: new Date("2026-09-01T16:00:00.000Z"),
    horizonPeriods,
    choreRotations,
    occurredAt: "2026-09-01T16:00:00.000Z",
  });
}

describe("independent rolling chore-period materialization", () => {
  it("materializes each chore from its own current period and inclusive range", async () => {
    const planned = await materialize(new AssignmentD1(), 2);
    expect(planned).toEqual([
      expect.objectContaining({
        choreId: "Trash",
        localPeriodStart: "2026-08-28",
        localInclusiveEndDate: "2026-09-03",
        memberId: "Member A",
      }),
      expect.objectContaining({
        choreId: "Trash",
        localPeriodStart: "2026-09-04",
        localInclusiveEndDate: "2026-09-10",
        memberId: "Member B",
      }),
      expect.objectContaining({
        choreId: "Dishwasher",
        localPeriodStart: "2026-08-31",
        localInclusiveEndDate: "2026-09-06",
        memberId: "Member C",
      }),
      expect.objectContaining({
        choreId: "Dishwasher",
        localPeriodStart: "2026-09-07",
        localInclusiveEndDate: "2026-09-13",
        memberId: "Member D",
      }),
    ]);
  });

  it("is repeated/concurrent-safe with parameterized insert-only statements", async () => {
    const database = new AssignmentD1();
    await Promise.all([materialize(database), materialize(database)]);
    expect(database.assignments).toHaveLength(8);
    expect(database.preparedSql).toHaveLength(16);
    expect(database.preparedSql.every((sql) => sql.includes("?"))).toBe(true);
    expect(
      database.preparedSql.every((sql) =>
        /ON CONFLICT\s*\(household_id, local_week_start, chore_id\)\s*DO NOTHING/.test(
          sql,
        ),
      ),
    ).toBe(true);
    expect(database.preparedSql.some((sql) => sql.includes("home"))).toBe(
      false,
    );
  });

  it("extends only missing independent period horizons", async () => {
    const database = new AssignmentD1();
    await materialize(database, 4);
    const original = new Map(database.assignments);
    await materialize(database, 6);
    expect(database.assignments).toHaveLength(12);
    for (const [key, assignment] of original) {
      expect(database.assignments.get(key)).toEqual(assignment);
    }
    expect(database.assignments.has("home:2026-10-02:Trash")).toBe(true);
    expect(database.assignments.has("home:2026-10-05:Dishwasher")).toBe(true);
  });

  it("preserves human overrides and historical assignments", async () => {
    const database = new AssignmentD1();
    database.assignments.set("home:2026-08-28:Trash", {
      id: "human",
      householdId: "home",
      period: "2026-08-28",
      choreId: "Trash",
      memberId: "Member D",
      source: "reassignment",
    });
    database.assignments.set("home:2026-08-21:Trash", {
      id: "history",
      householdId: "home",
      period: "2026-08-21",
      choreId: "Trash",
      memberId: "Member B",
      source: "rotation",
    });
    await materialize(database);
    expect(database.assignments.get("home:2026-08-28:Trash")).toMatchObject({
      id: "human",
      memberId: "Member D",
      source: "reassignment",
    });
    expect(database.assignments.get("home:2026-08-21:Trash")).toMatchObject({
      id: "history",
      memberId: "Member B",
    });
  });
});
