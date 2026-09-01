import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  chorePeriodAt,
  localPeriodFromStart,
  periodsBetween,
  weekdayOfLocalDate,
} from "./period";

describe("chore-specific local periods", () => {
  it("uses independent Friday and Monday boundaries at the same instant", () => {
    const now = new Date("2026-09-01T16:00:00.000Z");

    expect(
      chorePeriodAt(now, {
        timeZone: "America/New_York",
        startsOn: 5,
      }),
    ).toMatchObject({
      localStartDate: "2026-08-28",
      localInclusiveEndDate: "2026-09-03",
    });
    expect(
      chorePeriodAt(now, {
        timeZone: "America/New_York",
        startsOn: 1,
      }),
    ).toMatchObject({
      localStartDate: "2026-08-31",
      localInclusiveEndDate: "2026-09-06",
    });
  });

  it("changes a Friday period exactly at household-local midnight", () => {
    const settings = { timeZone: "America/New_York", startsOn: 5 as const };
    expect(
      chorePeriodAt(new Date("2026-09-04T03:59:59.999Z"), settings)
        .localStartDate,
    ).toBe("2026-08-28");
    expect(
      chorePeriodAt(new Date("2026-09-04T04:00:00.000Z"), settings)
        .localStartDate,
    ).toBe("2026-09-04");
  });

  it("keeps spring-DST period dates stable while elapsed time is 167 hours", () => {
    const period = localPeriodFromStart("2026-03-06", {
      timeZone: "America/New_York",
      startsOn: 5,
    });
    expect(period.localInclusiveEndDate).toBe("2026-03-12");
    expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(
      167 * 60 * 60 * 1_000,
    );
  });

  it("keeps fall-DST period dates stable while elapsed time is 169 hours", () => {
    const period = localPeriodFromStart("2026-10-26", {
      timeZone: "America/New_York",
      startsOn: 1,
    });
    expect(period.localInclusiveEndDate).toBe("2026-11-01");
    expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(
      169 * 60 * 60 * 1_000,
    );
  });

  it.each([
    [
      "spring",
      "2026-03-09T03:59:59.999Z",
      "2026-03-09T04:00:00.000Z",
      "2026-03-02",
      "2026-03-09",
    ],
    [
      "fall",
      "2026-11-02T04:59:59.999Z",
      "2026-11-02T05:00:00.000Z",
      "2026-10-26",
      "2026-11-02",
    ],
  ])(
    "changes Monday periods at the exact local boundary after %s DST",
    (_, before, at, previousStart, nextStart) => {
      const settings = {
        timeZone: "America/New_York",
        startsOn: 1 as const,
      };
      expect(chorePeriodAt(new Date(before), settings).localStartDate).toBe(
        previousStart,
      );
      expect(chorePeriodAt(new Date(at), settings).localStartDate).toBe(
        nextStart,
      );
    },
  );

  it("satisfies seven-local-day properties across dates, zones, and starts", () => {
    const zones = ["UTC", "America/New_York", "Pacific/Auckland"];
    for (let sample = 0; sample < 180; sample += 1) {
      const instant = new Date(
        Date.UTC(2026, 0, 1) + sample * 47 * 60 * 60 * 1_000,
      );
      const startsOn = (sample % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const period = chorePeriodAt(instant, {
        timeZone: zones[sample % zones.length]!,
        startsOn,
      });
      expect(weekdayOfLocalDate(period.localStartDate)).toBe(startsOn);
      expect(period.localInclusiveEndDate).toBe(
        addLocalDays(period.localStartDate, 6),
      );
      expect(
        periodsBetween(
          period.localStartDate,
          addLocalDays(period.localStartDate, 7),
        ),
      ).toBe(1);
      expect(instant.getTime()).toBeGreaterThanOrEqual(
        period.startsAt.getTime(),
      );
      expect(instant.getTime()).toBeLessThan(period.endsAt.getTime());
    }
  });
});
