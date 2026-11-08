"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { updateEventAction } from "@/lib/actions/calendar-events";
import { updateTaskAction } from "@/lib/actions/calendar-tasks";
import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  WEEKDAY_NAMES_UPPER,
  buildWeeks,
  formatDateParam,
  formatTimeLabel,
  isSameLocalDay,
  isSameLocalMonth,
} from "@/lib/calendar-dates";
import type { EventActionInput } from "@/lib/actions/calendar-events";
import type { TaskActionInput } from "@/lib/actions/calendar-tasks";
import { getEventsForDay, getTasksForDay } from "@/lib/calendar-day-items";
import { shiftEventToDay, shiftTaskToDay, withoutEventClobberFields } from "@/lib/calendar-drag";
import { calendarTaskToEditorInitial, googleEventToEditorInitial } from "@/lib/calendar-event-task-mapping";
import { resolveEventColorToken } from "@/lib/calendar-event-colors";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { TaskCheckbox } from "./TaskCheckbox";

/**
 * What's currently being dragged, set on `dragstart` and read back on
 * `drop` — native HTML5 DnD carries no typed payload of its own, so this
 * app-level state stands in for `dataTransfer`. `grabDay` is the day whose
 * *cell* the drag actually started from — a multi-day all-day event renders
 * a chip in every day it spans, so this is not always the event's own start
 * day, and `shiftEventToDay` needs the real grab point to nudge the event by
 * the gesture's actual day delta instead of re-anchoring its start on the
 * drop target.
 */
type DragPayload =
  | { kind: "event"; event: GoogleCalendarEvent; grabDay: Date }
  | { kind: "task"; task: CalendarTaskItem };

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
  const router = useRouter();
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  async function handleDrop(day: Date) {
    setDragOverDay(null);
    const payload = dragPayload;
    setDragPayload(null);
    if (!payload) {
      return;
    }

    if (payload.kind === "event") {
      if (isSameLocalDay(payload.grabDay, day)) {
        return;
      }
      const mapped = googleEventToEditorInitial(payload.event) as EventActionInput & { eventId: string };
      try {
        await updateEventAction({
          ...withoutEventClobberFields(mapped),
          ...shiftEventToDay(payload.event, payload.grabDay, day),
        });
        setDragError(null);
        router.refresh();
      } catch {
        setDragError("Couldn't reschedule that event.");
      }
    } else {
      if (formatDateParam(day) === payload.task.dueDate) {
        return;
      }
      const mapped = calendarTaskToEditorInitial(payload.task) as TaskActionInput & { taskId: string };
      try {
        await updateTaskAction({ ...mapped, ...shiftTaskToDay(payload.task, day) });
        setDragError(null);
        router.refresh();
      } catch {
        setDragError("Couldn't reschedule that task.");
      }
    }
  }

  return (
    <div className="month-grid">
      {dragError && (
        <div className="error-block" role="alert">
          {dragError}
          <button type="button" onClick={() => setDragError(null)}>
            Dismiss
          </button>
        </div>
      )}
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
              if (dragOverDay === day.getTime()) classes.push("drag-over");

              return (
                <div
                  className={classes.join(" ")}
                  key={day.getTime()}
                  onClick={() => openCreate("event", day)}
                  onDragEnter={() => setDragOverDay(day.getTime())}
                  onDragLeave={() => setDragOverDay((current) => (current === day.getTime() ? null : current))}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleDrop(day);
                  }}
                >
                  <span className="mg-date">{day.getDate()}</span>
                  {entries.length > 0 && (
                    // `stopPropagation` keeps a chip/task click from also
                    // bubbling up into the cell's own click-to-create
                    // handler above — the brief's "onClick on the cell
                    // background (not on its chips)".
                    <div className="mg-events" onClick={(event) => event.stopPropagation()}>
                      {visibleEntries.map((entry) => {
                        if (entry.kind === "task") {
                          return (
                            <TaskCheckbox
                              key={entry.task.id}
                              task={entry.task}
                              onTitleClick={openEditTask}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData("text/plain", entry.task.id);
                                event.dataTransfer.effectAllowed = "move";
                                setDragPayload({ kind: "task", task: entry.task });
                              }}
                              onDragEnd={() => setDragPayload(null)}
                            />
                          );
                        }
                        const colorToken = resolveEventColorToken(entry.event, colorByCalendar);
                        return (
                          <span
                            key={entry.event.id}
                            className={`mg-chip ${colorToken}`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", entry.event.id);
                              event.dataTransfer.effectAllowed = "move";
                              setDragPayload({ kind: "event", event: entry.event, grabDay: day });
                            }}
                            onDragEnd={() => setDragPayload(null)}
                            onClick={() => openEditEvent(entry.event)}
                          >
                            {entry.event.start.dateTime && (
                              <span className="mg-chip-time">{formatTimeLabel(entry.event.start.dateTime)}</span>
                            )}
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
