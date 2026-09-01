export type HouseholdId = string;
export type MemberId = string;
export type ChoreId = string;
export type AssignmentId = string;
export type OperationId = string;
export type AuditEventId = string;
export type ReminderOutboxId = string;
export type LocalDate = string;
export type IsoTimestamp = string;

export interface Member {
  id: MemberId;
  householdId: HouseholdId;
  displayName: string;
  active: boolean;
}

export interface Chore {
  id: ChoreId;
  householdId: HouseholdId;
  name: string;
  rotationOffset: number;
  active: boolean;
}

export interface WeekIdentity {
  householdId: HouseholdId;
  localStartDate: LocalDate;
}

export type AssignmentSource = "rotation" | "reassignment" | "swap";

export interface Assignment {
  id: AssignmentId;
  week: WeekIdentity;
  choreId: ChoreId;
  memberId: MemberId;
  version: number;
  source: AssignmentSource;
}

export type AssignmentOperationKind =
  "materialize" | "reassign" | "swap" | "correct";

export interface OperationContext {
  operationId: OperationId;
  requestId: string;
  actorMemberId: MemberId | null;
  kind: AssignmentOperationKind;
  occurredAt: IsoTimestamp;
}

export interface AssignmentSnapshot {
  memberId: MemberId;
  version: number;
}

export interface AssignmentAuditEvent {
  id: AuditEventId;
  assignmentId: AssignmentId;
  operation: OperationContext;
  before: AssignmentSnapshot | null;
  after: AssignmentSnapshot;
}

export type ReminderKind = "assignment" | "correction";
export type OutboxStatus = "pending" | "leased" | "sent" | "failed";

export interface ReminderOutboxItem {
  id: ReminderOutboxId;
  assignmentId: AssignmentId;
  assignmentVersion: number;
  recipientMemberId: MemberId;
  kind: ReminderKind;
  status: OutboxStatus;
  availableAt: IsoTimestamp;
  attemptCount: number;
  leaseExpiresAt: IsoTimestamp | null;
  providerMessageId: string | null;
}
