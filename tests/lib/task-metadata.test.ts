import { eq, or } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";

import { db } from "../../db";
import { users } from "../../db/schema";
import {
  deleteTaskMetadata,
  getTaskMetadata,
  upsertTaskMetadata,
} from "../../lib/task-metadata";

afterAll(async () => {
  await db.delete(users).where(
    or(
      eq(users.email, "taskmeta-lib-upsert@test.com"),
      eq(users.email, "taskmeta-lib-get@test.com"),
      eq(users.email, "taskmeta-lib-delete@test.com")
    )
  );
});

test("upsertTaskMetadata creates a row on first call and updates it in place on a second call", async () => {
  const [user] = await db.insert(users).values({ email: "taskmeta-lib-upsert@test.com" }).returning();

  const firstCall = await upsertTaskMetadata({
    userId: user.id,
    googleTaskId: "t1",
    googleTaskListId: "l1",
    dueAt: new Date("2025-01-01"),
    colorToken: "cal",
  });

  expect(firstCall.id).toBeDefined();
  expect(firstCall.googleTaskId).toBe("t1");
  expect(firstCall.googleTaskListId).toBe("l1");
  expect(firstCall.colorToken).toBe("cal");

  const secondCall = await upsertTaskMetadata({
    userId: user.id,
    googleTaskId: "t1",
    googleTaskListId: "l1",
    dueAt: new Date("2025-02-01"),
    colorToken: "rem",
  });

  expect(secondCall.id).toBe(firstCall.id);
  expect(secondCall.colorToken).toBe("rem");
  expect(secondCall.dueAt).toEqual(new Date("2025-02-01"));
});

test("getTaskMetadata returns null for an unknown task", async () => {
  const [user] = await db.insert(users).values({ email: "taskmeta-lib-get@test.com" }).returning();

  const result = await getTaskMetadata(user.id, "unknown", "unknown");

  expect(result).toBeNull();
});

test("deleteTaskMetadata removes the row", async () => {
  const [user] = await db.insert(users).values({ email: "taskmeta-lib-delete@test.com" }).returning();

  await upsertTaskMetadata({
    userId: user.id,
    googleTaskId: "t2",
    googleTaskListId: "l2",
    dueAt: null,
    colorToken: null,
  });

  await deleteTaskMetadata(user.id, "t2", "l2");

  const result = await getTaskMetadata(user.id, "t2", "l2");

  expect(result).toBeNull();
});
