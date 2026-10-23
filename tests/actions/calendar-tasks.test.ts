import { beforeEach, expect, test, vi } from "vitest";

const {
  mockAuth,
  mockGetGoogleAccessToken,
  mockCreateTask,
  mockUpdateTask,
  mockDeleteTask,
  mockSetTaskComplete,
  mockUpsertTaskMetadata,
  mockDeleteTaskMetadata,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockCreateTask: vi.fn(),
  mockUpdateTask: vi.fn(),
  mockDeleteTask: vi.fn(),
  mockSetTaskComplete: vi.fn(),
  mockUpsertTaskMetadata: vi.fn(),
  mockDeleteTaskMetadata: vi.fn(),
}));

vi.mock("../../auth", () => ({ auth: mockAuth }));
vi.mock("../../lib/google-token", () => ({ getGoogleAccessToken: mockGetGoogleAccessToken }));
vi.mock("../../lib/google-tasks", () => ({
  createTask: mockCreateTask,
  updateTask: mockUpdateTask,
  deleteTask: mockDeleteTask,
  setTaskComplete: mockSetTaskComplete,
}));
vi.mock("../../lib/task-metadata", () => ({
  upsertTaskMetadata: mockUpsertTaskMetadata,
  deleteTaskMetadata: mockDeleteTaskMetadata,
}));

import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  updateTaskAction,
  type TaskActionInput,
} from "../../lib/actions/calendar-tasks";

function baseInput(overrides: Partial<TaskActionInput> = {}): TaskActionInput {
  return {
    taskListId: "list1",
    title: "Buy groceries",
    dueDate: null,
    dueTime: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ user: { id: "user-1", needsGoogleReconnect: false } });
  mockGetGoogleAccessToken.mockReset().mockResolvedValue({ accessToken: "test-token", needsGoogleReconnect: false });
  mockCreateTask.mockReset();
  mockUpdateTask.mockReset();
  mockDeleteTask.mockReset();
  mockSetTaskComplete.mockReset();
  mockUpsertTaskMetadata.mockReset().mockResolvedValue({});
  mockDeleteTaskMetadata.mockReset().mockResolvedValue(undefined);
});

test("createTaskAction creates the Google task, then upserts task_metadata with the parsed due date/time and color", async () => {
  mockCreateTask.mockResolvedValue({ id: "task1", taskListId: "list1", title: "Buy groceries", status: "needsAction" });

  const result = await createTaskAction(baseInput({ dueDate: "2026-10-25", dueTime: "14:30", colorToken: "rem" }));

  expect(result).toEqual({ id: "task1", taskListId: "list1" });
  expect(mockCreateTask).toHaveBeenCalledWith(
    "test-token",
    "list1",
    expect.objectContaining({ title: "Buy groceries", due: "2026-10-25T00:00:00.000Z" }),
  );
  expect(mockUpsertTaskMetadata).toHaveBeenCalledWith({
    userId: "user-1",
    googleTaskId: "task1",
    googleTaskListId: "list1",
    dueAt: new Date("2026-10-25T14:30:00"),
    colorToken: "rem",
  });
});

test("createTaskAction with dueDate but no dueTime upserts task_metadata with dueAt: null", async () => {
  mockCreateTask.mockResolvedValue({ id: "task2", taskListId: "list1", title: "Buy groceries", status: "needsAction" });

  await createTaskAction(baseInput({ dueDate: "2026-10-25", dueTime: null }));

  expect(mockCreateTask).toHaveBeenCalledWith(
    "test-token",
    "list1",
    expect.objectContaining({ due: "2026-10-25T00:00:00.000Z" }),
  );
  expect(mockUpsertTaskMetadata).toHaveBeenCalledWith(expect.objectContaining({ dueAt: null }));
});

test("createTaskAction with dueDate: null creates the task with no due field and no task_metadata row is required to have a dueAt", async () => {
  mockCreateTask.mockResolvedValue({ id: "task3", taskListId: "list1", title: "Buy groceries", status: "needsAction" });

  await createTaskAction(baseInput({ dueDate: null }));

  const payload = mockCreateTask.mock.calls[0][2];
  expect(payload.due).toBeUndefined();
  expect(mockUpsertTaskMetadata).toHaveBeenCalledWith(expect.objectContaining({ dueAt: null }));
});

test("createTaskAction passes notes and defaults colorToken to null when absent", async () => {
  mockCreateTask.mockResolvedValue({ id: "task3b", taskListId: "list1", title: "Buy groceries", status: "needsAction" });

  await createTaskAction(baseInput({ notes: "pick up milk" }));

  expect(mockCreateTask).toHaveBeenCalledWith(
    "test-token",
    "list1",
    expect.objectContaining({ notes: "pick up milk" }),
  );
  expect(mockUpsertTaskMetadata).toHaveBeenCalledWith(expect.objectContaining({ colorToken: null }));
});

test("updateTaskAction updates the Google task and upserts task_metadata", async () => {
  mockUpdateTask.mockResolvedValue({ id: "task1", taskListId: "list1", title: "Buy groceries", status: "needsAction" });

  const result = await updateTaskAction({
    ...baseInput({ dueDate: "2026-10-25", dueTime: "09:00", colorToken: "wk" }),
    taskId: "task1",
  });

  expect(result).toEqual({ id: "task1" });
  expect(mockUpdateTask).toHaveBeenCalledWith(
    "test-token",
    "list1",
    "task1",
    expect.objectContaining({ title: "Buy groceries", due: "2026-10-25T00:00:00.000Z" }),
  );
  expect(mockUpsertTaskMetadata).toHaveBeenCalledWith({
    userId: "user-1",
    googleTaskId: "task1",
    googleTaskListId: "list1",
    dueAt: new Date("2026-10-25T09:00:00"),
    colorToken: "wk",
  });
});

test("deleteTaskAction deletes the Google task and the task_metadata row", async () => {
  await deleteTaskAction({ taskListId: "list1", taskId: "task1" });

  expect(mockDeleteTask).toHaveBeenCalledWith("test-token", "list1", "task1");
  expect(mockDeleteTaskMetadata).toHaveBeenCalledWith("user-1", "task1", "list1");
});

test("completeTaskAction(..., true) calls setTaskComplete(..., true)", async () => {
  await completeTaskAction({ taskListId: "list1", taskId: "task1", completed: true });

  expect(mockSetTaskComplete).toHaveBeenCalledWith("test-token", "list1", "task1", true);
  expect(mockUpsertTaskMetadata).not.toHaveBeenCalled();
});

test("completeTaskAction(..., false) calls setTaskComplete(..., false)", async () => {
  await completeTaskAction({ taskListId: "list1", taskId: "task1", completed: false });

  expect(mockSetTaskComplete).toHaveBeenCalledWith("test-token", "list1", "task1", false);
});
