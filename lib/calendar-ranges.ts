import {
  MONTH_NAMES_FULL,
  MONTH_NAMES_SHORT,
  WEEKDAY_NAMES_FULL,
  addDays,
  atMidnight,
} from "./calendar-dates";

export type ViewType = "day" | "week" | "month" | "agenda";
export type ViewRange = { start: Date; end: Date; label: string };

/**
 * Adds (or subtracts) whole calendar months, keeping the same day-of-month when
 * possible. If the target month is shorter (e.g. Jan 31 + 1 month), clamps to the
 * target month's last day instead of rolling over into the following month.
 */
function addMonths(date: Date, months: number): Date {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + months;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(date.getDate(), lastDayOfTargetMonth);
  return new Date(targetYear, targetMonth, day);
}

function formatFullDayLabel(date: Date): string {
  const weekday = WEEKDAY_NAMES_FULL[date.getDay()];
  const month = MONTH_NAMES_FULL[date.getMonth()];
  return `${weekday}, ${month} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatMonthYearLabel(date: Date): string {
  return `${MONTH_NAMES_FULL[date.getMonth()]} ${date.getFullYear()}`;
}

/** "MMMM D–D, YYYY" — start and last inclusive day share a calendar month. */
function formatSameMonthLabel(start: Date, lastInclusiveDay: Date): string {
  return `${MONTH_NAMES_FULL[start.getMonth()]} ${start.getDate()}–${lastInclusiveDay.getDate()}, ${start.getFullYear()}`;
}

/** "MMM D – MMM D, YYYY" — start and last inclusive day fall in different months. */
function formatCrossMonthLabel(start: Date, lastInclusiveDay: Date): string {
  return `${MONTH_NAMES_SHORT[start.getMonth()]} ${start.getDate()} – ${
    MONTH_NAMES_SHORT[lastInclusiveDay.getMonth()]
  } ${lastInclusiveDay.getDate()}, ${lastInclusiveDay.getFullYear()}`;
}

/**
 * Picks the week-label format: compact "MMMM D–D, YYYY" when the range's start
 * and (exclusive) end fall in the same calendar month, otherwise the cross-month
 * "MMM D – MMM D, YYYY" form built from the start and the last inclusive day.
 */
function formatWeekLabel(start: Date, end: Date): string {
  const lastInclusiveDay = addDays(end, -1);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  return sameMonth ? formatSameMonthLabel(start, lastInclusiveDay) : formatCrossMonthLabel(start, lastInclusiveDay);
}

/** Agenda always uses the cross-month-style label, even when it stays within one month. */
function formatAgendaLabel(start: Date, end: Date): string {
  const lastInclusiveDay = addDays(end, -1);
  return formatCrossMonthLabel(start, lastInclusiveDay);
}

export function getViewRange(view: ViewType, referenceDate: Date): ViewRange {
  const reference = atMidnight(referenceDate);

  switch (view) {
    case "day": {
      const start = reference;
      const end = addDays(reference, 1);
      return { start, end, label: formatFullDayLabel(start) };
    }
    case "week": {
      const start = addDays(reference, -reference.getDay());
      const end = addDays(start, 7);
      return { start, end, label: formatWeekLabel(start, end) };
    }
    case "month": {
      const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
      const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
      return { start, end, label: formatMonthYearLabel(start) };
    }
    case "agenda": {
      const start = reference;
      const end = addDays(reference, 14);
      return { start, end, label: formatAgendaLabel(start, end) };
    }
  }
}

export function navigateDate(view: ViewType, referenceDate: Date, direction: "prev" | "next"): Date {
  const sign = direction === "next" ? 1 : -1;
  const reference = atMidnight(referenceDate);

  switch (view) {
    case "day":
      return addDays(reference, sign);
    case "week":
      return addDays(reference, sign * 7);
    case "month":
      return addMonths(reference, sign);
    case "agenda":
      return addDays(reference, sign * 14);
  }
}
