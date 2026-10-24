// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateEventAction, mockCreateTaskAction } = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockCreateTaskAction: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({ createEventAction: mockCreateEventAction }));
vi.mock("../../lib/actions/calendar-tasks", () => ({ createTaskAction: mockCreateTaskAction }));

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
