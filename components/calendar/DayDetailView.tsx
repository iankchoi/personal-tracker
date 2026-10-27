"use client";

import type { CalendarColorToken } from "@/lib/calendar-colors";
import { MONTH_NAMES_FULL, WEEKDAY_NAMES_FULL, formatTimeLabel } from "@/lib/calendar-dates";
import { getEventsForDay, getTasksForDay } from "@/lib/calendar-day-items";
import { resolveEventColorToken } from "@/lib/calendar-event-colors";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { TaskCheckbox } from "./TaskCheckbox";

/** The overlay's heading, e.g. "Saturday, October 24". */
function formatDayHeading(day: Date): string {
  return `${WEEKDAY_NAMES_FULL[day.getDay()]}, ${MONTH_NAMES_FULL[day.getMonth()]} ${day.getDate()}`;
}

/**
 * One day's complete events and tasks, opened from Month view's "+N more"
 * overflow summary — Google Calendar's own month-view behavior, where the
 * truncated cell is a door into the full day rather than a dead label.
 *
 * It deliberately reuses `AgendaView`'s `.rowcard` row shape (time / title /
 * color dot) rather than Month view's cramped `.mg-chip`: the point of
 * opening this is to *see* the items the cell couldn't fit, so each one gets a
 * full-width row with its start time spelled out. The trailing element is a
 * `.dd-dot` rather than Agenda's named `.src` pill because this overlay is
 * already scoped to one day and doesn't carry the calendar list — the dot
 * still shows the event's resolved color, which is the part a user is matching
 * against the month cell they just clicked. `getEventsForDay`/
 * `getTasksForDay` are the shared helpers Month and Agenda already bucket
 * with (lib/calendar-day-items.ts), so this list and the cell it opened from
 * can never disagree about which items belong to the day.
 *
 * Clicking a row calls `openEditEvent`/`openEditTask` for that item, which
 * replaces this popup session with the item's own editor in place. That
 * transition is safe because every opener bumps the provider's `sessionId` and
 * `EventTaskModal` keys its child on it, so the editor mounts fresh rather
 * than reusing whatever instance was rendered here (see
 * `EventTaskModal`'s "Why key={...sessionId}" note).
 *
 * Tasks render through the same `TaskCheckbox` the grid uses, so a task can be
 * checked off directly from this list; its title click is what opens the task
 * editor.
 */
export function DayDetailView({
  date,
  events,
  tasks,
  colorByCalendar,
}: {
  date: Date;
  events: GoogleCalendarEvent[];
  tasks: CalendarTaskItem[];
  colorByCalendar: Record<string, CalendarColorToken>;
}) {
  const { openEditEvent, openEditTask } = useCalendarInteraction();
  const dayEvents = getEventsForDay(events, date);
  const dayTasks = getTasksForDay(tasks, date);

  return (
    <div className="day-detail" role="dialog" aria-label={`Events and tasks on ${formatDayHeading(date)}`}>
      <h2 className="dd-heading">{formatDayHeading(date)}</h2>

      {dayEvents.length === 0 && dayTasks.length === 0 ? (
        <div className="empty-block">Nothing scheduled.</div>
      ) : (
        <div className="cards">
          {dayEvents.map((event) => {
            const colorToken = resolveEventColorToken(event, colorByCalendar);
            const timeLabel = event.start.dateTime ? formatTimeLabel(event.start.dateTime) : "All day";

            return (
              <div className="rowcard" key={event.id} onClick={() => openEditEvent(event)}>
                <span className="time">{timeLabel}</span>
                <span className="title">{event.summary}</span>
                <span className={`dd-dot ${colorToken}`} />
              </div>
            );
          })}
          {dayTasks.map((task) => (
            <TaskCheckbox key={task.id} task={task} onTitleClick={openEditTask} />
          ))}
        </div>
      )}
    </div>
  );
}
