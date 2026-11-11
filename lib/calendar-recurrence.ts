export type RecurrenceEnd =
  | { type: "never" }
  | { type: "onDate"; date: string } // YYYY-MM-DD, inclusive last possible occurrence day
  | { type: "afterCount"; count: number };

export type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number; // every N [freq units]; 1 = every unit
  end: RecurrenceEnd;
};

/** Maps JS weekday (0 = Sunday) to Google Calendar's two-letter form. */
function weekdayToGoogleCode(weekday: number): string {
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return codes[weekday];
}

/** Formats a date as YYYYMMDDT235959Z (Google's all-day UTC form). */
function formatUntilDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T235959Z`;
}

/** Parses a date string in YYYYMMDDT235959Z format to YYYY-MM-DD. */
function parseUntilDate(untilStr: string): string {
  const match = untilStr.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Decrements a date by one day and formats it as YYYYMMDDT235959Z. */
function formatPreviousDayUntil(date: Date): string {
  const previousDay = new Date(date);
  previousDay.setDate(previousDay.getDate() - 1);
  return formatUntilDate(previousDay);
}

/**
 * Builds an RRULE string from a RecurrenceRule and the event's start day.
 * Field order: FREQ, then INTERVAL (omitted when 1), then BYDAY (only for WEEKLY),
 * then UNTIL/COUNT depending on end type.
 */
export function buildRRule(rule: RecurrenceRule, eventStartDay: Date): string {
  let rrule = `RRULE:FREQ=${rule.freq}`;

  if (rule.interval > 1) {
    rrule += `;INTERVAL=${rule.interval}`;
  }

  if (rule.freq === "WEEKLY") {
    const weekday = weekdayToGoogleCode(eventStartDay.getDay());
    rrule += `;BYDAY=${weekday}`;
  }

  if (rule.end.type === "onDate") {
    const untilDate = new Date(rule.end.date + "T23:59:59");
    rrule += `;UNTIL=${formatUntilDate(untilDate)}`;
  } else if (rule.end.type === "afterCount") {
    rrule += `;COUNT=${rule.end.count}`;
  }

  return rrule;
}

/**
 * Parses an RRULE string back to a RecurrenceRule.
 * BYDAY is read but not stored (it's context-specific to the event's start day).
 */
export function parseRRule(line: string): RecurrenceRule {
  const parts = line.replace("RRULE:", "").split(";");
  const pairs: Record<string, string> = {};

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) {
      pairs[key] = value;
    }
  }

  const freq = (pairs.FREQ || "DAILY") as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  const interval = pairs.INTERVAL ? parseInt(pairs.INTERVAL, 10) : 1;

  let end: RecurrenceEnd = { type: "never" };

  if (pairs.UNTIL) {
    end = { type: "onDate", date: parseUntilDate(pairs.UNTIL) };
  } else if (pairs.COUNT) {
    end = { type: "afterCount", count: parseInt(pairs.COUNT, 10) };
  }

  return { freq, interval, end };
}

/**
 * Removes any existing UNTIL or COUNT from an RRULE and appends a new UNTIL
 * that ends the day before the given occurrence start date.
 */
export function truncateRRuleBefore(line: string, occurrenceStart: Date): string {
  // Remove UNTIL and COUNT from the RRULE
  const parts = line.replace("RRULE:", "").split(";");
  const filteredParts = parts.filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="));

  // Reconstruct the RRULE
  let result = "RRULE:" + filteredParts.join(";");

  // Append new UNTIL for the day before occurrenceStart
  result += `;UNTIL=${formatPreviousDayUntil(occurrenceStart)}`;

  return result;
}

/**
 * Checks if an occurrence is the first occurrence by comparing the master's start
 * with the occurrence's start. Handles both timed and date-only formats.
 */
export function isFirstOccurrence(masterStart: string, occurrenceStart: string): boolean {
  return masterStart === occurrenceStart;
}
