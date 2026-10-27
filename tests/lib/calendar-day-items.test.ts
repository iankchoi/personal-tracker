import { expect, test } from "vitest";

import { getEventsForDay, getTasksForDay } from "../../lib/calendar-day-items";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "../../lib/google-calendar";

const DAY = new Date(2026, 9, 22);

function timed(id: string, dateTime: string): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary: id,
    start: { dateTime },
    end: { dateTime },
  };
}

function allDay(id: string, date: string, endDate: string): GoogleCalendarEvent {
  return { id, calendarId: "primary", summary: id, start: { date }, end: { date: endDate } };
}

function task(id: string, dueDate: string): CalendarTaskItem {
  return {
    id,
    taskListId: "list-1",
    title: id,
    completed: false,
    dueDate,
    dueTime: null,
    colorToken: null,
  };
}

test("getEventsForDay puts all-day events first, then times the rest chronologically", () => {
  // Deliberately out of order on input: `events` is a concatenation of one
  // per-calendar list, each sorted by Google but whose merge is not.
  const events = [
    timed("late", "2026-10-22T18:00:00.000Z"),
    allDay("holiday", "2026-10-22", "2026-10-23"),
    timed("early", "2026-10-22T09:00:00.000Z"),
  ];

  expect(getEventsForDay(events, DAY).map((event) => event.id)).toEqual(["holiday", "early", "late"]);
});

test("getEventsForDay excludes events belonging to another day", () => {
  const events = [
    timed("today", "2026-10-22T09:00:00.000Z"),
    timed("tomorrow", "2026-10-23T09:00:00.000Z"),
    allDay("yesterday", "2026-10-21", "2026-10-22"),
  ];

  expect(getEventsForDay(events, DAY).map((event) => event.id)).toEqual(["today"]);
});

test("getEventsForDay does not restrict timed events to the Day/Week grid's hour window", () => {
  // 3 AM is outside the hour grid's fixed [7, 22) window, but the list
  // surfaces that use this helper show every event regardless of time of day.
  expect(getEventsForDay([timed("dawn", "2026-10-22T03:00:00.000Z")], DAY)).toHaveLength(1);
});

test("getTasksForDay keeps only tasks due on that day", () => {
  const tasks = [task("today", "2026-10-22"), task("tomorrow", "2026-10-23")];
  expect(getTasksForDay(tasks, DAY).map((item) => item.id)).toEqual(["today"]);
});
