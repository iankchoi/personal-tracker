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
 * A minimal stand-in for the browser's `DataTransfer`, which jsdom doesn't
 * implement at all (no `DragEvent` constructor either — see `fireDrop`).
 * Only the members the production handlers actually call.
 */
function fakeDataTransfer() {
  return { setData: () => {}, effectAllowed: "none", dropEffect: "none" };
}

/**
 * Dispatches the minimal native-DnD event sequence (no library helper exists
 * here, and `@testing-library/dom`'s `fireEvent.dragStart`/`dragOver`/`drop`
 * shorthands can't be used as-is: this jsdom has no `DragEvent` constructor,
 * so their internal `createEvent` silently falls back to a plain `Event`
 * with no `dataTransfer` at all — exactly what the production handlers read
 * on every one of these three events). Each event is built by hand with a
 * `dataTransfer` attached, then dispatched through `fireEvent`'s generic
 * `(element, event)` form — the shorthand helpers' own act()-wrapping, which
 * raw `element.dispatchEvent` doesn't get, and which is what makes the next
 * dispatch in this same sequence see the state `dragstart`'s handler just set.
 */
function fireDrop(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = fakeDataTransfer();
  for (const [element, type] of [
    [source, "dragstart"],
    [target, "dragover"],
    [target, "drop"],
  ] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer });
    fireEvent(element, event);
  }
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
  fireDrop(screen.getByText("Standup"), cellForDay(25));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e1", start: expect.stringContaining("10-25") }),
  );
  expect(mockRefresh).toHaveBeenCalled();
});

test("dropping an item back on its own day cell is a no-op", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDrop(screen.getByText("Standup"), cellForDay(20));
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
  fireDrop(screen.getByText("Standup"), cellForDay(25));
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
  fireDrop(within(cellForDay(22)).getByText("Conference"), cellForDay(23));
  await vi.waitFor(() =>
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "e1", start: "2026-10-21", end: "2026-10-26" }),
    ),
  );
});

test("dropping a multi-day event's middle-day chip back on that same cell is a no-op", async () => {
  render(<Harness events={[allDayEvent({ id: "e1", summary: "Conference", start: "2026-10-20", end: "2026-10-25" })]} />);
  fireDrop(within(cellForDay(22)).getByText("Conference"), cellForDay(22));
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging a task's checkbox does not start a drag", () => {
  render(<Harness tasks={[calendarTask({ id: "t1" })]} />);
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox.closest("[draggable='true']")).toBeNull();
});

test("a failed drop shows an inline error and leaves the event where it was", async () => {
  mockUpdateEventAction.mockRejectedValueOnce(new Error("boom"));
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDrop(screen.getByText("Standup"), cellForDay(25));
  await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t reschedule/i));
  expect(screen.getByText("Standup")).toBeInTheDocument(); // still rendered from unchanged props
});
