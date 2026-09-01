import { describe, expect, it } from "vitest";

import {
  assigneeFor,
  previewRotation,
  selectEffectiveConfiguration,
  validateFutureConfiguration,
  type ChoreRotation,
  type RotationConfiguration,
} from "./rotation";

const members = ["Member A", "Member B", "Member C", "Member D"];

const trash: ChoreRotation = {
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
};

const dishwasher: ChoreRotation = {
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
};

describe("deterministic chore-period offset rotation", () => {
  it("matches the initial four-period acceptance table on independent dates", () => {
    const trashPreview = previewRotation({
      rotation: trash,
      fromPeriod: "2026-08-28",
      periodCount: 4,
    });
    const dishwasherPreview = previewRotation({
      rotation: dishwasher,
      fromPeriod: "2026-08-31",
      periodCount: 4,
    });

    expect(
      trashPreview.map(({ localPeriodStart }) => localPeriodStart),
    ).toEqual(["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"]);
    expect(
      dishwasherPreview.map(({ localPeriodStart }) => localPeriodStart),
    ).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(trashPreview.map(({ memberId }) => memberId)).toEqual([
      "Member A",
      "Member B",
      "Member C",
      "Member D",
    ]);
    expect(dishwasherPreview.map(({ memberId }) => memberId)).toEqual([
      "Member C",
      "Member D",
      "Member A",
      "Member B",
    ]);
    expect(
      trashPreview.map(({ localInclusiveEndDate }) => localInclusiveEndDate),
    ).toEqual(["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"]);
  });

  it("obeys (periodIndex + offset) modulo N", () => {
    for (let count = 1; count <= 12; count += 1) {
      const memberIds = Array.from(
        { length: count },
        (_, index) => `m${index}`,
      );
      for (let offset = -2 * count; offset <= 2 * count; offset += 1) {
        for (let periodIndex = -10; periodIndex <= 20; periodIndex += 1) {
          const member = assigneeFor(memberIds, periodIndex, offset);
          const expectedIndex =
            (((periodIndex + offset) % count) + count) % count;
          expect(member).toBe(memberIds[expectedIndex]);
        }
      }
    }
  });

  it("selects future-effective membership without changing period indexes", () => {
    const future: RotationConfiguration = {
      id: "trash-future",
      effectiveFrom: "2026-09-11",
      memberIds: ["Member A", "Member B", "Member C"],
      rotationOffset: 1,
    };
    expect(
      selectEffectiveConfiguration(
        [future, ...trash.configurations],
        "2026-09-04",
      ).id,
    ).toBe("trash-initial");
    const preview = previewRotation({
      rotation: { ...trash, configurations: [...trash.configurations, future] },
      fromPeriod: "2026-09-04",
      periodCount: 2,
    });
    expect(preview[0]).toMatchObject({
      configurationId: "trash-initial",
      periodIndex: 1,
      memberId: "Member B",
    });
    expect(preview[1]).toMatchObject({
      configurationId: "trash-future",
      periodIndex: 2,
      memberId: "Member A",
    });
  });

  it("requires changes to begin on a future boundary for that chore", () => {
    expect(() =>
      validateFutureConfiguration(trash.configurations[0]!, {
        currentPeriod: "2026-08-28",
        anchorPeriod: "2026-08-28",
        ownershipStartWeekday: 5,
      }),
    ).toThrow(/future period/i);
    expect(() =>
      validateFutureConfiguration(
        { ...trash.configurations[0]!, effectiveFrom: "2026-09-09" },
        {
          currentPeriod: "2026-08-28",
          anchorPeriod: "2026-08-28",
          ownershipStartWeekday: 5,
        },
      ),
    ).toThrow(/period boundary/i);
  });
});
