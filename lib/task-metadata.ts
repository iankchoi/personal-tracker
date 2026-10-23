import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { taskMetadata } from "../db/schema";
import type { CalendarColorToken } from "./calendar-colors";

export type TaskMetadataRow = {
  id: string;
  userId: string;
  googleTaskId: string;
  googleTaskListId: string;
  dueAt: Date | null;
  colorToken: CalendarColorToken | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getTaskMetadata(
  userId: string,
  googleTaskId: string,
  googleTaskListId: string
): Promise<TaskMetadataRow | null> {
  const rows = await db
    .select()
    .from(taskMetadata)
    .where(
      and(
        eq(taskMetadata.userId, userId),
        eq(taskMetadata.googleTaskId, googleTaskId),
        eq(taskMetadata.googleTaskListId, googleTaskListId)
      )
    );

  return rows[0] || null;
}

/**
 * Fetches every metadata row this user has for the given Google task ids, in
 * one query.
 *
 * The Calendar page needs the metadata for a whole page's worth of tasks at
 * once; calling `getTaskMetadata` per task would be one database round trip
 * per task (a classic N+1). An empty `taskIds` short-circuits without
 * touching the database — `inArray` with an empty list is both pointless and
 * awkward SQL.
 *
 * Scoped by `userId`, so a task id that happens to collide across users can
 * never leak another user's row.
 */
export async function getTaskMetadataForTasks(
  userId: string,
  taskIds: string[]
): Promise<TaskMetadataRow[]> {
  if (taskIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(taskMetadata)
    .where(and(eq(taskMetadata.userId, userId), inArray(taskMetadata.googleTaskId, taskIds)));
}

export async function upsertTaskMetadata(input: {
  userId: string;
  googleTaskId: string;
  googleTaskListId: string;
  dueAt: Date | null;
  colorToken: CalendarColorToken | null;
}): Promise<TaskMetadataRow> {
  const [row] = await db
    .insert(taskMetadata)
    .values({
      userId: input.userId,
      googleTaskId: input.googleTaskId,
      googleTaskListId: input.googleTaskListId,
      dueAt: input.dueAt,
      colorToken: input.colorToken,
    })
    .onConflictDoUpdate({
      target: [taskMetadata.userId, taskMetadata.googleTaskId, taskMetadata.googleTaskListId],
      set: {
        dueAt: input.dueAt,
        colorToken: input.colorToken,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

export async function deleteTaskMetadata(
  userId: string,
  googleTaskId: string,
  googleTaskListId: string
): Promise<void> {
  await db
    .delete(taskMetadata)
    .where(
      and(
        eq(taskMetadata.userId, userId),
        eq(taskMetadata.googleTaskId, googleTaskId),
        eq(taskMetadata.googleTaskListId, googleTaskListId)
      )
    );
}
