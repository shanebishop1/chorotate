import { describe, expect, it } from "vitest";

import type { AuthorizedMember } from "../../auth/access";
import type { D1DatabaseLike, D1StatementLike } from "../storage/d1";
import { prepareCurrentSchedule } from "./prepare";

class PreparationD1 implements D1DatabaseLike {
  readonly inserted: unknown[][] = [];

  prepare(sql: string): D1StatementLike {
    return {
      bind: (...values: unknown[]) => ({
        bind: () => {
          throw new Error("statement is already bound");
        },
        run: async () => {
          if (sql.startsWith("INSERT INTO weekly_assignments")) {
            this.inserted.push(values);
          }
          return {};
        },
        all: async <T>() => ({ results: this.rowsFor(sql) as T[] }),
      }),
      run: async () => ({}),
      all: async <T>() => ({ results: this.rowsFor(sql) as T[] }),
    };
  }

  async batch(statements: D1StatementLike[]): Promise<unknown> {
    for (const statement of statements) await statement.run();
    return [];
  }

  private rowsFor(sql: string): unknown[] {
    if (sql.includes("FROM households")) {
      return [{ id: "home", time_zone: "America/New_York" }];
    }
    if (sql.includes("FROM rotation_configs")) {
      return [
        {
          config_id: "trash-config",
          effective_from: "2026-08-28",
          chore_id: "Trash",
          rotation_offset: 0,
          ownership_start_weekday: 5,
        },
        {
          config_id: "dishwasher-config",
          effective_from: "2026-08-31",
          chore_id: "Dishwasher",
          rotation_offset: 2,
          ownership_start_weekday: 1,
        },
      ];
    }
    if (sql.includes("FROM rotation_config_members")) {
      return ["Member A", "Member B", "Member C", "Member D"].flatMap((memberId) => [
        { config_id: "trash-config", member_id: memberId },
        { config_id: "dishwasher-config", member_id: memberId },
      ]);
    }
    return [];
  }
}

describe("current schedule materialization preparation", () => {
  it("consumes each chore's persisted anchor and ownership weekday", async () => {
    const database = new PreparationD1();
    const actor = {
      id: "Member A",
      householdId: "home",
    } as AuthorizedMember;

    await prepareCurrentSchedule(database, actor, {
      now: new Date("2026-09-01T16:00:00.000Z"),
      horizonPeriods: 1,
    });

    expect(
      database.inserted.map((values) => ({
        period: values[2],
        choreId: values[3],
        memberId: values[4],
      })),
    ).toEqual([
      { period: "2026-08-28", choreId: "Trash", memberId: "Member A" },
      {
        period: "2026-08-31",
        choreId: "Dishwasher",
        memberId: "Member C",
      },
    ]);
  });
});
