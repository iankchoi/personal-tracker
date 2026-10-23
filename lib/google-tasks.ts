export type GoogleTaskList = {
  id: string;
  title: string;
};

export type GoogleTask = {
  id: string;
  taskListId: string;
  title: string;
  notes?: string;
  due?: string;
  status: "needsAction" | "completed";
  completed?: string;
};

/**
 * Fetches the current user's list of task lists from Google's Tasks API.
 * Thin REST wrapper: no caching, no filtering — just the HTTP call shape.
 * Throws on a non-ok response.
 */
export async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const response = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google taskLists request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { items: GoogleTaskList[] };
  return data.items;
}

/**
 * Fetches tasks for a single task list. `showCompleted=true` includes completed
 * tasks so they remain visible (e.g., struck-through), and `showHidden=true`
 * includes hidden tasks. Google's response omits `taskListId` on each item, so
 * it is stamped on here before returning. Throws on a non-ok response.
 */
export async function listTasks(accessToken: string, taskListId: string): Promise<GoogleTask[]> {
  const params = new URLSearchParams({
    showCompleted: "true",
    showHidden: "true",
  });

  const response = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(`Google tasks request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { items: Omit<GoogleTask, "taskListId">[] };
  return data.items.map((item) => ({ ...item, taskListId }));
}

/**
 * Creates a new task in the specified task list. Throws on a non-ok response.
 */
export async function createTask(
  accessToken: string,
  taskListId: string,
  input: { title: string; notes?: string; due?: string },
): Promise<GoogleTask> {
  const response = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new Error(`Google createTask request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Omit<GoogleTask, "taskListId">;
  return { ...data, taskListId };
}

/**
 * Updates a task in the specified task list. Only fields provided in the patch
 * object will be sent. `due` can be set to `null` to clear the due date.
 * Throws on a non-ok response.
 */
export async function updateTask(
  accessToken: string,
  taskListId: string,
  taskId: string,
  patch: Partial<{ title: string; notes: string; due: string | null }>,
): Promise<GoogleTask> {
  const response = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );

  if (!response.ok) {
    throw new Error(`Google updateTask request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Omit<GoogleTask, "taskListId">;
  return { ...data, taskListId };
}

/**
 * Deletes a task from the specified task list. Throws on a non-ok response.
 */
export async function deleteTask(accessToken: string, taskListId: string, taskId: string): Promise<void> {
  const response = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Google deleteTask request failed with status ${response.status}`);
  }
}

/**
 * Marks a task as complete or incomplete. When `completed=true`, sets the
 * status to "completed" and stamps a completion timestamp. When `completed=false`,
 * sets status to "needsAction" and clears the completion timestamp. Throws on
 * a non-ok response.
 */
export async function setTaskComplete(
  accessToken: string,
  taskListId: string,
  taskId: string,
  completed: boolean,
): Promise<GoogleTask> {
  const body = completed
    ? { status: "completed" as const, completed: new Date().toISOString() }
    : { status: "needsAction" as const, completed: null };

  const response = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Google setTaskComplete request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Omit<GoogleTask, "taskListId">;
  return { ...data, taskListId };
}
