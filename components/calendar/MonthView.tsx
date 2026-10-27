"use client";

import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  WEEKDAY_NAMES_UPPER,
  buildWeeks,
  isSameLocalDay,
  isSameLocalMonth,
} from "@/lib/calendar-dates";
import { getEventsForDay, getTasksForDay } from "@/lib/calendar-day-items";
import { resolveEventColorToken } from "@/lib/calendar-event-colors";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { TaskCheckbox } from "./TaskCheckbox";

/** Maximum number of event chips shown per cell before collapsing into a "+N more" summary. Tasks count as chips too. */
const MAX_VISIBLE_CHIPS = 3;

/** A cell's event chips and task checkboxes merged into one orderable list, so overflow counting (`MAX_VISIBLE_CHIPS`) treats both uniformly. */
type DayEntry = { kind: "event"; event: GoogleCalendarEvent } | { kind: "task"; task: CalendarTaskItem };

/**
 * Month view: ports the mockup's `.month-grid`/`.mg-dow-row`/`.mg-weeks`/
 * `.mg-week`/`.mg-cell` markup. Leading/trailing days from adjacent months
 * are rendered grayed-out (`.mg-cell.outside`) rather than left empty, and
 * each cell caps its visible event chips at `MAX_VISIBLE_CHIPS`, collapsing
 * any remainder into a `.mg-more` "+N more" button that opens the day-detail
 * overlay (`openDayDetail`) listing that day's complete events and tasks —
 * Google Calendar's own month-view behavior. It was display-only under the
 * original read-only scope.
 *
 * Color mapping follows Task 7/8's precedent: `app/globals.css` already
 * defines one `.mg-chip` modifier class per `CalendarColorToken`
 * (`.mg-chip.cal`/`.wk`/`.rem`/`.note`/`.jour`/`.cv`), so the token string
 * returned by `resolveEventColorToken` — the event's own `colorId` override
 * when it has one, its calendar's assigned color otherwise — is used directly
 * as the chip's class name.
 *
 * `tasks` due on each day are merged into that same cell (after its event
 * chips, per Task 7's "implementer's call" on ordering) and rendered via
 * `TaskCheckbox`, counting toward the same `MAX_VISIBLE_CHIPS` cap and "+N
 * more" overflow as events — see the shared `DayEntry` type above.
 * `taskLists` is still unused here — nothing in Month view needs the list
 * metadata itself, only the tasks.
 */
export function MonthView({
  referenceDate,
  events,
  tasks = [],
  colorByCalendar,
  today,
}: {
  referenceDate: Date;
  events: GoogleCalendarEvent[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
  tasks?: CalendarTaskItem[];
  taskLists?: GoogleTaskList[];
}) {
  const weeks = buildWeeks(referenceDate);
  const { openCreate, openDayDetail, openEditEvent, openEditTask } = useCalendarInteraction();

  return (
    <div className="month-grid">
      <div className="mg-dow-row">
        {WEEKDAY_NAMES_UPPER.map((name) => (
          <div className="mg-dow" key={name}>
            {name}
          </div>
        ))}
      </div>
      <div className="mg-weeks" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week) => (
          <div className="mg-week" key={week[0].getTime()}>
            {week.map((day) => {
              const dayEvents = getEventsForDay(events, day);
              const dayTasks = getTasksForDay(tasks, day);
              const entries: DayEntry[] = [
                ...dayEvents.map((event): DayEntry => ({ kind: "event", event })),
                ...dayTasks.map((task): DayEntry => ({ kind: "task", task })),
              ];
              const visibleEntries = entries.slice(0, MAX_VISIBLE_CHIPS);
              const overflowCount = entries.length - visibleEntries.length;

              const classes = ["mg-cell"];
              if (!isSameLocalMonth(day, referenceDate)) classes.push("outside");
              if (isSameLocalDay(day, today)) classes.push("today");

              return (
                <div className={classes.join(" ")} key={day.getTime()} onClick={() => openCreate("event", day)}>
                  <span className="mg-date">{day.getDate()}</span>
                  {entries.length > 0 && (
                    // `stopPropagation` keeps a chip/task click from also
                    // bubbling up into the cell's own click-to-create
                    // handler above — the brief's "onClick on the cell
                    // background (not on its chips)".
                    <div className="mg-events" onClick={(event) => event.stopPropagation()}>
                      {visibleEntries.map((entry) => {
                        if (entry.kind === "task") {
                          return <TaskCheckbox key={entry.task.id} task={entry.task} onTitleClick={openEditTask} />;
                        }
                        const colorToken = resolveEventColorToken(entry.event, colorByCalendar);
                        return (
                          <span
                            key={entry.event.id}
                            className={`mg-chip ${colorToken}`}
                            onClick={() => openEditEvent(entry.event)}
                          >
                            {entry.event.summary}
                          </span>
                        );
                      })}
                      {overflowCount > 0 && (
                        // A real <button>, not the original presentational
                        // <div>: it's now the entry point to the day-detail
                        // overlay, so it has to be keyboard-reachable and
                        // announced as a control. `type="button"` keeps it from
                        // ever submitting a form it might one day sit inside.
                        <button
                          type="button"
                          className="mg-more"
                          onClick={() => openDayDetail(day)}
                        >
                          +{overflowCount} more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
