import { describe, expect, it } from "vitest";
import { planBalancedRotation } from "./balanced";

const memberIds = ["a", "b", "c", "d"];
const choreIds = ["trash", "dishwasher", "wipe", "sweep"];
describe("history-aware synchronized rotation", () => {
  it("gives everyone one duty every week and every chore once per four-week cycle", () => {
    const plan = planBalancedRotation({ memberIds, choreIds, history: [] });
    for (let week = 0; week < 53; week += 1) {
      expect(
        new Set(
          choreIds.map((chore) => memberIds[(plan.offsets[chore]! + week) % 4]),
        ).size,
      ).toBe(4);
    }
    for (const member of memberIds) {
      expect(
        new Set(
          Array.from({ length: 4 }, (_, week) =>
            choreIds.find(
              (chore) =>
                memberIds[(plan.offsets[chore]! + week) % 4] === member,
            ),
          ),
        ).size,
      ).toBe(4);
    }
  });
  it("changes the starting phase based on actual history, not old offsets", () => {
    const history = choreIds.map((choreId, i) => ({
      choreId,
      memberId: memberIds[i]!,
      days: 14,
    }));
    const plan = planBalancedRotation({
      memberIds,
      choreIds,
      history,
      previousOwners: Object.fromEntries(
        choreIds.map((c, i) => [c, memberIds[i]!]),
      ),
    });
    expect(plan.repeatedDuties).toBe(0);
    for (const chore of choreIds) {
      expect(history.find((h) => h.choreId === chore)?.memberId).not.toBe(
        memberIds[plan.offsets[chore]!],
      );
    }
    expect(planBalancedRotation({ memberIds, choreIds, history })).toEqual(
      plan,
    );
  });
  it("credits short transition periods by days, rather than counting them as a full week", () => {
    const short = planBalancedRotation({
      memberIds: ["a", "b"],
      choreIds: ["x", "y"],
      history: [
        { memberId: "a", choreId: "x", days: 3 },
        { memberId: "b", choreId: "x", days: 7 },
      ],
    });
    expect(short.offsets.x).toBe(0);
  });
  it("rejects malformed and unequal rosters or unknown history", () => {
    expect(() =>
      planBalancedRotation({ memberIds, choreIds: ["x"], history: [] }),
    ).toThrow();
    expect(() =>
      planBalancedRotation({
        memberIds,
        choreIds,
        history: [{ memberId: "other", choreId: "trash", days: 7 }],
      }),
    ).toThrow();
  });
});
