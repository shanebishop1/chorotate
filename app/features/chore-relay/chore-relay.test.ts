import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { ProjectedReminderStatus } from "../../domain/read-models";
import { ChoreRelayShell, type ChoreRelayData } from "./chore-relay-shell";
import { normalizeView, type ChoreRelayView } from "./model";

const members = ["Jack", "Joe", "Dylan", "Shane"].map((displayName) => ({
  id: displayName.toLowerCase(),
  displayName,
  active: true,
}));
const periodStarts = {
  trash: ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"],
  dishwasher: ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"],
} as const;
const owners = [
  ["jack", "dylan"],
  ["joe", "shane"],
  ["dylan", "jack"],
  ["shane", "joe"],
];
const chores = [
  {
    id: "trash",
    name: "Trash",
    instructions: "Take the trash out and replace bags.",
    ownershipStartWeekday: 5 as const,
  },
  {
    id: "dishwasher",
    name: "Dishwasher",
    instructions: "Empty the completed dishwasher.",
    ownershipStartWeekday: 1 as const,
  },
] as const;
const range = (localStartDate: string) => ({
  householdId: "home",
  localStartDate,
  localEndDateInclusive: new Date(
    new Date(`${localStartDate}T00:00:00Z`).valueOf() + 6 * 86400000,
  )
    .toISOString()
    .slice(0, 10),
});
const reminder = (
  choreId: (typeof chores)[number]["id"],
  turnIndex: number,
): ProjectedReminderStatus => {
  if (turnIndex === 1 && choreId === "trash")
    return {
      contactStatus: "missing_contact",
      correctionNeeded: false,
      occurrences: [],
    };
  if (turnIndex === 1 && choreId === "dishwasher")
    return {
      contactStatus: "suppressed",
      correctionNeeded: false,
      occurrences: [],
    };
  if (turnIndex === 0 && choreId === "dishwasher")
    return {
      contactStatus: "ready",
      correctionNeeded: true,
      occurrences: [
        {
          phase: "evening",
          result: "delivery_unknown",
          correctionNeeded: true,
        },
      ],
    };
  return {
    contactStatus: "ready",
    correctionNeeded: false,
    occurrences:
      turnIndex === 0
        ? [
            {
              phase: "evening",
              result: "accepted",
              correctionNeeded: false,
            },
            {
              phase: "morning",
              result: "pending",
              correctionNeeded: false,
            },
          ]
        : [],
  };
};
const assignments = chores.flatMap((chore, choreIndex) =>
  periodStarts[chore.id].map((periodStart, turnIndex) => ({
    assignmentId: `${periodStart}-${chore.id}`,
    period: range(periodStart),
    chore,
    member: members.find(({ id }) => id === owners[turnIndex][choreIndex])!,
    version: 1,
    source: "rotation" as const,
    reminder: reminder(chore.id, turnIndex),
  })),
);
const historyAssignments = chores.map((chore) =>
  assignments.find((item) => item.chore.id === chore.id)!,
);

const data: ChoreRelayData = {
  signedInMember: { id: "shane", householdId: "home", displayName: "Shane" },
  current: {
    state: "ready",
    handoffs: chores.map((chore) => ({
      chore,
      currentPeriod: range(periodStarts[chore.id][0]),
      nextPeriod: range(periodStarts[chore.id][1]),
      current: assignments.find(
        (item) => item.period.localStartDate === periodStarts[chore.id][0],
      )!,
      next: assignments.find(
        (item) => item.period.localStartDate === periodStarts[chore.id][1],
      )!,
    })),
  },
  mine: {
    state: "ready",
    items: assignments
      .filter(({ member }) => member.id === "shane")
      .sort((a, b) =>
        a.period.localStartDate.localeCompare(b.period.localStartDate),
      ),
    page: { limit: 100, offset: 0, nextOffset: null },
  },
  householdList: {
    state: "ready",
    items: [...assignments].sort((a, b) =>
      a.period.localStartDate.localeCompare(b.period.localStartDate),
    ),
    page: { limit: 100, offset: 0, nextOffset: null },
  },
  household: {
    state: "ready",
    periods: [...assignments]
      .sort((a, b) =>
        a.period.localStartDate.localeCompare(b.period.localStartDate),
      )
      .map((assignment) => ({
        period: assignment.period,
        assignments: [assignment],
      })),
  },
  history: {
    state: "ready",
    page: { limit: 25, offset: 0, nextOffset: null },
    operations: [
      {
        operationId: "swap-1",
        requestId: "request-1",
        kind: "swap",
        occurredAt: "2026-08-31T14:00:00Z",
        localOccurredAt: "2026-08-31T10:00:00",
        actorType: "member",
        actor: members[1],
        changes: historyAssignments.map((assignment, index) => ({
          eventId: `event-${index}`,
          assignmentId: assignment.assignmentId,
          period: assignment.period,
          chore: assignment.chore,
          before: {
            member: assignment.member,
            version: 1,
            source: "rotation",
            reminder: assignment.reminder,
          },
          after: {
            member: historyAssignments[1 - index].member,
            version: 2,
            source: "swap",
            reminder: historyAssignments[1 - index].reminder,
          },
        })),
      },
    ],
  },
  activeMembers: members,
};

function render(
  view: ChoreRelayView,
  state: "ready" | "unauthorized" | "unavailable" = "ready",
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        state === "ready"
          ? createElement(ChoreRelayShell, {
              activeView: view,
              state: "ready",
              data,
            })
          : createElement(ChoreRelayShell, { activeView: view, state }),
    },
  ]);
  return renderToStaticMarkup(
    createElement(Stub, { initialEntries: [`/?view=${view}`] }),
  );
}

describe("Chore Relay integrated rendering", () => {
  it("keeps the four URL-backed view contract", () => {
    expect(normalizeView("household")).toBe("household");
    expect(normalizeView("unknown")).toBe("now");
    const html = render("now");
    for (const label of ["Now", "Mine", "Household", "History"])
      expect(html).toContain(label);
  });

  it("renders authoritative Now instructions and current-to-next handoffs", () => {
    const html = render("now");
    expect(html).toContain("Take the trash out and replace bags.");
    expect(html).toContain("Empty the completed dishwasher.");
    expect(html).toContain("Hands off next");
    expect(html).not.toContain("Mock workspace");
  });

  it("renders each chore's own current and next period at the handoff", () => {
    const html = render("now");
    expect(html).toContain("Fri, Aug 28 – Thu, Sep 3");
    expect(html).toContain("Fri, Sep 4 – Thu, Sep 10");
    expect(html).toContain("Mon, Aug 31 – Sun, Sep 6");
    expect(html).toContain("Mon, Sep 7 – Sun, Sep 13");
  });

  it("does not claim one household week across staggered chore periods", () => {
    for (const view of ["now", "mine", "household", "history"] as const) {
      const html = render(view);
      expect(html).not.toMatch(/this week|next week|week of|household week/i);
    }
  });

  it("renders chronological Mine and responsive Household representations", () => {
    expect(render("mine")).toContain("Shane’s turns");
    const household = render("household");
    expect(household).toContain("<table");
    expect(household).toContain("<caption");
    expect(household).toContain('class="schedule-list"');
    expect(household).toContain("Member");
    expect(household).toContain("Chore");
    expect(household).toContain("Current turn");
    expect(household).toContain("Period");
    expect(household).not.toContain("Turn 1");
    expect(household.indexOf("Fri, Aug 28 – Thu, Sep 3")).toBeLessThan(
      household.indexOf("Mon, Aug 31 – Sun, Sep 6"),
    );
  });

  it("surfaces reminder outcomes and corrections without provider or contact data", () => {
    const html = render("now");
    expect(html).toContain("Evening reminder accepted for sending");
    expect(html).toContain("Reminder delivery unconfirmed");
    expect(html).toContain("Reminder correction needed");
    expect(html).toContain("Reminder contact missing");
    expect(html).toContain("Reminders suppressed");
    expect(html).not.toMatch(/textbelt|phone|quota|textId/i);
  });

  it("groups both atomic swap legs in visible History", () => {
    const html = render("history");
    expect(html).toContain("Atomic swap");
    expect(html).toContain("Swap leg 1 of 2");
    expect(html).toContain("Swap leg 2 of 2");
    expect(html.match(/<span>Ownership range<\/span>/g)).toHaveLength(2);
    expect(html).toContain("Fri, Aug 28 – Thu, Sep 3");
    expect(html).toContain("Mon, Aug 31 – Sun, Sep 6");
    expect(html).toContain("Recorded by");
  });

  it("surfaces correction-needed History evidence without sensitive delivery details", () => {
    const html = render("history");
    expect(html).toContain("Reminder correction needed");
    expect(html).toContain("No immediate correction SMS is sent");
    expect(html).not.toMatch(/textbelt|phone|quota|textId/i);
  });

  it("fails closed with explicit unauthorized and unavailable SSR states", () => {
    const unauthorized = render("now", "unauthorized");
    expect(unauthorized).toContain("This household is private");
    expect(unauthorized).toContain("Sign in with Google");
    expect(unauthorized).toContain('aria-live="polite"');
    const unavailable = render("now", "unavailable");
    expect(unavailable).toContain("Schedule temporarily unavailable");
    expect(unavailable).not.toContain("Take the trash");
  });

  it("renders an authenticated sign-out control with accessible status feedback", () => {
    const html = render("now");
    expect(html).toContain("Sign out");
    expect(html).toContain('aria-live="polite"');
  });

  it("emits theme and mobile/desktop controls in server-rendered markup", () => {
    const html = render("household");
    expect(html).toContain("Toggle color mode");
    expect(html).toContain("schedule-table-wrap");
    expect(html).toContain("schedule-list");
  });
});
