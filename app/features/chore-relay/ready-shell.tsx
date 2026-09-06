import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { ProjectedAssignment } from "../../domain/read-models";
import type { HomeActionData } from "../../routes/home";
import type { ChoreRelayView } from "./model";
import { ChangeDialog } from "./change-dialog";
import { ReadyView } from "./views";
import { Icon, unique } from "./shared-presentation";
import type { ChoreRelayData, DialogState } from "./types";

export function ReadyShell({
  activeView,
  data,
}: {
  activeView: ChoreRelayView;
  data: ChoreRelayData;
}) {
  const fetcher = useFetcher<HomeActionData>();
  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState("");
  const [issue, setIssue] = useState<HomeActionData>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open)
      dialogRef.current.showModal();
  }, [dialog]);
  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.state === "success") {
      setNotice(
        fetcher.data.intent === "swap"
          ? "Both swap legs moved together."
          : "The handoff was saved.",
      );
      setIssue(undefined);
      dialogRef.current?.close();
      setDialog(undefined);
      openerRef.current?.focus();
    } else {
      setIssue(fetcher.data);
      if (fetcher.data.state === "conflict") {
        setDialog((current) =>
          current ? { ...current, reviewedConflictKey: undefined } : current,
        );
      }
    }
  }, [fetcher.data]);
  useEffect(() => {
    if (!issue) return;
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>(".dialog-issue")?.focus(),
    );
  }, [issue]);
  function remember() {
    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    )
      openerRef.current = document.activeElement;
  }
  function close() {
    dialogRef.current?.close();
    setDialog(undefined);
    setIssue(undefined);
    openerRef.current?.focus();
  }
  function reassign(assignmentId: string) {
    remember();
    setIssue(undefined);
    setDialog({
      kind: "reassign",
      assignmentId,
      recipientId: "",
      step: "recipient",
      balanceAssignmentId: "",
      requestId: `request:${crypto.randomUUID()}`,
    });
  }
  function swap() {
    remember();
    setIssue(undefined);
    setDialog({
      kind: "swap",
      firstId: "",
      secondId: "",
      requestId: `request:${crypto.randomUUID()}`,
    });
  }
  const assignments = unique(
    [
      ...data.assignmentCandidates,
      ...data.householdList.items,
      ...data.household.periods.flatMap((period) => period.assignments),
      ...(data.current.state === "ready"
        ? data.current.handoffs.flatMap(({ current, next }) =>
            [current, next].filter(
              (assignment): assignment is ProjectedAssignment =>
                assignment !== null,
            ),
          )
        : []),
    ],
    (assignment) => assignment.assignmentId,
  );
  return (
    <>
      <ReadyView
        activeView={activeView}
        data={data}
        onReassign={reassign}
        onSwap={swap}
      />
      {notice ? (
        <div className="toast" role="status">
          <Icon name="check" />
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}
      {dialog ? (
        <ChangeDialog
          dialogRef={dialogRef}
          dialog={dialog}
          assignments={assignments}
          members={data.activeMembers}
          localToday={data.localToday}
          fetcher={fetcher}
          issue={issue}
          onChange={(next) => {
            setDialog(next);
            setIssue(undefined);
          }}
          onReviewConflict={setDialog}
          onClose={close}
        />
      ) : null}
    </>
  );
}
