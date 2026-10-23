import type { CalendarColorToken } from "@/lib/calendar-colors";
import { addDays } from "@/lib/calendar-dates";
import { getViewRange } from "@/lib/calendar-ranges";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

import { HourGrid } from "./HourGrid";

/**
 * Week view: a thin composition layer deriving the 7 visible days from
 * `getViewRange("week", referenceDate)` and handing them to `HourGrid`.
 */
export function WeekView({
  referenceDate,
  events,
  colorByCalendar,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  colorByCalendar: Record<string, CalendarColorToken>;
}) {
  const { start } = getViewRange("week", referenceDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return <HourGrid days={days} events={events} colorByCalendar={colorByCalendar} today={new Date()} />;
}
