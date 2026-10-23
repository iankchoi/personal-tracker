import type { CalendarColorToken } from "@/lib/calendar-colors";
import { addDays } from "@/lib/calendar-dates";
import { getViewRange } from "@/lib/calendar-ranges";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import { HourGrid } from "./HourGrid";

/**
 * Week view: a thin composition layer deriving the 7 visible days from
 * `getViewRange("week", referenceDate)` and handing them to `HourGrid`.
 *
 * `tasks` is threaded through to `HourGrid` as of Task 7, which buckets it
 * by day itself (same "pass the flat list, let the grid re-bucket" shape
 * `events` already uses). `taskLists` is still unused here — nothing in
 * Week view needs the list metadata itself, only the tasks.
 */
export function WeekView({
  referenceDate,
  events,
  tasks,
  colorByCalendar,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  colorByCalendar: Record<string, CalendarColorToken>;
  tasks?: CalendarTaskItem[];
  taskLists?: GoogleTaskList[];
}) {
  const { start } = getViewRange("week", referenceDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return <HourGrid days={days} events={events} tasks={tasks} colorByCalendar={colorByCalendar} today={new Date()} />;
}
