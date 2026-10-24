// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateTaskAction, mockUpdateTaskAction, mockDeleteTaskAction } = vi.hoisted(() => ({
  mockCreateTaskAction: vi.fn(),
  mockUpdateTaskAction: vi.fn(),
  mockDeleteTaskAction: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-tasks", () => ({
  createTaskAction: mockCreateTaskAction,
  updateTaskAction: mockUpdateTaskAction,
  deleteTaskAction: mockDeleteTaskAction,
}));

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
