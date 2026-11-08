// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateTaskAction, mockUpdateTaskAction, mockDeleteTaskAction, mockRefresh } = vi.hoisted(() => ({
  mockCreateTaskAction: vi.fn(),
  mockUpdateTaskAction: vi.fn(),
  mockDeleteTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-tasks", () => ({
  createTaskAction: mockCreateTaskAction,
  updateTaskAction: mockUpdateTaskAction,
  deleteTaskAction: mockDeleteTaskAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { TaskEditor } from "../../components/calendar/TaskEditor";
import type { GoogleTaskList } from "../../lib/google-tasks";

const taskLists: GoogleTaskList[] = [
  { id: "list1", title: "My Tasks" },
  { id: "list2", title: "Work" },
];

afterEach(() => {
  cleanup();
  mockCreateTaskAction.mockReset().mockResolvedValue({ id: "t1", taskListId: "list1" });
  mockUpdateTaskAction.mockReset().mockResolvedValue({ id: "t1" });
  mockDeleteTaskAction.mockReset().mockResolvedValue(undefined);
  mockRefresh.mockReset();
});

test("the due time field is optional — Save with a date but no time sends dueTime: null", async () => {
  render(
    <TaskEditor
      mode="create"
      initial={{ taskListId: "list1" }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  // A due date is already seeded by default (create mode's "today" fallback,
  // mirroring EventEditor's own defaultWhen()); the due time field is left
  // untouched/blank.
  await userEvent.type(screen.getByLabelText(/^title$/i), "Buy groceries");
  expect(screen.getByLabelText(/due time/i)).toHaveValue("");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateTaskAction).toHaveBeenCalled());
  expect(mockCreateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Buy groceries", dueTime: null }),
  );
  expect(mockCreateTaskAction.mock.calls[0][0].dueDate).toBeTruthy();
});

test("Save on edit calls updateTaskAction with the taskId", async () => {
  render(
    <TaskEditor
      mode="edit"
      initial={{
        taskId: "t1",
        taskListId: "list1",
        title: "Buy groceries",
        dueDate: "2026-10-25",
        dueTime: "14:30",
        notes: "Milk, eggs",
        colorToken: "note",
      }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Buy groceries");
  expect(screen.getByLabelText(/due date/i)).toHaveValue("2026-10-25");
  expect(screen.getByLabelText(/due time/i)).toHaveValue("14:30");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: "t1",
      taskListId: "list1",
      title: "Buy groceries",
      dueDate: "2026-10-25",
      dueTime: "14:30",
    }),
  );
  expect(mockCreateTaskAction).not.toHaveBeenCalled();
});

test("Delete calls deleteTaskAction and then onDeleted", async () => {
  const onDeleted = vi.fn();
  render(
    <TaskEditor
      mode="edit"
      initial={{
        taskId: "t1",
        taskListId: "list1",
        title: "Buy groceries",
        dueDate: "2026-10-25",
        dueTime: null,
      }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={onDeleted}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

  await vi.waitFor(() => expect(mockDeleteTaskAction).toHaveBeenCalled());
  expect(mockDeleteTaskAction).toHaveBeenCalledWith({ taskListId: "list1", taskId: "t1" });
  expect(onDeleted).toHaveBeenCalled();
});

// Fix 1 — nothing refreshed the grid after a write.
test("a successful save refreshes the route, and a successful delete does too", async () => {
  const { unmount } = render(
    <TaskEditor
      mode="edit"
      initial={{ taskId: "t1", taskListId: "list1", title: "Buy groceries", dueDate: "2026-10-25", dueTime: null }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockRefresh).toHaveBeenCalled();

  mockRefresh.mockReset();
  unmount();

  render(
    <TaskEditor
      mode="edit"
      initial={{ taskId: "t1", taskListId: "list1", title: "Buy groceries", dueDate: "2026-10-25", dueTime: null }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
  await vi.waitFor(() => expect(mockDeleteTaskAction).toHaveBeenCalled());
  expect(mockRefresh).toHaveBeenCalled();
});

test("a failed save surfaces the error inline and does not refresh the route", async () => {
  mockUpdateTaskAction.mockReset().mockRejectedValue(new Error("500"));
  const onSaved = vi.fn();

  render(
    <TaskEditor
      mode="edit"
      initial={{ taskId: "t1", taskListId: "list1", title: "Buy groceries", dueDate: "2026-10-25", dueTime: null }}
      taskLists={taskLists}
      onSaved={onSaved}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("500");
  expect(onSaved).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

// Fix 6 — `notes || undefined` dropped the key, so a PATCH kept the old notes.
test("clearing an existing task's notes sends an empty string, not undefined", async () => {
  render(
    <TaskEditor
      mode="edit"
      initial={{
        taskId: "t1",
        taskListId: "list1",
        title: "Buy groceries",
        dueDate: "2026-10-25",
        dueTime: null,
        notes: "Milk, eggs",
      }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.clear(screen.getByLabelText(/description/i));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ notes: "" }));
});

test("creating a task with no notes still omits the field", async () => {
  render(
    <TaskEditor
      mode="create"
      initial={{ taskListId: "list1" }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText(/^title$/i), "Buy groceries");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateTaskAction).toHaveBeenCalled());
  expect(mockCreateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ notes: undefined }));
});

// Fix 8 — a cleared <input type="date"> reports "", which produced the
// malformed `due: "T00:00:00.000Z"` on an edit.
test("clearing the due date sends dueDate: null, never an empty string", async () => {
  render(
    <TaskEditor
      mode="edit"
      initial={{ taskId: "t1", taskListId: "list1", title: "Buy groceries", dueDate: "2026-10-25", dueTime: null }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.clear(screen.getByLabelText(/due date/i));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalled());
  expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ dueDate: null }));
});

test("Save is disabled while the title is empty or whitespace-only", async () => {
  render(
    <TaskEditor
      mode="create"
      initial={{ taskListId: "list1" }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/^title$/i), "  ");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/^title$/i), "Buy groceries");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
});

test("color defaults to the shared ColorPicker's default (cal/blue) when not overridden", async () => {
  render(
    <TaskEditor
      mode="create"
      initial={{ taskListId: "list1" }}
      taskLists={taskLists}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("radio", { name: /blue/i })).toHaveAttribute("aria-checked", "true");

  await userEvent.type(screen.getByLabelText(/^title$/i), "Buy groceries");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateTaskAction).toHaveBeenCalled());
  expect(mockCreateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ colorToken: null }));
});
