import {
  MONTH_NAMES_FULL,
  WEEKDAY_LETTERS,
  atMidnight,
  buildWeeks,
  isSameLocalDay,
  isSameLocalMonth,
} from "@/lib/calendar-dates";

/**
 * Shared mini-month calendar, ported from the mockup's `.mini-month` markup.
 * Reused by Day view (Task 8, no `inRangeStart`/`inRangeEnd`) and Agenda view
 * (Task 10, with its own 14-day `inRangeStart`/`inRangeEnd`), so both range
 * props are genuinely optional and the component is correct without them.
 *
 * `today` is always the real current date (`new Date()`), independent of
 * `referenceDate`/`selectedDate` — it marks the `.mini-date.today` cell.
 * `selectedDate` marks the `.mini-date.selected` cell (the day the parent
 * view is currently showing, which may or may not be today).
 */
export function MiniMonth({
  referenceDate,
  selectedDate,
  inRangeStart,
  inRangeEnd,
}: {
  referenceDate: Date;
  selectedDate: Date;
  inRangeStart?: Date;
  inRangeEnd?: Date;
}) {
  const today = new Date();
  const weeks = buildWeeks(referenceDate);
  const rangeStart = inRangeStart ? atMidnight(inRangeStart) : null;
  const rangeEnd = inRangeEnd ? atMidnight(inRangeEnd) : null;

  function cellClassName(date: Date): string {
    const classes = ["mini-date"];
    if (!isSameLocalMonth(date, referenceDate)) classes.push("outside");
    if (isSameLocalDay(date, today)) classes.push("today");
    if (isSameLocalDay(date, selectedDate)) classes.push("selected");
    if (rangeStart && rangeEnd && date.getTime() >= rangeStart.getTime() && date.getTime() < rangeEnd.getTime()) {
      classes.push("inrange");
    }
    return classes.join(" ");
  }

  return (
    <div className="mini-month">
      <header>
        <h2>
          {MONTH_NAMES_FULL[referenceDate.getMonth()]} {referenceDate.getFullYear()}
        </h2>
        <div className="mini-nav">
          <button aria-label="Previous month" type="button">
            <svg viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button aria-label="Next month" type="button">
            <svg viewBox="0 0 24 24">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>
      <div className="mini-dow-row">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <div className="mini-dow" key={index}>
            {letter}
          </div>
        ))}
      </div>
      <div className="mini-weeks">
        {weeks.map((week) => (
          <div className="mini-week" key={week[0].getTime()}>
            {week.map((date) => (
              <span key={date.getTime()} className={cellClassName(date)}>
                {date.getDate()}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
