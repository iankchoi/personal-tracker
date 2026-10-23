"use server";

import { auth } from "../../auth";
import type { CalendarColorToken } from "../calendar-colors";
import { createTask, deleteTask, setTaskComplete, updateTask } from "../google-tasks";
import { getGoogleAccessToken } from "../google-token";
import { deleteTaskMetadata, upsertTaskMetadata } from "../task-metadata";

export type TaskActionInput = {
  taskListId: string;
  title: string;
  dueDate: string | null; // YYYY-MM-DD; null = no due date (won't render on the grid)
  dueTime: string | null; // HH:MM; null = date-only
  notes?: string;
  colorToken?: CalendarColorToken | null;
};

/**
 * Resolves the signed-in user's Google access token, the same chokepoint
 * `app/(app)/calendar/page.tsx` already uses. Throws if the user isn't
 * signed in or Google access needs reconnecting — server actions have no
 * request/response to attach a reconnect banner to, so callers are expected
 * to surface the thrown error instead.
 */
async function requireGoogleAccessToken(): Promise<{ userId: string; accessToken: string }> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Not signed in");
  }

  const tokenResult = await getGoogleAccessToken(session.user.id);
  if (tokenResult.needsGoogleReconnect) {
    throw new Error("Google access needs to be reconnected");
  }

  return { userId: session.user.id, accessToken: tokenResult.accessToken };
}

/**
 * Google's Tasks API only accepts a date-only RFC3339 timestamp for `due`
 * (always midnight UTC, per Task 2), so the wall-clock time the user actually
 * picked can't live there. It's instead persisted locally via
 * `upsertTaskMetadata`'s `dueAt`, combining `dueDate` + `dueTime` into a real
 * Date when both are present, or `null` when there's no time (or no date at
 * all) to show.
 */
function parseDueAt(dueDate: string | null, dueTime: string | null): Date | null {
  return dueDate && dueTime ? new Date(`${dueDate}T${dueTime}:00`) : null;
}

export async function createTaskAction(input: TaskActionInput): Promise<{ id: string; taskListId: string }> {
  const { userId, accessToken } = await requireGoogleAccessToken();

  const created = await createTask(accessToken, input.taskListId, {
    title: input.title,
    notes: input.notes,
    due: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : undefined,
  });

  await upsertTaskMetadata({
    userId,
    googleTaskId: created.id,
    googleTaskListId: input.taskListId,
    dueAt: parseDueAt(input.dueDate, input.dueTime),
    colorToken: input.colorToken ?? null,
  });

  return { id: created.id, taskListId: input.taskListId };
}

export async function updateTaskAction(input: TaskActionInput & { taskId: string }): Promise<{ id: string }> {
  const { userId, accessToken } = await requireGoogleAccessToken();

  const updated = await updateTask(accessToken, input.taskListId, input.taskId, {
    title: input.title,
    notes: input.notes,
    due: input.dueDate === null ? null : `${input.dueDate}T00:00:00.000Z`,
  });

  await upsertTaskMetadata({
    userId,
    googleTaskId: updated.id,
    googleTaskListId: input.taskListId,
    dueAt: parseDueAt(input.dueDate, input.dueTime),
    colorToken: input.colorToken ?? null,
  });

  return { id: updated.id };
}

export async function deleteTaskAction(input: { taskListId: string; taskId: string }): Promise<void> {
  const { userId, accessToken } = await requireGoogleAccessToken();

  await deleteTask(accessToken, input.taskListId, input.taskId);
  await deleteTaskMetadata(userId, input.taskId, input.taskListId);
}

/**
 * Completion state is never duplicated locally (per the plan's Global
 * Constraints) — it lives solely on the Google task, so this only calls
 * `setTaskComplete`.
 */
export async function completeTaskAction(
  input: { taskListId: string; taskId: string; completed: boolean },
): Promise<void> {
  const { accessToken } = await requireGoogleAccessToken();

  await setTaskComplete(accessToken, input.taskListId, input.taskId, input.completed);
}
