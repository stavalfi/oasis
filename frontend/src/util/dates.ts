/**
 * dates.ts
 *
 * Small date formatters for the UI: a relative "2 hours ago" string for recent
 * tickets, and a short absolute date for API key metadata.
 */
const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** Format an ISO timestamp as a relative time, e.g. "2 hours ago". */
export const formatRelativeTime = (isoTimestamp: string): string => {
  const elapsedMs = new Date(isoTimestamp).getTime() - Date.now();
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(elapsedMs) >= unitMs) {
      return relativeFormatter.format(Math.round(elapsedMs / unitMs), unit);
    }
  }
  return relativeFormatter.format(Math.round(elapsedMs / 1000), "second");
};

/** Format an ISO timestamp as a short absolute date. */
export const formatDate = (isoTimestamp: string): string =>
  new Date(isoTimestamp).toLocaleDateString();
