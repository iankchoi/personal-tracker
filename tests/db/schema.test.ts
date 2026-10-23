import { eq, or } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";

import { db } from "../../db";
import { reminderLists, reminders, taskMetadata, users } from "../../db/schema";

afterAll(async () => {
  await db.delete(users).where(or(eq(users.email, "a@test.com"), eq(users.email, "b@test.com"), eq(users.email, "taskmeta-a@test.com")));
});

test("deleting a user cascades to their reminder_lists, reminders, and subtasks", async () => {
  const [userA] = await db.insert(users).values({ email: "a@test.com" }).returning();
  const [userB] = await db.insert(users).values({ email: "b@test.com" }).returning();
  const [listA] = await db
    .insert(reminderLists)
    .values({ userId: userA.id, name: "A", color: "#000" })
    .returning();
  await db.insert(reminders).values({ userId: userA.id, listId: listA.id, title: "A's reminder" });

  await db.delete(users).where(eq(users.id, userA.id));

  const remaining = await db.select().from(reminders);
  expect(remaining).toHaveLength(0); // cascaded
  const bStillExists = await db.select().from(users).where(eq(users.id, userB.id));
  expect(bStillExists).toHaveLength(1); // userB untouched
});

test("deleting a user cascades to their task_metadata rows", async () => {
  const [userA] = await db.insert(users).values({ email: "taskmeta-a@test.com" }).returning();
  await db.insert(taskMetadata).values({ userId: userA.id, googleTaskId: "t1", googleTaskListId: "l1" });

  await db.delete(users).where(eq(users.id, userA.id));

  // Scoped to this test's own user: `tests/lib/task-metadata.test.ts` also
  // writes `task_metadata` rows, and vitest runs test files in parallel
  // workers against the same database, so an unfiltered count here sees that
  // file's in-flight rows and fails nondeterministically.
  const remaining = await db.select().from(taskMetadata).where(eq(taskMetadata.userId, userA.id));
  expect(remaining).toHaveLength(0);
});
