const localDateFormatter = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(
  date: Date,
  timeZone: string,
): Record<string, number> {
  let formatter = localDateFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    localDateFormatter.set(timeZone, formatter);
  }
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

export function localDateAt(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
