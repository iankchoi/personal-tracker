import { expect, test } from "vitest";

import { buildCalendarTaskItems } from "../../lib/calendar-tasks-for-grid";
import type { GoogleTask } from "../../lib/google-tasks";
import type { TaskMetadataRow } from "../../lib/task-metadata";

/** Builds a full `TaskMetadataRow` fixture, overriding only the fields a test cares about. */
function makeMetadataRow(overrides: Partial<TaskMetadataRow> = {}): TaskMetadataRow {
  return {
    id: "meta-1",
    userId: "user-1",
    googleTaskId: "t1",
    googleTaskListId: "l1",
    dueAt: null,
    colorToken: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("buildCalendarTaskItems excludes tasks with no Google due date", () => {
  const tasks: GoogleTask[] = [{ id: "t1", taskListId: "l1", title: "No date", status: "needsAction" }];

  expect(buildCalendarTaskItems(tasks, "l1", new Map())).toEqual([]);
});

test("buildCalendarTaskItems returns an empty array for an empty tasks list (no task lists, or an empty list)", () => {
  expect(buildCalendarTaskItems([], "l1", new Map())).toEqual([]);
});

test("buildCalendarTaskItems keeps the Google due date and falls back to no time/no color when metadata is missing", () => {
  const tasks: GoogleTask[] = [
    { id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" },
  ];

  expect(buildCalendarTaskItems(tasks, "l1", new Map())).toEqual([
    { id: "t1", taskListId: "l1", title: "Essay", notes: undefined, completed: false, dueDate: "2026-10-25", dueTime: null, colorToken: null },
  ]);
});

test("buildCalendarTaskItems applies the task's own metadata row for time and color", () => {
  const tasks: GoogleTask[] = [
    { id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" },
  ];
  const metadataByTaskId = new Map([
    ["t1", makeMetadataRow({ dueAt: new Date("2026-10-25T14:30:00.000Z"), colorToken: "cv" })],
  ]);

  expect(buildCalendarTaskItems(tasks, "l1", metadataByTaskId)).toEqual([
    { id: "t1", taskListId: "l1", title: "Essay", notes: undefined, completed: false, dueDate: "2026-10-25", dueTime: "14:30", colorToken: "cv" },
  ]);
});

test("buildCalendarTaskItems marks a completed Google task as completed: true", () => {
  const tasks: GoogleTask[] = [
    { id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "completed" },
  ];

  expect(buildCalendarTaskItems(tasks, "l1", new Map())).toEqual([
    { id: "t1", taskListId: "l1", title: "Essay", notes: undefined, completed: true, dueDate: "2026-10-25", dueTime: null, colorToken: null },
  ]);
});

test("buildCalendarTaskItems passes a task's notes through unchanged", () => {
  const tasks: GoogleTask[] = [
    {
      id: "t1",
      taskListId: "l1",
      title: "Essay",
      notes: "bring outline",
      due: "2026-10-25T00:00:00.000Z",
      status: "needsAction",
    },
  ];

  expect(buildCalendarTaskItems(tasks, "l1", new Map())[0].notes).toBe("bring outline");
});

test("buildCalendarTaskItems treats a metadata row with a null dueAt the same as a missing row", () => {
  const tasks: GoogleTask[] = [
    { id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" },
  ];
  const metadataByTaskId = new Map([["t1", makeMetadataRow({ dueAt: null, colorToken: "jour" })]]);

  const result = buildCalendarTaskItems(tasks, "l1", metadataByTaskId);

  expect(result[0].dueTime).toBeNull();
  expect(result[0].colorToken).toBe("jour");
});
