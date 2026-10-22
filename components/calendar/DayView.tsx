import type { CalendarColorToken } from "@/lib/calendar-colors";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";

import { CalendarsLegend } from "./CalendarsLegend";
import { HourGrid } from "./HourGrid";
import { MiniMonth } from "./MiniMonth";
import { UpNext } from "./UpNext";

/**
 * Day view: `.day-layout` pairing a single-day `HourGrid` column with a
 * `.day-rail` (`MiniMonth`, `UpNext`, `CalendarsLegend`) so the view never
 * leaves the canvas looking empty next to one day's events.
 *
 * `MiniMonth` is used here without `inRangeStart`/`inRangeEnd` — Day view has
 * no multi-day range to highlight, only the single `selectedDate` (the day
 * being viewed, passed as both `referenceDate` and `selectedDate`).
 */
export function DayView({
  referenceDate,
  events,
  calendars,
  colorByCalendar,
  upcoming,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  calendars: GoogleCalendarListEntry[];
  colorByCalendar: Record<string, CalendarColorToken>;
  upcoming: GoogleCalendarEvent[];
}) {
  return (
    <div className="day-layout">
      <HourGrid days={[referenceDate]} events={events} colorByCalendar={colorByCalendar} today={new Date()} />
      <div className="day-rail">
        <MiniMonth referenceDate={referenceDate} selectedDate={referenceDate} />
        <UpNext upcoming={upcoming} />
        <CalendarsLegend calendars={calendars} colorByCalendar={colorByCalendar} />
      </div>
    </div>
  );
}
