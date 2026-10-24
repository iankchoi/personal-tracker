// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateEventAction, mockCreateTaskAction, mockRefresh } = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockCreateTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({ createEventAction: mockCreateEventAction }));
vi.mock("../../lib/actions/calendar-tasks", () => ({ createTaskAction: mockCreateTaskAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { QuickCreatePopup } from "../../components/calendar/QuickCreatePopup";
import type { GoogleCalendarListEntry } from "../../lib/google-calendar";
import type { GoogleTaskList } from "../../lib/google-tasks";

const cals: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "iankangchoi@gmail.com", backgroundColor: "#3b6ea5", primary: true, accessRole: "owner" },
  { id: "shared", summary: "Shared", backgroundColor: "#2f7a6b", accessRole: "writer" },
];

const lists: GoogleTaskList[] = [
  { id: "list-1", title: "My Tasks" },
  { id: "list-2", title: "Canvas" },
];

afterEach(() => {
  cleanup();
  mockCreateEventAction.mockReset().mockResolvedValue({ id: "e1", calendarId: "primary" });
  mockCreateTaskAction.mockReset().mockResolvedValue({ id: "t1", taskListId: "list-1" });
  mockRefresh.mockReset();
});

test("defaults to Event selected, with the clicked date/hour prefilled", () => {
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={vi.fn()}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Event" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText(/start time/i)).toHaveValue("09:00");
});

test("switching to Task hides the calendar picker and shows the task-list picker", () => {
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={vi.fn()}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Task" }));

  expect(screen.getByLabelText(/task list/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/calendar/i)).not.toBeInTheDocument();
});

test("Save on the Event side calls createEventAction with the title, 1-hour default end, and chosen calendar", async () => {
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={vi.fn()}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Standup" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Standup", allDay: false, calendarId: "primary" }),
  );
});

test("Save on the Task side with Month/Agenda-style initial (no hour) defaults to no time set", async () => {
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "task", date: new Date(2026, 9, 22) }}
      onMoreOptions={vi.fn()}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Essay draft" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await vi.waitFor(() => expect(mockCreateTaskAction).toHaveBeenCalled());
  expect(mockCreateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Essay draft", dueTime: null, taskListId: "list-1" }),
  );
});

test("More options calls onMoreOptions instead of saving", () => {
  const onMoreOptions = vi.fn();
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={onMoreOptions}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByText(/more options/i));

  expect(onMoreOptions).toHaveBeenCalled();
  expect(mockCreateEventAction).not.toHaveBeenCalled();
});

// Fix 1 — nothing refreshed the grid after the most common creation path.
test("a successful save refreshes the route before calling onSaved", async () => {
  const onSaved = vi.fn();
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={vi.fn()}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Standup" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mockRefresh).toHaveBeenCalled();
});

// Fix 9 — this path had no catch at all, so a rejected action was an unhandled
// rejection with zero visible feedback.
test("a failed save surfaces the error inline, keeps the popup open, and never calls onSaved", async () => {
  mockCreateEventAction.mockReset().mockRejectedValue(new Error("Google access needs to be reconnected"));
  const onSaved = vi.fn();

  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={vi.fn()}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Standup" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Google access needs to be reconnected");
  expect(onSaved).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

// Fix 10 — "More options" used to re-derive the full editor's defaults from
// the original click, discarding everything typed here.
test("More options hands over the current in-progress form state, not the original defaults", () => {
  const onMoreOptions = vi.fn();
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }}
      onMoreOptions={onMoreOptions}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Trip planning" } });
  fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: "14:00" } });
  fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: "15:30" } });
  fireEvent.change(screen.getByLabelText(/^calendar$/i), { target: { value: "shared" } });

  fireEvent.click(screen.getByText(/more options/i));

  expect(onMoreOptions).toHaveBeenCalledWith({
    kind: "event",
    title: "Trip planning",
    date: "2026-10-22",
    startTime: "14:00",
    endTime: "15:30",
    dueTime: "09:00",
    calendarId: "shared",
    taskListId: "list-1",
  });
});

test("More options after switching to Task hands over the Task side's kind, due time, and chosen list", () => {
  const onMoreOptions = vi.fn();
  render(
    <QuickCreatePopup
      calendars={cals}
      taskLists={lists}
      initial={{ kind: "event", date: new Date(2026, 9, 22) }}
      onMoreOptions={onMoreOptions}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Task" }));
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Essay draft" } });
  fireEvent.change(screen.getByLabelText(/due time/i), { target: { value: "17:00" } });
  fireEvent.change(screen.getByLabelText(/task list/i), { target: { value: "list-2" } });

  fireEvent.click(screen.getByText(/more options/i));

  expect(onMoreOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "task",
      title: "Essay draft",
      date: "2026-10-22",
      dueTime: "17:00",
      taskListId: "list-2",
    }),
  );
});
