import { expect, test } from "vitest";

import {
  hourFromDropOffset,
  moveEventToSlot,
  moveTaskToSlot,
  shiftEventToDay,
  shiftTaskToDay,
} from "../../lib/calendar-drag";
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_ROW_HEIGHT } from "../../lib/calendar-layout";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "../../lib/google-calendar";

function timedEvent({ start, end }: { start: string; end: string }): GoogleCalendarEvent {
  return { id: "e1", calendarId: "primary", summary: "Event", start: { dateTime: start }, end: { dateTime: end } };
}

function allDayEvent({ start, end }: { start: string; end: string }): GoogleCalendarEvent {
  return { id: "e1", calendarId: "primary", summary: "Event", start: { date: start }, end: { date: end } };
}

function calendarTask(overrides: Partial<CalendarTaskItem>): CalendarTaskItem {
  return {
    id: "t1",
    taskListId: "list-1",
    title: "Task",
    completed: false,
    dueDate: "2026-10-20",
    dueTime: null,
    colorToken: null,
    ...overrides,
  };
}

test("shifts a timed event's start/end to a new day, keeping time-of-day and duration", () => {
  const event = timedEvent({ start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:30:00-04:00" });
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({
    start: "2026-10-25T09:00:00-04:00",
    end: "2026-10-25T10:30:00-04:00",
  });
});

test("shifts a single-day all-day event's exclusive end along with its start", () => {
  const event = allDayEvent({ start: "2026-10-20", end: "2026-10-21" }); // Google's exclusive end
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({ start: "2026-10-25", end: "2026-10-26" });
});

test("preserves a multi-day all-day event's span length", () => {
  const event = allDayEvent({ start: "2026-10-20", end: "2026-10-23" }); // 3-day span, exclusive end
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({ start: "2026-10-25", end: "2026-10-28" });
});

test("shiftTaskToDay changes dueDate only, leaving dueTime untouched", () => {
  const task = calendarTask({ dueDate: "2026-10-20", dueTime: "14:30" });
  expect(shiftTaskToDay(task, new Date(2026, 9, 25))).toEqual({ dueDate: "2026-10-25" });
});

test("hourFromDropOffset snaps to the nearest quarter hour", () => {
  expect(hourFromDropOffset(2 * HOUR_ROW_HEIGHT + 20)).toBeCloseTo(GRID_START_HOUR + 2.25);
});

test("hourFromDropOffset clamps a negative offset (dropped above the grid) to the grid's start hour", () => {
  expect(hourFromDropOffset(-50)).toBe(GRID_START_HOUR);
});

test("hourFromDropOffset clamps an offset past the grid's bottom to its last quarter-hour slot", () => {
  expect(hourFromDropOffset(999999)).toBe(GRID_END_HOUR - 0.25);
});

test("moveEventToSlot sets a new start at the target day/hour and preserves the original duration", () => {
  const event = timedEvent({ start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:30:00-04:00" }); // 90 min
  const result = moveEventToSlot(event, new Date(2026, 9, 25), 14.5); // 2:30 PM
  expect(new Date(result.start).getHours()).toBe(14);
  expect(new Date(result.start).getMinutes()).toBe(30);
  expect(new Date(result.end).getTime() - new Date(result.start).getTime()).toBe(90 * 60 * 1000);
});

test("moveTaskToSlot with a target hour sets dueDate and a quarter-hour dueTime", () => {
  expect(moveTaskToSlot(calendarTask({}), new Date(2026, 9, 25), 14.25)).toEqual({
    dueDate: "2026-10-25",
    dueTime: "14:15",
  });
});

test("moveTaskToSlot with a null target hour clears dueTime (dropped into the all-day row)", () => {
  expect(moveTaskToSlot(calendarTask({ dueTime: "09:00" }), new Date(2026, 9, 25), null)).toEqual({
    dueDate: "2026-10-25",
    dueTime: null,
  });
});
