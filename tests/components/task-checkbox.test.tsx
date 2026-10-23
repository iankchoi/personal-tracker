// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { mockCompleteTaskAction, mockRefresh } = vi.hoisted(() => ({
  mockCompleteTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-tasks", () => ({ completeTaskAction: mockCompleteTaskAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { TaskCheckbox } from "../../components/calendar/TaskCheckbox";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";

const baseTask: CalendarTaskItem = {
  id: "task-1",
  taskListId: "list-1",
  title: "Buy groceries",
  completed: false,
  dueDate: "2026-10-22",
  dueTime: null,
  colorToken: null,
};

beforeEach(() => {
  mockCompleteTaskAction.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  mockCompleteTaskAction.mockClear();
  mockRefresh.mockClear();
});

test("TaskCheckbox renders unchecked for an incomplete task", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

test("TaskCheckbox renders checked for a completed task", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: true }} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
});

test("clicking the checkbox calls completeTaskAction with the task's ids and the new completed state", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(mockCompleteTaskAction).toHaveBeenCalledWith({
    taskListId: baseTask.taskListId,
    taskId: baseTask.id,
    completed: true,
  });
});

test("clicking a completed task's checkbox calls completeTaskAction with completed: false", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: true }} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(mockCompleteTaskAction).toHaveBeenCalledWith({
    taskListId: baseTask.taskListId,
    taskId: baseTask.id,
    completed: false,
  });
});

test("a completed task's title renders with the struck-through styling class", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: true }} />);
  expect(screen.getByText(baseTask.title)).toHaveClass("task-done");
});

test("an incomplete task's title does not have the struck-through styling class", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  expect(screen.getByText(baseTask.title)).not.toHaveClass("task-done");
});

test("renders a formatted due time when the task has one", () => {
  render(<TaskCheckbox task={{ ...baseTask, dueTime: "14:30" }} />);
  expect(screen.getByText("2:30 PM")).toBeInTheDocument();
});

test("renders no due-time text when the task has none", () => {
  render(<TaskCheckbox task={{ ...baseTask, dueTime: null }} />);
  expect(screen.queryByText(/\d+:\d{2} (AM|PM)/)).not.toBeInTheDocument();
});

test("a rejected completeTaskAction shows an inline error and leaves the checkbox at its original state", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockCompleteTaskAction.mockRejectedValue(new Error("Google said no"));

  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  fireEvent.click(screen.getByRole("checkbox"));

  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't update/i);
  // Controlled by `task.completed`, so a failed toggle reverts to unchecked.
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(mockRefresh).not.toHaveBeenCalled();

  consoleError.mockRestore();
});

test("the checkbox is re-enabled after a failed toggle so the user can retry", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mockCompleteTaskAction.mockRejectedValue(new Error("Google said no"));

  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  fireEvent.click(screen.getByRole("checkbox"));

  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeDisabled());

  consoleError.mockRestore();
});

test("the checkbox is disabled while the toggle is in flight, so a double-click can't fire two overlapping actions", async () => {
  let resolveAction: (() => void) | undefined;
  mockCompleteTaskAction.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveAction = resolve;
      }),
  );

  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  const checkbox = screen.getByRole("checkbox");
  fireEvent.click(checkbox);

  await waitFor(() => expect(checkbox).toBeDisabled());
  fireEvent.click(checkbox);
  expect(mockCompleteTaskAction).toHaveBeenCalledTimes(1);

  resolveAction?.();
  await waitFor(() => expect(checkbox).not.toBeDisabled());
});
