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
 * Dispatches the pointer-event sequence for a drag-to-reschedule gesture:
 * press at (0,0) on `source`, one move straight to (`clientX`, `clientY`) —
 * already past `usePointerDrag`'s 4px threshold in a single step — then
 * release at the same point, with `document.elementFromPoint` stubbed to
 * resolve to `hitElement` for the gesture's duration (standing in for
 * whatever `.wg-allday`/`.wg-col` element the pointer would land on in a real
 * browser; jsdom does no layout at all). The pointer-event replacement for
 * `fireDrop`/`fireDropAt`.
 */
function fireDragTo(
  source: HTMLElement,
  hitElement: HTMLElement,
  { clientX = 20, clientY = 20 }: { clientX?: number; clientY?: number } = {},
) {
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => hitElement;
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(source, { clientX, clientY, pointerId: 1 });
  fireEvent.pointerUp(source, { clientX, clientY, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
}

/**
 * Stubs `hitElement`'s `getBoundingClientRect()` to a zero top, so a drag's
 * `offsetY` (computed as `clientY - hitElement.getBoundingClientRect().top`
 * inside `HourGrid`'s `hitTest`) comes out equal to the raw `clientY` passed
 * to `fireDragTo` — the timed-grid variant of the stubbing `fireDragTo` alone
 * doesn't need for the all-day lane.
 */
function stubZeroRect(hitElement: HTMLElement) {
  hitElement.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
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
  fireDragTo(within(alldayCellForDay(20)).getByText("Conference"), alldayCellForDay(25));
  await vi.waitFor(() =>
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", start: "2026-10-25", end: "2026-10-27" }),
    ),
  );
});

test("dragging an all-day task onto a day column changes its dueDate only", async () => {
  render(<Harness days={sevenDays} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDragTo(screen.getByText("Errand"), alldayCellForDay(25));
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t1", dueDate: "2026-10-25", dueTime: null }),
    ),
  );
});

test("dropping an all-day task back on the day it already occupies is a no-op", () => {
  render(<Harness days={sevenDays} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDragTo(screen.getByText("Errand"), alldayCellForDay(20));
  expect(mockUpdateTaskAction).not.toHaveBeenCalled();
});

test("a multi-day all-day event grabbed from a middle-day chip nudges by the gesture's day delta in the all-day row too", async () => {
  // Oct 20-24 (exclusive end Oct 25) spans 5 of sevenDays' 7 columns.
  render(<Harness days={sevenDays} events={[allDayEvent({ id: "e1", start: "2026-10-20", end: "2026-10-25" })]} />);
  fireDragTo(within(alldayCellForDay(22)).getByText("Conference"), alldayCellForDay(23));
  await vi.waitFor(() =>
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", start: "2026-10-21", end: "2026-10-26" }),
    ),
  );
});

test("dragging an all-day event never resends its color, reminders, Meet link, or guests", async () => {
  const event: GoogleCalendarEvent = {
    id: "e1",
    calendarId: "primary",
    summary: "Conference",
    start: { date: "2026-10-20" },
    end: { date: "2026-10-21" },
    colorId: "11",
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }] },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
    attendees: [{ email: "guest@example.com" }],
  };
  render(<Harness days={sevenDays} events={[event]} />);
  fireDragTo(screen.getByText("Conference"), alldayCellForDay(25));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(call.colorToken).toBeUndefined();
  expect(call.notifyMinutesBefore).toBeUndefined();
  expect(call.addGoogleMeet).toBeUndefined();
  expect(call.guestEmails).toBeUndefined();
});

test("dragging a timed event within its own day column to a new time changes start/end, preserving duration and the event's own offset", async () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => column;
  const source = screen.getByText("Standup");
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 }); // -> 2 PM
  fireEvent.pointerUp(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  // Literal string, not `new Date(call.start).getHours()` — this suite runs under TZ=UTC
  // (see vitest.config.ts), and the fixture's event is deliberately offset at -04:00, so a
  // runtime-local read would silently check the wrong thing once the offset is preserved.
  expect(call.start).toBe("2026-10-20T14:00:00-04:00");
  expect(call.end).toBe("2026-10-20T15:00:00-04:00");
});

test("dragging a timed event to a new time never resends its color, reminders, Meet link, or guests", async () => {
  const event: GoogleCalendarEvent = {
    id: "e1",
    calendarId: "primary",
    summary: "Standup",
    start: { dateTime: "2026-10-20T09:00:00-04:00" },
    end: { dateTime: "2026-10-20T10:00:00-04:00" },
    colorId: "11",
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc" }] },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
    attendees: [{ email: "guest@example.com" }],
  };
  render(<Harness days={[oneDay]} events={[event]} />);
  const column = dayColumn();
  stubZeroRect(column);
  fireDragTo(screen.getByText("Standup"), column, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT });
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(call.colorToken).toBeUndefined();
  expect(call.notifyMinutesBefore).toBeUndefined();
  expect(call.addGoogleMeet).toBeUndefined();
  expect(call.guestEmails).toBeUndefined();
});

test("dragging over the timed grid shows a drop indicator snapped to the nearest quarter hour, not the raw pointer position", () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => column;
  // 7 * HOUR_ROW_HEIGHT (= 2 PM exactly) + 20px of "slop" — snaps to 2:15 PM, not 2:06ish.
  fireEvent.pointerDown(screen.getByText("Standup"), { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(screen.getByText("Standup"), { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT + 20, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
  const indicator = column.querySelector(".wg-drop-indicator") as HTMLElement;
  expect(indicator).not.toBeNull();
  expect(indicator.style.top).toBe(`${7.25 * HOUR_ROW_HEIGHT}px`);
});

test("completing a drop clears the drop indicator", () => {
  // The pointer-event replacement for the old native-DnD "dragend clears the indicator" test.
  // The pointer gesture's own cancel/cleanup mechanics (pointercancel) are covered directly by
  // usePointerDrag's own tests, so this just confirms HourGrid's own dragOverKey/dragPreviewHour
  // state doesn't outlive a *completed* gesture either.
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => column;
  const source = screen.getByText("Standup");
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 });
  expect(column.querySelector(".wg-drop-indicator")).not.toBeNull();

  fireEvent.pointerUp(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
  expect(column.querySelector(".wg-drop-indicator")).toBeNull();
});

test("the drop indicator still resolves to the column when the hit-tested element is one of its own children (no flicker)", () => {
  // Regression test for the real HTML5 DnD gotcha this feature used to have: dragenter/dragleave
  // fired on every child boundary the pointer crossed (any `.wg-line` or event block inside the
  // column counts as a "child"), not just on truly entering/leaving the column, which made the
  // indicator flicker constantly. Pointer-event hit-testing has no bubbling boundary event at all
  // — `closest("[data-day]")` walks up from whatever element `document.elementFromPoint` resolves
  // to, so landing on a descendant `.wg-line` instead of the column itself still resolves to the
  // same column/day, with no flicker possible by construction.
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const childLine = column.querySelector(".wg-line") as HTMLElement;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => childLine;

  fireEvent.pointerDown(screen.getByText("Standup"), { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(screen.getByText("Standup"), { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;

  expect(column.querySelector(".wg-drop-indicator")).not.toBeNull();
});

test("dragging a timed task to a new time sets a quarter-hour dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", title: "Follow up", dueTime: "09:00" })]} />);
  const column = dayColumn();
  stubZeroRect(column);
  fireDragTo(screen.getByText("Follow up"), column, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT });
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: "14:00" })),
  );
});

test("dropping a timed event into the all-day row is not a valid target (events don't cross lanes)", () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDragTo(screen.getByText("Standup"), alldayRow);
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dropping an all-day event into the timed grid is not a valid target (events don't cross lanes)", () => {
  render(<Harness days={[oneDay]} events={[allDayEvent({ id: "e1", start: "2026-10-20", end: "2026-10-21" })]} />);
  const column = dayColumn();
  stubZeroRect(column);
  fireDragTo(screen.getByText("Conference"), column, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT });
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging an all-day task into the timed grid picks up a dueTime at the drop position", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  const column = dayColumn();
  stubZeroRect(column);
  fireDragTo(screen.getByText("Errand"), column, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT }); // -> 2 PM
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: "14:00" })),
  );
});

test("dragging a timed task into the all-day row clears its dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", title: "Follow up", dueDate: "2026-10-20", dueTime: "09:00" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDragTo(screen.getByText("Follow up"), alldayRow);
  await vi.waitFor(() =>
    expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: null })),
  );
});
