// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockRefresh, mockUpdateEventAction, mockUpdateTaskAction, mockCompleteTaskAction } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockUpdateEventAction: vi.fn(),
  mockUpdateTaskAction: vi.fn(),
  mockCompleteTaskAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("../../lib/actions/calendar-events", () => ({ updateEventAction: mockUpdateEventAction }));
vi.mock("../../lib/actions/calendar-tasks", () => ({
  updateTaskAction: mockUpdateTaskAction,
  completeTaskAction: mockCompleteTaskAction,
}));

import { CalendarInteractionProvider } from "../../components/calendar/CalendarInteractionProvider";
import { HourGrid } from "../../components/calendar/HourGrid";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import { HOUR_ROW_HEIGHT } from "../../lib/calendar-layout";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#3b6ea5", accessRole: "owner" },
];
const colorByCalendar: Record<string, CalendarColorToken> = { primary: "cal" };
/** Oct 19–25, 2026 — spans both an all-day event's own day (20) and the drop target (25) in one visible week. */
const sevenDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i));
const oneDay = new Date(2026, 9, 20);

function allDayEvent({
  id,
  summary = "Conference",
  start,
  end,
}: {
  id: string;
  summary?: string;
  start: string;
  end: string;
}): GoogleCalendarEvent {
  return { id, calendarId: "primary", summary, start: { date: start }, end: { date: end } };
}

function timedEvent({
  id,
  summary = "Standup",
  start = "2026-10-20T09:00:00-04:00",
  end = "2026-10-20T10:00:00-04:00",
}: {
  id: string;
  summary?: string;
  start?: string;
  end?: string;
}): GoogleCalendarEvent {
  return { id, calendarId: "primary", summary, start: { dateTime: start }, end: { dateTime: end } };
}

function calendarTask(overrides: Partial<CalendarTaskItem> & { id: string }): CalendarTaskItem {
  return {
    taskListId: "list-1",
    title: "Errand",
    completed: false,
    dueDate: "2026-10-20",
    dueTime: null,
    colorToken: null,
    ...overrides,
  };
}

function Harness({
  days,
  events = [],
  tasks = [],
}: {
  days: Date[];
  events?: GoogleCalendarEvent[];
  tasks?: CalendarTaskItem[];
}) {
  return (
    <CalendarInteractionProvider calendars={calendars} taskLists={[]}>
      <HourGrid days={days} events={events} tasks={tasks} colorByCalendar={colorByCalendar} today={days[0]} />
    </CalendarInteractionProvider>
  );
}

/** Dispatches the minimal native-DnD event sequence (no library helper exists here): dragstart on the dragged element, then dragover + drop on the target. */
function fireDrop(source: HTMLElement, target: HTMLElement) {
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

/** The `.wg-allday` div for `day`'s column, picked by its position among `sevenDays` (one `data-testid="wg-allday"` per day, in day order). */
function alldayCellForDay(day: number): HTMLElement {
  const index = sevenDays.findIndex((d) => d.getDate() === day);
  return screen.getAllByTestId("wg-allday")[index];
}

/** The timed grid's single day column, for a `Harness` rendered with `days={[oneDay]}`. */
function dayColumn(): HTMLElement {
  return screen.getByTestId("wg-col");
}

/**
 * Like `fireDrop`, but stubs the target's `getBoundingClientRect()` to a
 * zero top and attaches `clientY: offsetY` directly to the dispatched drop
 * event — jsdom has no `DragEvent` constructor, so `@testing-library/dom`'s
 * `fireEvent.drop(target, { clientY })` silently falls back to a plain
 * `Event` that drops the init dict's `clientY` entirely. Constructing the
 * event by hand and assigning the property afterward is the only way to get
 * it to `HourGrid`'s `onDrop` handler in this environment.
 */
function fireDropAt(source: HTMLElement, target: HTMLElement, { offsetY }: { offsetY: number }) {
  target.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
  Object.assign(dropEvent, { clientY: offsetY });
  target.dispatchEvent(dropEvent);
}

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
  mockUpdateEventAction.mockReset().mockResolvedValue({ id: "e1" });
  mockUpdateTaskAction.mockReset().mockResolvedValue({ id: "t1" });
  mockCompleteTaskAction.mockReset().mockResolvedValue(undefined);
});

test("dragging an all-day event chip to a different day column reschedules it and preserves a multi-day span", async () => {
  render(<Harness days={sevenDays} events={[allDayEvent({ id: "e1", start: "2026-10-20", end: "2026-10-22" })]} />);
  // The event spans two days (exclusive end), so it renders in both the 20th's and 21st's
  // all-day columns — drag from the chip in its own start day specifically.
  fireDrop(within(alldayCellForDay(20)).getByText("Conference"), alldayCellForDay(25));
  await vi.waitFor(() =>
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", start: "2026-10-25", end: "2026-10-27" }),
    ),
  );
});

test("dragging an all-day task onto a day column changes its dueDate only", async () => {
  render(<Harness days={sevenDays} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDrop(screen.getByText("Errand"), alldayCellForDay(25));
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", dueDate: "2026-10-25", dueTime: null }),
    ),
  );
});

test("dragging a timed event within its own day column to a new time changes start/end, preserving duration", async () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  fireDropAt(screen.getByText("Standup"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT }); // -> 2 PM
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(new Date(call.start).getHours()).toBe(14);
  expect(new Date(call.end).getTime() - new Date(call.start).getTime()).toBe(60 * 60 * 1000);
});

test("dragging a timed task to a new time sets a quarter-hour dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", title: "Follow up", dueTime: "09:00" })]} />);
  fireDropAt(screen.getByText("Follow up"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT });
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: "14:00" })),
  );
});

test("dropping a timed event into the all-day row is not a valid target (events don't cross lanes)", () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDrop(screen.getByText("Standup"), alldayRow);
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dropping an all-day event into the timed grid is not a valid target (events don't cross lanes)", () => {
  render(<Harness days={[oneDay]} events={[allDayEvent({ id: "e1", start: "2026-10-20", end: "2026-10-21" })]} />);
  fireDropAt(screen.getByText("Conference"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT });
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging an all-day task into the timed grid picks up a dueTime at the drop position", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDropAt(screen.getByText("Errand"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT }); // -> 2 PM
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: "14:00" })),
  );
});

test("dragging a timed task into the all-day row clears its dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", title: "Follow up", dueDate: "2026-10-20", dueTime: "09:00" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDrop(screen.getByText("Follow up"), alldayRow);
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: null })),
  );
});
