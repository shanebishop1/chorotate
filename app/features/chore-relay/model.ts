export const views = ["now", "mine", "household", "history"] as const;

export type ChoreRelayView = (typeof views)[number];

export interface ChorePeriodRange {
  localStartDate: string;
  localEndDateInclusive: string;
}

export function normalizeView(value: string | null): ChoreRelayView {
  return views.includes(value as ChoreRelayView)
    ? (value as ChoreRelayView)
    : "now";
}
