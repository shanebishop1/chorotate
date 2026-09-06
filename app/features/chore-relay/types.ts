import type { AuthorizedMember } from "../../auth/access";
import type {
  ProjectedAssignment,
  ProjectedMember,
  getCurrentAndNext,
  getGroupedHistory,
  getHouseholdCalendar,
  getHouseholdList,
  getPersonalAgenda,
} from "../../domain/read-models";
import type { HomeActionData } from "../../routes/home";
import type { ChoreRelayView, HouseholdRange } from "./model";

export interface ChoreRelayData {
  signedInMember: AuthorizedMember;
  householdRange: HouseholdRange;
  localToday: string;
  current: Awaited<ReturnType<typeof getCurrentAndNext>>;
  mine: Awaited<ReturnType<typeof getPersonalAgenda>>;
  householdList: Awaited<ReturnType<typeof getHouseholdList>>;
  household: Awaited<ReturnType<typeof getHouseholdCalendar>>;
  history: Awaited<ReturnType<typeof getGroupedHistory>>;
  activeMembers: ProjectedMember[];
  assignmentCandidates: ProjectedAssignment[];
}

export type ChoreRelayProps =
  | {
      activeView: ChoreRelayView;
      state: "unauthorized" | "unavailable";
      data?: never;
    }
  | { activeView: ChoreRelayView; state: "ready"; data: ChoreRelayData };

export type Theme = "light" | "dark" | undefined;

export type DialogState = (
  | {
      kind: "reassign";
      assignmentId: string;
      recipientId: string;
      step: "recipient" | "review";
      balanceAssignmentId: string;
      requestId: string;
    }
  | { kind: "swap"; firstId: string; secondId: string; requestId: string }
) & { reviewedConflictKey?: string };

export type ActionResult = Exclude<HomeActionData, { state: "success" }>;
