"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { EventActionInput } from "@/lib/actions/calendar-events";
import { updateEventAction } from "@/lib/actions/calendar-events";
import type { TaskActionInput } from "@/lib/actions/calendar-tasks";
import { updateTaskAction } from "@/lib/actions/calendar-tasks";
import type { CalendarColorToken } from "@/lib/calendar-colors";
import {
  WEEKDAY_NAMES_UPPER,
  formatDateParam,
  formatTimeLabel,
  fractionalHour,
  isSameLocalDay,
  localParts,
} from "@/lib/calendar-dates";
import {
  hourFromDropOffset,
  moveEventToSlot,
  moveTaskToSlot,
  shiftEventToDay,
  withoutEventClobberFields,
} from "@/lib/calendar-drag";
import { calendarTaskToEditorInitial, googleEventToEditorInitial } from "@/lib/calendar-event-task-mapping";
import {
  GRID_END_HOUR,
  GRID_START_HOUR,
  HOUR_ROW_HEIGHT,
  getAllDayEvents,
  layoutTimedEvents,
} from "@/lib/calendar-layout";
import { resolveEventColorToken } from "@/lib/calendar-event-colors";
import { layoutColumns, type ColumnedGridItem, type PositionedGridItem } from "@/lib/calendar-overlap";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { TaskCheckbox } from "./TaskCheckbox";

/**
 * What's currently being dragged in this grid — tracked once at the
 * `HourGrid` level (not per-row) so a task picked up from the all-day row or
 * the timed grid can be dropped into either lane. `grabDay` is the day whose
 * *cell* the drag actually started from — a multi-day all-day event renders
 * a chip in every day it spans, so this is not always the event's own start
 * day, and `shiftEventToDay` needs the real grab point to nudge the event by
 * the gesture's actual day delta instead of re-anchoring its start on the
 * drop target. Unused by the timed-grid path (`moveEventToSlot`), where an
 * event only ever renders in its own single day.
 */
type DragPayload =
  | { kind: "event"; event: GoogleCalendarEvent; grabDay: Date }
  | { kind: "task"; task: CalendarTaskItem };

/** The fixed set of hour rows shown on the grid, e.g. [7, 8, ..., 21] for the default 7 AM–10 PM window. */
const GRID_HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

/** Formats an hour-of-day (0-23) as a grid row label, e.g. 7 -> "7 AM", 12 -> "12 PM". */
function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

/** Horizontal gutter (px) between two side-by-side columns, so overlapping blocks never render edge-to-edge. */
const COLUMN_GUTTER_PX = 4;

/**
 * Tasks due on `day` with a `dueTime`, positioned into the same tagged
 * timed-block shape events use, so both can be fed through `layoutColumns`
 * as one combined list. Since tasks have no duration, each gets a fixed
 * 30-minute-tall block (`HOUR_ROW_HEIGHT * 0.5`) rather than a computed
 * height.
 *
 * A task whose `dueTime` falls outside the grid's fixed [GRID_START_HOUR,
 * GRID_END_HOUR) window is excluded (not clamped) per the v1 fixed-window
 * limitation, matching `layoutTimedEvents`'s own out-of-window exclusion for
 * events — so such a task doesn't render in Day/Week view at all (unlike a
 * task with no `dueTime` set, which still shows in the all-day row).
 */
function layoutTimedTasks(tasks: CalendarTaskItem[], day: Date): PositionedGridItem[] {
  const dayParam = formatDateParam(day);
  const positioned: PositionedGridItem[] = [];

  for (const task of tasks) {
    if (task.dueDate !== dayParam || !task.dueTime) {
      continue;
    }

    const [hourStr, minuteStr] = task.dueTime.split(":");
    const hour = Number(hourStr) + Number(minuteStr) / 60;
    if (hour < GRID_START_HOUR || hour >= GRID_END_HOUR) {
      continue;
    }

    positioned.push({
      kind: "task",
      item: task,
      top: (hour - GRID_START_HOUR) * HOUR_ROW_HEIGHT,
      height: HOUR_ROW_HEIGHT * 0.5,
    });
  }

  return positioned;
}

/**
 * Every timed block on `day` — events and tasks alike — laid out through one
 * `layoutColumns` pass so a task and an event sharing a time slot end up in
 * side-by-side columns instead of the task painting opaquely over the event
 * (which is what a separate, later-in-DOM-order task pass used to do).
 */
function layoutTimedBlocks(
  events: GoogleCalendarEvent[],
  tasks: CalendarTaskItem[],
  day: Date,
): ColumnedGridItem[] {
  const timedEvents: PositionedGridItem[] = layoutTimedEvents(events, day).map(({ event, top, height }) => ({
    kind: "event",
    item: event,
    top,
    height,
  }));

  return layoutColumns([...timedEvents, ...layoutTimedTasks(tasks, day)]);
}

/**
 * Inline `left`/`width` for a block's column assignment. Only overlapping
 * blocks (`columnCount > 1`) need it — a lone block keeps the CSS default
 * (full-width minus `.wg-event`'s small `left`/`right` inset). Each column's
 * width loses `COLUMN_GUTTER_PX` so adjacent columns keep a visible seam.
 */
function columnStyleFor(column: number, columnCount: number) {
  if (columnCount <= 1) {
    return {};
  }

  return {
    left: `${(column / columnCount) * 100}%`,
    width: `calc(${100 / columnCount}% - ${COLUMN_GUTTER_PX}px)`,
    right: "auto" as const,
  };
}

/** Tasks due on `day` with no `dueTime` — these render in the `.wg-allday` row alongside all-day event chips. */
function getAllDayTasks(tasks: CalendarTaskItem[], day: Date): CalendarTaskItem[] {
  const dayParam = formatDateParam(day);
  return tasks.filter((task) => task.dueDate === dayParam && !task.dueTime);
}

/**
 * Shared hour-grid presentation for both Day (1-element `days`) and Week
 * (7-element `days`) views, porting the mockup's `.week-grid`/`.day-grid`
 * markup. `events` is the flat, unfiltered list for the whole visible range;
 * this component calls `layoutTimedEvents`/`getAllDayEvents` itself, once per
 * entry in `days`, to compute each column's content.
 *
 * Color mapping: rather than collapsing the six `CalendarColorToken` values
 * down to the mockup's two example classes (`.wg-event.pers`/`.work`),
 * `app/globals.css` was extended with one modifier class per token
 * (`.wg-event.cal`/`.wk`/`.rem`/`.note`/`.jour`/`.cv`, and the `.wg-chip`
 * equivalents), each keyed to that token's existing `--*-bg`/`--*-ink`/
 * `--*-accent` custom properties. That lets the token string returned by
 * `resolveEventColorToken` be used directly as the CSS class name below —
 * which is the event's own `colorId` override when it has one, and its
 * calendar's assigned color otherwise (see lib/calendar-event-colors.ts).
 */
export function HourGrid({
  days,
  events,
  tasks = [],
  colorByCalendar,
  today,
}: {
  days: Date[];
  events: GoogleCalendarEvent[];
  tasks?: CalendarTaskItem[];
  colorByCalendar: Record<string, CalendarColorToken>;
  today: Date;
}) {
  const gridClassName = days.length === 1 ? "day-grid" : "week-grid";
  const now = new Date();
  const { openCreate, openEditEvent, openEditTask } = useCalendarInteraction();
  const router = useRouter();
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  // The quarter-hour slot the pointer is currently over in the timed grid —
  // native HTML5 drag can't be made to snap the dragged block's own ghost
  // image (that's rendered by the browser, outside JS's reach), so this
  // drives a separate indicator line instead: the practical equivalent of
  // "always know what time you're about to drop on" without fighting the
  // platform. `null` whenever the pointer isn't over a timed column.
  const [dragPreviewHour, setDragPreviewHour] = useState<number | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  async function handleAllDayDrop(day: Date) {
    setDragOverKey(null);
    const payload = dragPayload;
    setDragPayload(null);
    if (!payload) {
      return;
    }

    if (payload.kind === "event") {
      // Events never cross lanes: a timed event dropped on the all-day row is not a valid target.
      if (payload.event.start.dateTime) {
        return;
      }
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
      // Already an all-day task on this same day — no change to make.
      if (payload.task.dueDate === formatDateParam(day) && payload.task.dueTime === null) {
        return;
      }
      const mapped = calendarTaskToEditorInitial(payload.task) as TaskActionInput & { taskId: string };
      try {
        await updateTaskAction({ ...mapped, ...moveTaskToSlot(payload.task, day, null) });
        setDragError(null);
        router.refresh();
      } catch {
        setDragError("Couldn't reschedule that task.");
      }
    }
  }

  async function handleTimedDrop(day: Date, offsetY: number) {
    setDragOverKey(null);
    const payload = dragPayload;
    setDragPayload(null);
    if (!payload) {
      return;
    }

    const targetHour = hourFromDropOffset(offsetY);

    if (payload.kind === "event") {
      // Events never cross lanes: an all-day event dropped on the timed grid is not a valid target.
      if (!payload.event.start.dateTime) {
        return;
      }
      const mapped = googleEventToEditorInitial(payload.event) as EventActionInput & { eventId: string };
      try {
        await updateEventAction({
          ...withoutEventClobberFields(mapped),
          ...moveEventToSlot(payload.event, day, targetHour),
        });
        setDragError(null);
        router.refresh();
      } catch {
        setDragError("Couldn't reschedule that event.");
      }
    } else {
      const mapped = calendarTaskToEditorInitial(payload.task) as TaskActionInput & { taskId: string };
      try {
        await updateTaskAction({ ...mapped, ...moveTaskToSlot(payload.task, day, targetHour) });
        setDragError(null);
        router.refresh();
      } catch {
        setDragError("Couldn't reschedule that task.");
      }
    }
  }

  return (
    <>
      {dragError && (
        <div className="error-block" role="alert">
          {dragError}
          <button type="button" onClick={() => setDragError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div
        className={gridClassName}
        onDragLeave={(event) => {
          // Only clear when the pointer has actually left the whole grid —
          // checked via relatedTarget containment, not this event firing at
          // all, since dragleave also fires on every internal child boundary
          // crossed (see the dragover comments below). Without this check,
          // dragging out through the hour-label gutter or past the last
          // column would otherwise leave the previous column's indicator
          // stuck on screen with nothing left to clear it.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragOverKey(null);
            setDragPreviewHour(null);
          }
        }}
      >
      <div className="wg-corner" />

      {days.map((day, index) => (
        <div
          key={day.getTime()}
          className={isSameLocalDay(day, today) ? "wg-day-head today" : "wg-day-head"}
          style={{ gridColumn: index + 2 }}
        >
          <span className="dow">{WEEKDAY_NAMES_UPPER[day.getDay()]}</span>
          <span className="num">{day.getDate()}</span>
        </div>
      ))}

      {days.map((day, index) => {
        const alldayKey = `${day.getTime()}-allday`;
        return (
          <div
            key={day.getTime()}
            className={dragOverKey === alldayKey ? "wg-allday drag-over" : "wg-allday"}
            data-testid="wg-allday"
            style={{ gridColumn: index + 2 }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              // Set here, not on dragenter/dragleave: those fire on every child
              // boundary the pointer crosses (any event chip or task inside this
              // row counts as a "child"), not just on truly entering/leaving the
              // row, so deriving this from the steadily-bubbling dragover instead
              // is what keeps the highlight from flickering as the pointer moves
              // across the row's contents.
              setDragOverKey(alldayKey);
            }}
            onDrop={(event) => {
              event.preventDefault();
              void handleAllDayDrop(day);
            }}
          >
            {getAllDayEvents(events, day).map((event) => {
              const colorToken = resolveEventColorToken(event, colorByCalendar);
              return (
                <span
                  key={event.id}
                  className={`wg-chip ${colorToken}`}
                  draggable
                  onDragStart={(dragEvent) => {
                    dragEvent.dataTransfer.setData("text/plain", event.id);
                    dragEvent.dataTransfer.effectAllowed = "move";
                    setDragPayload({ kind: "event", event, grabDay: day });
                  }}
                  onDragEnd={() => {
                    setDragPayload(null);
                    setDragPreviewHour(null);
                  }}
                  onClick={() => openEditEvent(event)}
                >
                  {event.summary}
                </span>
              );
            })}
            {getAllDayTasks(tasks, day).map((task) => (
              <TaskCheckbox
                key={task.id}
                task={task}
                onTitleClick={openEditTask}
                draggable
                onDragStart={(dragEvent) => {
                  dragEvent.dataTransfer.setData("text/plain", task.id);
                  dragEvent.dataTransfer.effectAllowed = "move";
                  setDragPayload({ kind: "task", task });
                }}
                onDragEnd={() => {
                    setDragPayload(null);
                    setDragPreviewHour(null);
                  }}
              />
            ))}
          </div>
        );
      })}

      {GRID_HOURS.map((hour) => (
        <div key={hour} className="wg-hour">
          {formatHourLabel(hour)}
        </div>
      ))}

      {days.map((day, index) => {
        const isToday = isSameLocalDay(day, today);
        // `now` is a real "now" read in the rendering runtime, so its
        // runtime-local wall clock is the intended frame — unlike an event's
        // `dateTime`, which carries its own offset (see calendar-dates.ts).
        const nowTop = isToday ? (fractionalHour(localParts(now)) - GRID_START_HOUR) * HOUR_ROW_HEIGHT : null;

        const colKey = `${day.getTime()}-timed`;

        return (
          <div
            key={day.getTime()}
            className={dragOverKey === colKey ? "wg-col drag-over" : "wg-col"}
            data-testid="wg-col"
            style={{ gridColumn: index + 2 }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              // Both set here, not on dragenter/dragleave: this column has 15
              // stacked `.wg-line` rows plus event/task blocks as children, and
              // dragenter/dragleave fire on every one of those child boundaries
              // the pointer crosses — not just on truly entering/leaving the
              // column — so tracking "entered" that way made the indicator (and
              // the highlight) flicker constantly while dragging through the
              // column's own contents. dragover bubbles up through children
              // reliably instead, so it's the only source of truth here.
              setDragOverKey(colKey);
              const offsetY = event.clientY - event.currentTarget.getBoundingClientRect().top;
              setDragPreviewHour(hourFromDropOffset(offsetY));
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragPreviewHour(null);
              const offsetY = event.clientY - event.currentTarget.getBoundingClientRect().top;
              void handleTimedDrop(day, offsetY);
            }}
          >
            {GRID_HOURS.map((hour) => (
              <div key={hour} className="wg-line" onClick={() => openCreate("event", day, hour)} />
            ))}

            {dragOverKey === colKey && dragPreviewHour !== null && (
              <div
                className="wg-drop-indicator"
                style={{ top: (dragPreviewHour - GRID_START_HOUR) * HOUR_ROW_HEIGHT }}
              />
            )}

            {/* Events and timed tasks come out of one combined layout pass,
                so each gets a real column instead of tasks stacking on top of
                whatever event shares their slot. `kind` routes each to its
                own markup. */}
            {layoutTimedBlocks(events, tasks, day).map((block) => {
              const blockStyle = { top: block.top, height: block.height, ...columnStyleFor(block.column, block.columnCount) };

              if (block.kind === "task") {
                return (
                  <div key={`task-${block.item.id}`} className="wg-event wg-task" style={blockStyle}>
                    <TaskCheckbox
                      task={block.item}
                      onTitleClick={openEditTask}
                      draggable
                      onDragStart={(dragEvent) => {
                        dragEvent.dataTransfer.setData("text/plain", block.item.id);
                        dragEvent.dataTransfer.effectAllowed = "move";
                        setDragPayload({ kind: "task", task: block.item });
                      }}
                      onDragEnd={() => {
                    setDragPayload(null);
                    setDragPreviewHour(null);
                  }}
                    />
                  </div>
                );
              }

              const event = block.item;
              const colorToken = resolveEventColorToken(event, colorByCalendar);
              return (
                <div
                  key={`event-${event.id}`}
                  className={`wg-event ${colorToken}`}
                  style={blockStyle}
                  draggable
                  onDragStart={(dragEvent) => {
                    dragEvent.dataTransfer.setData("text/plain", event.id);
                    dragEvent.dataTransfer.effectAllowed = "move";
                    setDragPayload({ kind: "event", event, grabDay: day });
                  }}
                  onDragEnd={() => {
                    setDragPayload(null);
                    setDragPreviewHour(null);
                  }}
                  onClick={() => openEditEvent(event)}
                >
                  <span className="et">{event.summary}</span>
                  {/* layoutTimedEvents only returns events with a timed start, so dateTime is non-null. */}
                  <span className="es">{formatTimeLabel(event.start.dateTime as string)}</span>
                </div>
              );
            })}

            {nowTop !== null && <div className="wg-now" style={{ top: nowTop }} />}
          </div>
        );
      })}
      </div>
    </>
  );
}
