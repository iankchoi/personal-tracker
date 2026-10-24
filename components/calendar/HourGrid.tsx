"use client";

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
  GRID_END_HOUR,
  GRID_START_HOUR,
  HOUR_ROW_HEIGHT,
  getAllDayEvents,
  layoutTimedEvents,
} from "@/lib/calendar-layout";
import { layoutColumns, type ColumnedGridItem, type PositionedGridItem } from "@/lib/calendar-overlap";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

import { useCalendarInteraction } from "./CalendarInteractionProvider";
import { TaskCheckbox } from "./TaskCheckbox";

/** The fixed set of hour rows shown on the grid, e.g. [7, 8, ..., 21] for the default 7 AM–10 PM window. */
const GRID_HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

/** Fallback color token used if a rendered event's calendarId is somehow missing from colorByCalendar. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

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
 * `colorByCalendar` be used directly as the CSS class name below.
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

  return (
    <div className={gridClassName}>
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

      {days.map((day, index) => (
        <div key={day.getTime()} className="wg-allday" style={{ gridColumn: index + 2 }}>
          {getAllDayEvents(events, day).map((event) => {
            const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
            return (
              <span key={event.id} className={`wg-chip ${colorToken}`} onClick={() => openEditEvent(event)}>
                {event.summary}
              </span>
            );
          })}
          {getAllDayTasks(tasks, day).map((task) => (
            <TaskCheckbox key={task.id} task={task} onTitleClick={openEditTask} />
          ))}
        </div>
      ))}

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

        return (
          <div key={day.getTime()} className="wg-col" style={{ gridColumn: index + 2 }}>
            {GRID_HOURS.map((hour) => (
              <div key={hour} className="wg-line" onClick={() => openCreate("event", day, hour)} />
            ))}

            {/* Events and timed tasks come out of one combined layout pass,
                so each gets a real column instead of tasks stacking on top of
                whatever event shares their slot. `kind` routes each to its
                own markup. */}
            {layoutTimedBlocks(events, tasks, day).map((block) => {
              const blockStyle = { top: block.top, height: block.height, ...columnStyleFor(block.column, block.columnCount) };

              if (block.kind === "task") {
                return (
                  <div key={`task-${block.item.id}`} className="wg-event wg-task" style={blockStyle}>
                    <TaskCheckbox task={block.item} onTitleClick={openEditTask} />
                  </div>
                );
              }

              const event = block.item;
              const colorToken = colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
              return (
                <div
                  key={`event-${event.id}`}
                  className={`wg-event ${colorToken}`}
                  style={blockStyle}
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
  );
}
