// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const {
  mockCreateEventAction,
  mockUpdateEventAction,
  mockDeleteEventAction,
  mockCreateTaskAction,
  mockUpdateTaskAction,
  mockDeleteTaskAction,
  mockRefresh,
} = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockUpdateEventAction: vi.fn(),
  mockDeleteEventAction: vi.fn(),
  mockCreateTaskAction: vi.fn(),
  mockUpdateTaskAction: vi.fn(),
  mockDeleteTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({
  createEventAction: mockCreateEventAction,
  updateEventAction: mockUpdateEventAction,
  deleteEventAction: mockDeleteEventAction,
}));
// EventTaskModal pulls in TaskEditor (and therefore the Tasks actions)
// statically, and the Task-side tests below reach it through "More options".
vi.mock("../../lib/actions/calendar-tasks", () => ({
  createTaskAction: mockCreateTaskAction,
  updateTaskAction: mockUpdateTaskAction,
  deleteTaskAction: mockDeleteTaskAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import {
  CalendarInteractionProvider,
  useCalendarInteraction,
} from "../../components/calendar/CalendarInteractionProvider";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";
import type { GoogleTaskList } from "../../lib/google-tasks";

const cals: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "iankangchoi@gmail.com", backgroundColor: "#3b6ea5", primary: true, accessRole: "owner" },
  { id: "shared", summary: "Shared", backgroundColor: "#2f7a6b", accessRole: "writer" },
];

const lists: GoogleTaskList[] = [{ id: "list-1", title: "My Tasks" }];

/** A timed event, as `lib/google-calendar.ts` reads it back from Google. */
function timedEvent(id: string, summary: string): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary,
    start: { dateTime: "2026-10-20T13:00:00.000Z" },
    end: { dateTime: "2026-10-20T14:00:00.000Z" },
  };
}

/**
 * A single-day all-day event exactly as Google reports it: `end.date` is
 * **exclusive**, so one day on Oct 25 ends `"2026-10-26"`.
 */
const oneDayAllDayEvent: GoogleCalendarEvent = {
  id: "all-day-1",
  calendarId: "primary",
  summary: "Birthday",
  start: { date: "2026-10-25" },
  end: { date: "2026-10-26" },
};

/**
 * Drives the real provider from outside, the way a grid chip click would.
 * Both openers are plain buttons so a test can transition straight from one
 * open session to another with no intervening close — the exact sequence Fix 2
 * is about.
 */
function Harness({ events }: { events: GoogleCalendarEvent[] }) {
  return (
    <CalendarInteractionProvider calendars={cals} taskLists={lists}>
      <Openers events={events} />
    </CalendarInteractionProvider>
  );
}

function Openers({ events }: { events: GoogleCalendarEvent[] }) {
  const { openEditEvent, openCreate } = useCalendarInteraction();
  return (
    <>
      {events.map((event) => (
        <button key={event.id} type="button" onClick={() => openEditEvent(event)}>
          {`open ${event.summary}`}
        </button>
      ))}
      <button type="button" onClick={() => openCreate("event", new Date(2026, 9, 22), 9)}>
        open create
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  mockCreateEventAction.mockReset().mockResolvedValue({ id: "e1", calendarId: "primary" });
  mockUpdateEventAction.mockReset().mockResolvedValue({ id: "e1" });
  mockDeleteEventAction.mockReset().mockResolvedValue(undefined);
  mockCreateTaskAction.mockReset().mockResolvedValue({ id: "t1", taskListId: "list-1" });
  mockUpdateTaskAction.mockReset().mockResolvedValue({ id: "t1" });
  mockDeleteTaskAction.mockReset().mockResolvedValue(undefined);
  mockRefresh.mockReset();
});

// ---------------------------------------------------------------------------
// Fix 2 — form state leaking from one event onto another
// ---------------------------------------------------------------------------

test("opening event B's editor directly from event A's shows B's values, not A's", async () => {
  const eventA = timedEvent("a", "Event A");
  const eventB = timedEvent("b", "Event B");
  render(<Harness events={[eventA, eventB]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Event A");

  // No close in between — this is the reachable path, since the toolbar button
  // and N can both reopen over an already-open popup.
  await userEvent.click(screen.getByRole("button", { name: "open Event B" }));

  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Event B");
});

test("typing into event A's editor then switching to event B saves B's data, never A's displayed text", async () => {
  const eventA = timedEvent("a", "Event A");
  const eventB = timedEvent("b", "Event B");
  render(<Harness events={[eventA, eventB]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));
  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "A, half-renamed");

  await userEvent.click(screen.getByRole("button", { name: "open Event B" }));
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Event B");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "b", title: "Event B" }),
  );
});

test("reopening the same event after typing into it resets the form, because each open is its own session", async () => {
  const eventA = timedEvent("a", "Event A");
  render(<Harness events={[eventA]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));
  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Stale draft");

  // Same event, same PopupState shape — only the session counter differs.
  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));

  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Event A");
});

test("two consecutive create opens count as distinct sessions and reset the quick popup", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Half-typed");
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Half-typed");

  await userEvent.click(screen.getByRole("button", { name: "open create" }));

  expect(screen.getByLabelText(/^title$/i)).toHaveValue("");
});

// ---------------------------------------------------------------------------
// Fix 7 — all-day end dates: inclusive in the UI, exclusive in Google's API
// ---------------------------------------------------------------------------

test("a one-day all-day event loaded and saved untouched round-trips to the exact start/end Google reported", async () => {
  render(<Harness events={[oneDayAllDayEvent]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Birthday" }));

  // The editor shows the inclusive last day (Oct 25), not Google's exclusive
  // Oct 26 — otherwise a one-day event reads as spanning two.
  expect(screen.getByRole("checkbox", { name: /all.?day/i })).toBeChecked();
  expect(screen.getByLabelText(/start date/i)).toHaveValue("2026-10-25");
  expect(screen.getByLabelText(/end date/i)).toHaveValue("2026-10-25");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const payload = mockUpdateEventAction.mock.calls[0][0];
  expect(payload.allDay).toBe(true);
  expect(payload.start).toBe(oneDayAllDayEvent.start.date);
  expect(payload.end).toBe(oneDayAllDayEvent.end.date);
});

test("turning All day off on a one-day all-day event yields a same-day timed event, not a 25-hour one", async () => {
  render(<Harness events={[oneDayAllDayEvent]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Birthday" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /all.?day/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const payload = mockUpdateEventAction.mock.calls[0][0];
  expect(payload.allDay).toBe(false);
  // Both ends land on Oct 25; the vitest process is pinned to UTC, so the
  // 09:00-10:00 fallback times serialize as the same calendar day.
  expect(payload.start).toBe("2026-10-25T09:00:00.000Z");
  expect(payload.end).toBe("2026-10-25T10:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Fix 3 — the surfaces are real overlays with real dismissal behavior
// ---------------------------------------------------------------------------

test("the open editor sits inside a fixed backdrop, with focus moved into the card", async () => {
  render(<Harness events={[timedEvent("a", "Event A")]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));

  const dialog = screen.getByRole("dialog");
  const card = dialog.parentElement;
  expect(card).toHaveClass("modal-card");
  expect(card?.parentElement).toHaveClass("modal-backdrop");
  expect(document.activeElement).toBe(card);
});

test("Escape closes the editor", async () => {
  render(<Harness events={[timedEvent("a", "Event A")]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("clicking the backdrop closes the editor, but clicking inside the card does not", async () => {
  render(<Harness events={[timedEvent("a", "Event A")]} />);

  await userEvent.click(screen.getByRole("button", { name: "open Event A" }));

  await userEvent.click(screen.getByLabelText(/^title$/i));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  const backdrop = screen.getByRole("dialog").parentElement?.parentElement as HTMLElement;
  await userEvent.click(backdrop);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Fix 10 — "More options" carries the quick popup's in-progress state forward
// ---------------------------------------------------------------------------

test("More options opens the full editor pre-filled with what was typed in the quick popup", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Trip planning");
  await userEvent.selectOptions(screen.getByLabelText(/^calendar$/i), "shared");

  await userEvent.click(screen.getByRole("button", { name: /more options/i }));

  // The full editor, not the quick popup (the quick popup has no Description).
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Trip planning");
  // Create mode leaves the calendar picker live, and it carries the choice over.
  expect(screen.getByLabelText(/^calendar$/i)).toHaveValue("shared");
  expect(screen.getByLabelText(/start time/i)).toHaveValue("09:00");
});

// ---------------------------------------------------------------------------
// Regression on Fix 10 — an incomplete time string must never reach
// toISOString() during render
// ---------------------------------------------------------------------------
//
// `draftToEventEditorInitial` runs during EventTaskModal's *render*, so
// `new Date("2026-10-22T:00").toISOString()` raising RangeError took the whole
// Calendar page down to Next's global error screen (there's no error boundary
// in app/) — not just the modal. Reachable in one gesture: clear the quick
// popup's start-time field, click "More options".

test("clearing the start time then clicking More options opens the full editor with a sensible default, instead of crashing", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Trip planning");

  fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "" } });
  expect(screen.getByLabelText(/start time/i)).toHaveValue("");

  await userEvent.click(screen.getByRole("button", { name: /more options/i }));

  // The full editor rendered at all — a throw here used to replace the page.
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  // …and seeded the shared 9-10 AM / 1-hour default, not garbage.
  expect(screen.getByLabelText(/start time/i)).toHaveValue("09:00");
  expect(screen.getByLabelText(/end time/i)).toHaveValue("10:00");
  // The rest of the draft still carried over.
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Trip planning");
});

test("clearing only the end time keeps the start the user chose and defaults the end to one hour later", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "14:00" } });
  fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: "" } });

  await userEvent.click(screen.getByRole("button", { name: /more options/i }));

  expect(screen.getByLabelText(/start time/i)).toHaveValue("14:00");
  expect(screen.getByLabelText(/end time/i)).toHaveValue("15:00");
});

test("clearing both times then clicking More options still opens a usable editor, and saving it sends a valid range", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Trip planning");
  fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: "" } });

  await userEvent.click(screen.getByRole("button", { name: /more options/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Trip planning",
      start: "2026-10-22T09:00:00.000Z",
      end: "2026-10-22T10:00:00.000Z",
      allDay: false,
    }),
  );
});

test("clearing the Task side's due time then clicking More options opens the Task editor with no time set", async () => {
  render(<Harness events={[]} />);

  await userEvent.click(screen.getByRole("button", { name: "open create" }));
  await userEvent.click(screen.getByRole("button", { name: "Task" }));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Essay draft");
  fireEvent.change(screen.getByLabelText(/due time/i), { target: { value: "" } });

  await userEvent.click(screen.getByRole("button", { name: /more options/i }));

  // The Task editor (it has a task-list picker; the Event editor has guests).
  expect(screen.getByLabelText(/task list/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Essay draft");
  expect(screen.getByLabelText(/due date/i)).toHaveValue("2026-10-22");
  expect(screen.getByLabelText(/due time/i)).toHaveValue("");
});
