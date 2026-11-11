// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { MonthView } from "../../components/calendar/MonthView";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#3b6ea5", accessRole: "owner" },
];
const colorByCalendar: Record<string, CalendarColorToken> = { primary: "cal" };
const REFERENCE_DATE = new Date(2026, 9, 22);

function timedEvent({
  id,
  summary = "Standup",
  start,
}: {
  id: string;
  summary?: string;
  start: string;
}): GoogleCalendarEvent {
  const startDate = new Date(start);
  const end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  return { id, calendarId: "primary", summary, start: { dateTime: start }, end: { dateTime: end } };
}

function allDayEvent({
  id,
  summary,
  start = "2026-10-20",
  end = "2026-10-21",
}: {
  id: string;
  summary: string;
  start?: string;
  end?: string;
}): GoogleCalendarEvent {
  return { id, calendarId: "primary", summary, start: { date: start }, end: { date: end } };
}

function calendarTask(overrides: Partial<CalendarTaskItem> & { id: string }): CalendarTaskItem {
  return {
    taskListId: "list-1",
    title: "Errand",
    completed: false,
    dueDate: "2026-10-22",
    dueTime: null,
    colorToken: null,
    ...overrides,
  };
}

function Harness({ events = [], tasks = [] }: { events?: GoogleCalendarEvent[]; tasks?: CalendarTaskItem[] }) {
  return (
    <CalendarInteractionProvider calendars={calendars} taskLists={[]}>
      <MonthView
        referenceDate={REFERENCE_DATE}
        events={events}
        tasks={tasks}
        colorByCalendar={colorByCalendar}
        today={REFERENCE_DATE}
      />
    </CalendarInteractionProvider>
  );
}

/**
 * Simulates a pointer-driven drag-to-reschedule gesture: press on `source`,
 * move past `usePointerDrag`'s 4px threshold, release. `document.elementFromPoint`
 * is stubbed for the gesture's duration to resolve to a synthetic element
 * carrying `data-day={hitDataDay}` — standing in for whatever `.mg-cell` the
 * pointer would land on in a real browser, which jsdom's layout engine can't
 * tell us (it does no layout at all).
 */
function fireDragTo(source: HTMLElement, hitDataDay: string) {
  const target = document.createElement("div");
  target.dataset.day = hitDataDay;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => target;
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true });
  fireEvent.pointerMove(source, { clientX: 20, clientY: 20, pointerId: 1 }); // past the 4px threshold
  fireEvent.pointerUp(source, { clientX: 20, clientY: 20, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
}

/** The `.mg-cell` whose `.mg-date` shows `day` — unambiguous for Oct 2026's rendered grid (no overflow day from an adjacent month repeats 20 or 25). */
function cellForDay(day: number): HTMLElement {
  const dateSpan = screen.getByText(String(day), { selector: ".mg-date" });
  return dateSpan.closest(".mg-cell") as HTMLElement;
}

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
  mockUpdateEventAction.mockReset().mockResolvedValue({ id: "e1" });
  mockUpdateTaskAction.mockReset().mockResolvedValue({ id: "t1" });
  mockCompleteTaskAction.mockReset().mockResolvedValue(undefined);
});

test("a timed event's month chip shows its start time before the title", () => {
  render(<Harness events={[timedEvent({ id: "e1", summary: "Standup", start: "2026-10-20T09:00:00-04:00" })]} />);
  expect(screen.getByText("9:00 AM")).toBeInTheDocument();
  expect(screen.getByText("Standup")).toBeInTheDocument();
});

test("an all-day event's month chip has no time label", () => {
  render(<Harness events={[allDayEvent({ id: "e1", summary: "Holiday" })]} />);
  expect(screen.queryByText(/\d{1,2}:\d{2} (AM|PM)/)).not.toBeInTheDocument();
});

test("dragging an event chip onto a different day cell calls updateEventAction with that day's date and refreshes", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e1", start: expect.stringContaining("10-25") }),
  );
  expect(mockRefresh).toHaveBeenCalled();
});

test("clicking an event chip without moving the pointer opens its editor, not a reschedule", () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  const chip = screen.getByText("Standup");
  fireEvent.pointerDown(chip, { clientX: 10, clientY: 10, pointerId: 1, isPrimary: true });
  fireEvent.pointerUp(chip, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument(); // the event editor opened
});

test("dropping an item back on its own day cell is a no-op", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-20");
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging an event never resends its color, reminders, Meet link, or guests — only the date changes", async () => {
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
  render(<Harness events={[event]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(call.colorToken).toBeUndefined();
  expect(call.notifyMinutesBefore).toBeUndefined();
  expect(call.addGoogleMeet).toBeUndefined();
  expect(call.guestEmails).toBeUndefined();
});

test("a multi-day all-day event dragged from a middle-day chip nudges by the gesture's day delta, not the event's own start day", async () => {
  // Oct 20-24 (exclusive end Oct 25) renders a chip in every one of those 5 days.
  render(<Harness events={[allDayEvent({ id: "e1", summary: "Conference", start: "2026-10-20", end: "2026-10-25" })]} />);
  // Grab the Oct 22 chip specifically and drop it one day over, on Oct 23 — a 1-day nudge.
  fireDragTo(within(cellForDay(22)).getByText("Conference"), "2026-10-23");
  await vi.waitFor(() =>
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", start: "2026-10-21", end: "2026-10-26" }),
    ),
  );
});

test("dropping a multi-day event's middle-day chip back on that same cell is a no-op", async () => {
  render(<Harness events={[allDayEvent({ id: "e1", summary: "Conference", start: "2026-10-20", end: "2026-10-25" })]} />);
  fireDragTo(within(cellForDay(22)).getByText("Conference"), "2026-10-22");
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging a task's checkbox does not start a drag", () => {
  render(<Harness tasks={[calendarTask({ id: "t1" })]} />);
  const checkbox = screen.getByRole("checkbox");
  fireDragTo(checkbox, "2026-10-25");
  expect(mockUpdateTaskAction).not.toHaveBeenCalled();
});

test("dragging a task's title onto a different day cell calls updateTaskAction and refreshes", async () => {
  render(<Harness tasks={[calendarTask({ id: "t1", dueDate: "2026-10-22" })]} />);
  fireDragTo(screen.getByText("Errand"), "2026-10-23");
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "t1", dueDate: "2026-10-23" }),
  );
  expect(mockRefresh).toHaveBeenCalled();
});

test("clicking a task's title without moving the pointer opens its editor, not a reschedule", () => {
  render(<Harness tasks={[calendarTask({ id: "t1" })]} />);
  const title = screen.getByText("Errand");
  fireEvent.pointerDown(title, { clientX: 10, clientY: 10, pointerId: 1, isPrimary: true });
  fireEvent.pointerUp(title, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(mockUpdateTaskAction).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: /edit task/i })).toBeInTheDocument();
});

test("a failed drop shows an inline error and leaves the event where it was", async () => {
  mockUpdateEventAction.mockRejectedValueOnce(new Error("boom"));
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t reschedule/i));
  expect(screen.getByText("Standup")).toBeInTheDocument(); // still rendered from unchanged props
});

test("a recurring event's month chip shows the repeat icon", () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  expect(screen.getByTestId("mg-chip-repeat-icon")).toBeInTheDocument();
});

test("a one-off event's month chip shows no repeat icon", () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  expect(screen.queryByTestId("mg-chip-repeat-icon")).not.toBeInTheDocument();
});

test("dragging a recurring event's chip shows the scope dialog instead of saving immediately", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  expect(await screen.findByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("picking 'This event' after dragging a recurring event sends scope 'this' and the dragged occurrence's own id", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await userEvent.click(await screen.findByRole("button", { name: /this event/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(expect.objectContaining({ eventId: "occ1", scope: "this" }));
});

test("picking 'All events' after dragging a recurring event sends scope 'all' plus the occurrence's original start/end and recurringEventId", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await userEvent.click(await screen.findByRole("button", { name: /all events/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "all", recurringEventId: "master1",
      occurrenceOriginalStart: "2026-10-20T09:00:00-04:00", occurrenceOriginalEnd: expect.any(String),
    }),
  );
});

test("dragging a one-off event never shows the scope dialog", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /all events/i })).not.toBeInTheDocument();
});

test("rendering an event month chip never leaks usePointerDrag's isDragging onto the DOM", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  const leaked = consoleError.mock.calls.some((call) => call.some((arg) => String(arg).includes("isDragging")));
  expect(leaked).toBe(false);
  consoleError.mockRestore();
});
