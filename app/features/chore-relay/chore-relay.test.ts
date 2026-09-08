import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import type { ProjectedReminderStatus } from "../../domain/read-models";
import { ChoreRelayShell, type ChoreRelayData } from "./chore-relay-shell";
import { normalizeView, type ChoreRelayView } from "./model";

const members = ["Member A", "Member B", "Member C", "Member D"].map(
  (displayName) => ({
    id: displayName.toLowerCase().replace(" ", "-"),
    displayName,
    active: true,
  }),
);
const periodStarts = {
  trash: ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"],
  dishwasher: ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"],
} as const;
const owners = [
  ["member-a", "member-c"],
  ["member-b", "member-d"],
  ["member-c", "member-a"],
  ["member-d", "member-b"],
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
              result: choreId === "trash" ? "accepted" : "pending",
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
  signedInMember: {
    id: "member-d",
    householdId: "home",
    displayName: "Member D",
    imageUrl: "https://lh3.googleusercontent.com/a/profile-photo",
  },
  householdRange: "upcoming",
  localToday: "2026-08-31",
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
      .filter(({ member }) => member.id === "member-d")
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
        operationId: "operation:123e4567-e89b-12d3-a456-426614174000",
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
  assignmentCandidates: assignments,
};

function render(
  view: ChoreRelayView,
  state: "ready" | "unauthorized" | "unavailable" = "ready",
  localAuthAvailable = false,
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        state === "ready"
          ? createElement(ChoreRelayShell, {
              activeView: view,
              state: "ready",
              localAuthAvailable,
              data,
            })
          : createElement(ChoreRelayShell, {
              activeView: view,
              state,
              localAuthAvailable,
            }),
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

  it("renders authoritative Now instructions and next-period summaries", () => {
    const html = render("now");
    expect(html).toContain("Take the trash out and replace bags.");
    expect(html).toContain("Empty the completed dishwasher.");
    expect(html).toContain("Next period");
    expect(html).not.toContain("Hands off next");
    expect(html).not.toContain("Mock workspace");
    expect(html).not.toContain("The handoff starts here");
    expect(html).not.toContain("Every turn keeps its own dates");
    expect(html).not.toContain("Swap two turns");
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

  it("renders chronological Mine and a navigable Household month calendar", () => {
    const mine = render("mine");
    expect(mine).toContain("Your upcoming chores");
    expect(mine).not.toContain("Your lane");
    expect(mine).not.toContain("Personal route");
    const household = render("household");
    expect(household).toContain('class="month-calendar"');
    expect(household).toContain("August 2026");
    expect(household).toContain("Previous month");
    expect(household).toContain("Next month");
    expect(household).toContain("Assigned turns");
    expect(household).toContain("Schedule");
    expect(household).toContain("Swap");
    expect(household).toContain("Reassign Trash");
    expect(household).not.toContain("Upcoming");
    expect(household).not.toContain("All time");
    expect(household).not.toContain("Schedule filters");
    expect(household).not.toContain('class="schedule-list"');
  });

  it("omits planned reminder badges", () => {
    const html = render("now");
    expect(html).not.toContain("reminder planned");
  });

  it("shows only the configured morning reminder", () => {
    const html = render("now");
    expect(html).toContain("Morning reminder");
    expect(html.match(/Morning reminder/g)).toHaveLength(1);
    expect(html.match(/class="current-period-row"/g)).toHaveLength(2);
    expect(html.match(/reminder-status is-reserved/g)).toHaveLength(2);
    expect(html).not.toMatch(
      /evening reminder|accepted for sending|delivery unconfirmed|reminder missed|reminder contact|reminder consent|reminders suppressed/i,
    );
  });

  it("groups both atomic swap legs in visible History", () => {
    const html = render("history");
    expect(html).toContain("Swap");
    expect(html).toContain("Swap leg 1 of 2");
    expect(html).toContain("Swap leg 2 of 2");
    expect(html.match(/<span>Ownership range<\/span>/g)).toHaveLength(2);
    expect(html).toContain("Fri, Aug 28 – Thu, Sep 3");
    expect(html).toContain("Mon, Aug 31 – Sun, Sep 6");
    expect(html).toContain("Recorded by");
    expect(html).not.toContain("123e4567-e89b-12d3-a456-426614174000");
  });

  it("describes swap selections without transfer jargon", () => {
    const html = render("now");
    expect(html).not.toMatch(/outgoing|incoming/i);
  });

  it("surfaces correction-needed History evidence without sensitive delivery details", () => {
    const html = render("history");
    expect(html).toContain("Reminder correction needed");
    expect(html).toContain("No immediate correction SMS is sent");
    expect(html).not.toMatch(/textbelt|phone|quota|textId/i);
  });

  it("fails closed with explicit unauthorized and unavailable SSR states", () => {
    const unauthorized = render("now", "unauthorized");
    expect(unauthorized).toContain('class="sign-in-page"');
    expect(unauthorized).toContain('class="sign-in-shutters"');
    expect(unauthorized).toContain("Sign in with Google");
    expect(unauthorized).toContain('class="google-mark"');
    expect(unauthorized).not.toContain("This household is private");
    expect(unauthorized).not.toContain("ChoRotate views");
    expect(unauthorized).toContain('aria-live="polite"');
    const unavailable = render("now", "unavailable");
    expect(unavailable).toContain("No schedule found");
    expect(unavailable).not.toContain("Take the trash");
  });

  it("uses the server-approved local auth presentation flag", () => {
    const local = render("now", "unauthorized", true);
    expect(local).toContain("Sign in locally");
    expect(local).not.toContain("Sign in with Google");
    expect(local).not.toContain('class="google-mark"');
  });

  it("places account actions behind a compact profile control", () => {
    const html = render("now");
    expect(html).toContain("Open profile menu");
    expect(html).toContain("Sign out");
    expect(html).toContain("https://lh3.googleusercontent.com/a/profile-photo");
    expect(html).toContain('aria-live="polite"');
  });

  it("emits theme and mobile/desktop controls in server-rendered markup", () => {
    const html = render("household");
    expect(html).toContain("Switch color mode");
    expect(html).toContain("month-calendar");
  });

  it("links to the source repository without promotional or legal content", () => {
    const html = render("now");
    expect(html).toContain('href="https://github.com/shanebishop1/chorotate"');
    expect(html).toContain('aria-label="ChoRotate on GitHub"');
    expect(html).toContain("Shane Bishop");
    expect(html).toContain("2026");
    expect(html).not.toContain("One home. Clear handoffs");
    expect(html).not.toContain("Authoritative household schedule");
    expect(html).not.toContain('href="/privacy"');
    expect(html).not.toContain('href="/terms"');
  });
});
