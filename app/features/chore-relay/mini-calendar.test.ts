import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MiniCalendar, miniCalendarDates } from "./mini-calendar";

const period = {
  localStartDate: "2026-08-28",
  localEndDateInclusive: "2026-09-03",
};

describe("MiniCalendar", () => {
  it("builds local-date cells that contain every ownership date", () => {
    const cells = miniCalendarDates(period);

    expect(
      cells.filter(({ inRange }) => inRange).map(({ localDate }) => localDate),
    ).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("marks today separately from the active ownership range", () => {
    const html = renderToStaticMarkup(
      createElement(MiniCalendar, {
        range: period,
        today: "2026-08-31",
        label: "Trash current period",
      }),
    );

    expect(html).toContain('aria-label="Trash current period"');
    expect(html).toContain('data-date="2026-08-31"');
    expect(html).toContain('data-today="true"');
    expect(html.match(/data-in-range="true"/g)).toHaveLength(7);
  });
});
