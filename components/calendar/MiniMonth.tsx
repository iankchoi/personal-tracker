const MONTH_NAMES_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Normalizes a Date to local midnight, discarding any time-of-day component. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Adds (or subtracts, for negative counts) whole days using local-calendar arithmetic. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Builds the grid of weeks (each a 7-element array of Dates) covering the
 * calendar month that `referenceDate` falls in, padded with the trailing
 * days of the previous month and the leading days of the next month so every
 * week row has exactly 7 cells. The number of rows varies (4-6) depending on
 * how the month's days align with the week grid — not hardcoded to 5.
 */
function buildWeeks(referenceDate: Date): Date[][] {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const totalCells = monthStart.getDay() + daysInMonth;
  const weekCount = Math.ceil(totalCells / 7);

  const weeks: Date[][] = [];
  for (let week = 0; week < weekCount; week++) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day++) {
      days.push(addDays(gridStart, week * 7 + day));
    }
    weeks.push(days);
  }
  return weeks;
}

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
        {DOW_LETTERS.map((letter, index) => (
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
