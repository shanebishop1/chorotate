import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter, useLocation } from "react-router";

import "../../../app/app.css";
import {
  ChoreRelayShell,
  type ChoreRelayData,
} from "../../../app/features/chore-relay/chore-relay-shell";
import { normalizeView } from "../../../app/features/chore-relay/model";
import type { ProjectedReminderStatus } from "../../../app/domain/read-models";

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
    new Date(`${localStartDate}T00:00:00Z`).valueOf() + 6 * 86_400_000,
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
const endedAssignments = [
  {
    assignmentId: "2026-08-21-trash",
    period: range("2026-08-21"),
    chore: chores[0],
    member: members[3],
    version: 1,
    source: "rotation",
    reminder: reminder("trash", 3),
  },
  {
    assignmentId: "2026-08-24-dishwasher",
    period: range("2026-08-24"),
    chore: chores[1],
    member: members[1],
    version: 1,
    source: "rotation",
    reminder: reminder("dishwasher", 3),
  },
] satisfies typeof assignments;
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

function Fixture() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const view = normalizeView(search.get("view"));
  const endedChore = search.get("ended");
  const endedAssignment = endedAssignments.find(
    ({ chore }) => chore.id === endedChore,
  );
  const fixtureData = endedAssignment
    ? {
        ...data,
        current: {
          ...data.current,
          handoffs: data.current.handoffs.map((handoff) =>
            handoff.chore.id === endedChore
              ? {
                  ...handoff,
                  currentPeriod: endedAssignment.period,
                  current: endedAssignment,
                }
              : handoff,
          ),
        },
        household: {
          ...data.household,
          periods: [
            {
              period: endedAssignment.period,
              assignments: [endedAssignment],
            },
            ...data.household.periods,
          ],
        },
      }
    : data;
  return <ChoreRelayShell activeView={view} state="ready" data={fixtureData} />;
}

const router = createBrowserRouter([
  {
    path: "/",
    Component: Fixture,
    action: async ({ request }) => {
      const form = await request.formData();
      const selectedIds = [
        form.get("assignmentId"),
        form.get("firstAssignmentId"),
        form.get("secondAssignmentId"),
      ];
      if (
        selectedIds.includes("2026-08-21-trash") ||
        selectedIds.includes("2026-08-24-dishwasher")
      ) {
        return {
          state: "validation" as const,
          message: "That assignment week has ended and cannot be changed.",
        };
      }
      if (
        form.get("intent") === "reassign" &&
        form.get("recipientMemberId") === "joe"
      ) {
        return {
          state: "conflict" as const,
          current: [
            {
              assignmentId: String(form.get("assignmentId")),
              memberId: "dylan",
              version: 2,
            },
          ],
        };
      }
      return {
        state: "success" as const,
        intent:
          form.get("intent") === "swap"
            ? ("swap" as const)
            : ("reassign" as const),
      };
    },
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
