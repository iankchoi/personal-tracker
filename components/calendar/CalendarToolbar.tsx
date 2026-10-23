"use client";

import { useRouter } from "next/navigation";

import { getViewRange, navigateDate, type ViewType } from "@/lib/calendar-ranges";

const VIEW_OPTIONS: { view: ViewType; label: string }[] = [
  { view: "day", label: "Day" },
  { view: "week", label: "Week" },
  { view: "month", label: "Month" },
  { view: "agenda", label: "Agenda" },
];

/** Formats a Date as the `date` search param's `YYYY-MM-DD` shape, in local time. */
function formatDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Ports the mockup's `.cal-toolbar` markup. This is a client component (not a
 * `<Link>`-based nav like Settings' tabs) because the mockup's toolbar is
 * built entirely from `<button>` elements — the `.segmented button[aria-pressed]`
 * and `.cal-nav button` CSS selectors in `app/globals.css` target the `button`
 * tag specifically, so an anchor-based implementation would silently lose the
 * active-state styling. Each control navigates by pushing a new `/calendar`
 * URL with updated `view`/`date` search params.
 */
export function CalendarToolbar({ view, date }: { view: ViewType; date: Date }) {
  const router = useRouter();
  const { label } = getViewRange(view, date);

  function go(nextView: ViewType, nextDate: Date) {
    router.push(`/calendar?view=${nextView}&date=${formatDateParam(nextDate)}`);
  }

  return (
    <div className="cal-toolbar">
      <h1>Calendar</h1>
      <div className="segmented" role="tablist">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.view}
            type="button"
            aria-pressed={view === option.view}
            onClick={() => go(option.view, date)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="cal-nav">
        <button
          type="button"
          aria-label={`Previous ${view}`}
          onClick={() => go(view, navigateDate(view, date, "prev"))}
        >
          <svg viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={`Next ${view}`}
          onClick={() => go(view, navigateDate(view, date, "next"))}
        >
          <svg viewBox="0 0 24 24">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="cal-range">{label}</div>
      <button type="button" className="cal-today" onClick={() => go(view, new Date())}>
        Today
      </button>
      <div className="cal-spacer" />
      <button className="cal-new" disabled>
        + New event
      </button>
    </div>
  );
}
