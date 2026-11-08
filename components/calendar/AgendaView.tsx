"use client";

import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  MONTH_NAMES_FULL,
  WEEKDAY_NAMES_FULL,
  addDays,
  formatTimeLabel,
  isSameLocalDay,
} from "@/lib/calendar-dates";
import { getEventsForDay, getTasksForDay } from "@/lib/calendar-day-items";
import { resolveEventColorToken } from "@/lib/calendar-event-colors";
import { getViewRange } from "@/lib/calendar-ranges";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import { CalendarsLegend } from "./CalendarsLegend";
import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { MiniMonth } from "./MiniMonth";
import { TaskCheckbox } from "./TaskCheckbox";

/** Length of the agenda window, matching `getViewRange("agenda", ...)` in lib/calendar-ranges.ts. */
const AGENDA_WINDOW_DAYS = 14;

/**
 * Agenda's day-group heading, matching the mockup: "Today"/"Tomorrow" for
 * those two days (relative to `today`, not `referenceDate` — a day group
 * reads "Today" only when it actually is today, even if the agenda window
 * has been navigated away from the current date), otherwise the day's full
 * weekday name (e.g. "Friday").
 */
function formatGroupLabel(day: Date, today: Date): string {
  if (isSameLocalDay(day, today)) return "Today";
  if (isSameLocalDay(day, addDays(today, 1))) return "Tomorrow";
  return WEEKDAY_NAMES_FULL[day.getDay()];
}

/**
 * Agenda's day-group `.sub` text. "Today"/"Tomorrow" groups pair with the
 * full "Weekday, Month Day" form (the weekday isn't otherwise shown); other
 * groups pair with the bare "Month Day" form, since their main label above
 * already names the weekday.
 */
function formatGroupSub(day: Date, today: Date): string {
  const monthDay = `${MONTH_NAMES_FULL[day.getMonth()]} ${day.getDate()}`;
  if (isSameLocalDay(day, today) || isSameLocalDay(day, addDays(today, 1))) {
    return `${WEEKDAY_NAMES_FULL[day.getDay()]}, ${monthDay}`;
  }
  return monthDay;
}

/**
 * Agenda view: ports the mockup's `.agenda-layout` — an `.agenda-col` of
 * `.agenda-group`s (one per day in the 14-day agenda window that has at
 * least one event; days with zero events are skipped entirely, matching the
 * mockup) paired with an `.agenda-rail` reusing `MiniMonth` (Task 8) and
 * `CalendarsLegend` (Task 8). Unlike Day/Week/Month, Agenda is a pure list
 * region with no grid to fall back on, so when every day in the window has
 * zero events, `.agenda-col` renders a single `.empty-block` in place of its
 * (otherwise empty) groups — the rail keeps rendering normally either way.
 *
 * `MiniMonth`'s `inRangeStart`/`inRangeEnd` are taken directly from
 * `getViewRange("agenda", referenceDate)` (lib/calendar-ranges.ts) so the
 * mini-month's highlighted range always matches the agenda's own window.
 *
 * Color mapping follows the same convention as `HourGrid`/`MonthView`:
 * `app/globals.css`'s `.src` modifier classes (`.src.cal`/`.wk`/`.rem`/
 * `.note`/`.jour`/`.cv`) are keyed one-to-one with `CalendarColorToken`
 * values, so the token string from `resolveEventColorToken` — the event's own
 * `colorId` override when it has one, its calendar's assigned color otherwise
 * — is used directly as the row's `.src` class name.
 *
 * `tasks` due on each day are merged into that same day's group (rendered
 * after its event rowcards, per Task 7's "implementer's call" on ordering)
 * via `TaskCheckbox`; a day with tasks but zero events is no longer skipped
 * (the original "skip empty days" filter now checks both). `taskLists` is
 * still unused here — nothing in Agenda view needs the list metadata
 * itself, only the tasks.
 */
export function AgendaView({
  referenceDate,
  events,
  tasks = [],
  calendars,
  colorByCalendar,
  today,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  calendars: GoogleCalendarListEntry[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
  tasks?: CalendarTaskItem[];
  taskLists?: GoogleTaskList[];
}) {
  const { openEditEvent, openEditTask } = useCalendarInteraction();
  const { start, end } = getViewRange("agenda", referenceDate);
  const days = Array.from({ length: AGENDA_WINDOW_DAYS }, (_, index) => addDays(start, index));
  const calendarNameById = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]));

  const groups = days
    .map((day) => ({ day, dayEvents: getEventsForDay(events, day), dayTasks: getTasksForDay(tasks, day) }))
    .filter(({ dayEvents, dayTasks }) => dayEvents.length > 0 || dayTasks.length > 0);

  return (
    <div className="agenda-layout">
      <div className="agenda-col">
        {groups.length === 0 ? (
          <div className="empty-block">No events or tasks scheduled for the next 14 days.</div>
        ) : (
          groups.map(({ day, dayEvents, dayTasks }) => (
            <div className="agenda-group" key={day.getTime()}>
              <div className="agenda-date">
                {formatGroupLabel(day, today)}
                <span className="sub">{formatGroupSub(day, today)}</span>
              </div>
              <div className="cards">
                {dayEvents.map((event) => {
                  const colorToken = resolveEventColorToken(event, colorByCalendar);
                  const timeLabel = event.start.dateTime ? formatTimeLabel(event.start.dateTime) : "All day";
                  const calendarName = calendarNameById.get(event.calendarId) ?? "";

                  return (
                    <div className="rowcard" key={event.id} onClick={() => openEditEvent(event)}>
                      <span className="time">{timeLabel}</span>
                      <span className="title">{event.summary}</span>
                      <span className={`src ${colorToken}`}>{calendarName}</span>
                    </div>
                  );
                })}
                {dayTasks.map((task) => (
                  <TaskCheckbox key={task.id} task={task} onTitleClick={openEditTask} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="agenda-rail">
        <MiniMonth referenceDate={referenceDate} selectedDate={referenceDate} inRangeStart={start} inRangeEnd={end} />
        <CalendarsLegend calendars={calendars} colorByCalendar={colorByCalendar} />
      </div>
    </div>
  );
}
