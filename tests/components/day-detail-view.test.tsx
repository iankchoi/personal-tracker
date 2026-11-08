// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const {
  mockCreateEventAction,
  mockUpdateEventAction,
  mockDeleteEventAction,
  mockCreateTaskAction,
  mockUpdateTaskAction,
  mockDeleteTaskAction,
  mockCompleteTaskAction,
  mockRefresh,
} = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockUpdateEventAction: vi.fn(),
  mockDeleteEventAction: vi.fn(),
  mockCreateTaskAction: vi.fn(),
  mockUpdateTaskAction: vi.fn(),
  mockDeleteTaskAction: vi.fn(),
  mockCompleteTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({
  createEventAction: mockCreateEventAction,
  updateEventAction: mockUpdateEventAction,
  deleteEventAction: mockDeleteEventAction,
}));
vi.mock("../../lib/actions/calendar-tasks", () => ({
  createTaskAction: mockCreateTaskAction,
  updateTaskAction: mockUpdateTaskAction,
  deleteTaskAction: mockDeleteTaskAction,
  completeTaskAction: mockCompleteTaskAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import {
  CalendarInteractionProvider,
  useCalendarInteraction,
  type PopupState,
} from "../../components/calendar/CalendarInteractionProvider";
import { MonthView } from "../../components/calendar/MonthView";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";
import type { GoogleTaskList } from "../../lib/google-tasks";

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#3b6ea5", accessRole: "owner" },
];
const taskLists: GoogleTaskList[] = [{ id: "list-1", title: "My Tasks" }];
const colorByCalendar: Record<string, CalendarColorToken> = { primary: "cal" };

/** The day under test, and a neighbor whose items must never leak into its list. */
const DAY = new Date(2026, 9, 22);
const OTHER_DAY = new Date(2026, 9, 23);

function timedEvent(id: string, summary: string, day: "22" | "23"): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary,
    start: { dateTime: `2026-10-${day}T10:00:00.000Z` },
    end: { dateTime: `2026-10-${day}T11:00:00.000Z` },
  };
}

function task(id: string, title: string, dueDate: string): CalendarTaskItem {
  return {
    id,
    taskListId: "list-1",
    title,
    completed: false,
    dueDate,
    dueTime: null,
    colorToken: null,
  };
}

/**
 * Month view's own cap is 3 chips, so five items on `DAY` guarantee a "+N
 * more" overflow button to click.
 */
const events: GoogleCalendarEvent[] = [
  timedEvent("e1", "Standup", "22"),
  timedEvent("e2", "Design review", "22"),
  timedEvent("e3", "1:1", "22"),
  timedEvent("e4", "Retro", "22"),
  timedEvent("e5", "Other day's meeting", "23"),
];

const tasks: CalendarTaskItem[] = [
  task("t1", "Essay draft", "2026-10-22"),
  task("t2", "Other day's errand", "2026-10-23"),
];

function Harness() {
  return (
    <CalendarInteractionProvider
      calendars={calendars}
      taskLists={taskLists}
      events={events}
      tasks={tasks}
      colorByCalendar={colorByCalendar}
    >
      <MonthView
        referenceDate={DAY}
        events={events}
        tasks={tasks}
        colorByCalendar={colorByCalendar}
        today={DAY}
      />
    </CalendarInteractionProvider>
  );
}

afterEach(() => {
  cleanup();
  mockUpdateEventAction.mockReset().mockResolvedValue({ id: "e1" });
  mockUpdateTaskAction.mockReset().mockResolvedValue({ id: "t1" });
  mockCompleteTaskAction.mockReset().mockResolvedValue(undefined);
  mockRefresh.mockReset();
});

/** The one `.mg-cell` for `DAY` (Oct 22) — the cell whose overflow we click. */
function overflowButtonForDay(): HTMLElement {
  // Oct 22 is the only day with enough items to overflow, so there's exactly
  // one "+N more" in the rendered month.
  return screen.getByRole("button", { name: /\+\d+ more/ });
}

// ---------------------------------------------------------------------------
// openDayDetail
// ---------------------------------------------------------------------------

test("openDayDetail puts the provider into the day-detail popup state for that date and bumps the session", async () => {
  const seen: { popup: PopupState; sessionId: number }[] = [];

  function Spy() {
    const { popup, sessionId, openDayDetail } = useCalendarInteraction();
    seen.push({ popup, sessionId });
    return (
      <button type="button" onClick={() => openDayDetail(DAY)}>
        open day detail
      </button>
    );
  }

  render(
    <CalendarInteractionProvider calendars={calendars} taskLists={taskLists}>
      <Spy />
    </CalendarInteractionProvider>,
  );

  expect(seen[0].popup).toEqual({ mode: "closed" });

  await userEvent.click(screen.getByRole("button", { name: "open day detail" }));

  const latest = seen[seen.length - 1];
  expect(latest.popup).toEqual({ mode: "day-detail", date: DAY });
  // Every opener bumps the counter — that's what keys EventTaskModal's child
  // and makes the day-detail -> editor transition mount a fresh editor.
  expect(latest.sessionId).toBe(seen[0].sessionId + 1);
});

// ---------------------------------------------------------------------------
// Month view's "+N more" is the entry point
// ---------------------------------------------------------------------------

test("clicking Month view's +N more opens the day-detail overlay inside the shared ModalShell", async () => {
  render(<Harness />);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await userEvent.click(overflowButtonForDay());

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveClass("day-detail");
  // The same overlay chrome every editor uses, so Escape/backdrop dismissal
  // and focus handling come for free.
  expect(dialog.parentElement).toHaveClass("modal-card");
  expect(dialog.parentElement?.parentElement).toHaveClass("modal-backdrop");
  expect(screen.getByRole("heading", { name: /october 22/i })).toBeInTheDocument();
});

test("the day-detail overlay lists exactly that day's events and tasks, not a neighboring day's", async () => {
  render(<Harness />);

  await userEvent.click(overflowButtonForDay());

  const dialog = screen.getByRole("dialog");
  for (const summary of ["Standup", "Design review", "1:1", "Retro", "Essay draft"]) {
    expect(within(dialog).getByText(summary)).toBeInTheDocument();
  }
  expect(within(dialog).queryByText("Other day's meeting")).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Other day's errand")).not.toBeInTheDocument();
});

test("Escape closes the day-detail overlay", async () => {
  render(<Harness />);

  await userEvent.click(overflowButtonForDay());
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Clicking an item transitions straight into its own editor
// ---------------------------------------------------------------------------

test("clicking an event row in the day-detail overlay opens that event's editor, pre-filled", async () => {
  render(<Harness />);

  await userEvent.click(overflowButtonForDay());
  // "Retro" is one of the items the month cell couldn't fit — the reason to
  // open this overlay in the first place.
  await userEvent.click(within(screen.getByRole("dialog")).getByText("Retro"));

  // The event editor, not the day list (the editor has a Description field).
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Retro");

  // And it saves the clicked event, not whichever one happened to be first.
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e4", title: "Retro" }),
  );
});

test("clicking a task's title in the day-detail overlay opens that task's editor", async () => {
  render(<Harness />);

  await userEvent.click(overflowButtonForDay());
  await userEvent.click(within(screen.getByRole("dialog")).getByText("Essay draft"));

  // The task editor (it has a task-list picker; the event editor has guests).
  expect(screen.getByLabelText(/task list/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Essay draft");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "t1", title: "Essay draft" }),
  );
});

test("a task's checkbox inside the day-detail overlay still toggles completion rather than opening the editor", async () => {
  render(<Harness />);

  await userEvent.click(overflowButtonForDay());
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox"));

  await vi.waitFor(() => expect(mockCompleteTaskAction).toHaveBeenCalled());
  expect(mockCompleteTaskAction).toHaveBeenCalledWith({
    taskListId: "list-1",
    taskId: "t1",
    completed: true,
  });
  // Still the day list, never swapped out for the task editor.
  expect(screen.getByRole("dialog")).toHaveClass("day-detail");
});

// ---------------------------------------------------------------------------
// A day with nothing on it
// ---------------------------------------------------------------------------

test("the day-detail overlay for a day with no events or tasks says so instead of rendering an empty list", async () => {
  function EmptyHarness() {
    const { openDayDetail } = useCalendarInteraction();
    return (
      <button type="button" onClick={() => openDayDetail(OTHER_DAY)}>
        open
      </button>
    );
  }

  render(
    <CalendarInteractionProvider calendars={calendars} taskLists={taskLists} events={[]} tasks={[]}>
      <EmptyHarness />
    </CalendarInteractionProvider>,
  );

  await userEvent.click(screen.getByRole("button", { name: "open" }));

  expect(screen.getByText(/nothing scheduled/i)).toBeInTheDocument();
});
