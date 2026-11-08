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
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#3b6ea5", accessRole: "owner" },
];
const colorByCalendar: Record<string, CalendarColorToken> = { primary: "cal" };
/** Oct 19–25, 2026 — spans both an all-day event's own day (20) and the drop target (25) in one visible week. */
const sevenDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i));

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
