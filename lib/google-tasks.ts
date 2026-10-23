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
 * Page size requested from every paginated Tasks API list call.
 *
 * Google's Tasks API defaults to `maxResults=20` and caps it at 100, and
 * returns a `nextPageToken` whenever more items exist. Asking for the maximum
 * keeps the number of round trips down; the `nextPageToken` loops below are
 * what actually guarantee completeness. This matters most for `listTasks`,
 * which deliberately asks for completed and hidden tasks too — a long-lived
 * list's completed archive can easily fill several pages on its own, and
 * without following the token the still-upcoming tasks a user actually wants
 * on the grid could never be reached.
 */
const TASKS_MAX_RESULTS = "100";

/**
 * Fetches the current user's list of task lists from Google's Tasks API,
 * following `nextPageToken` until every page has been read.
 * Thin REST wrapper: no caching, no filtering — just the HTTP call shape.
 *
 * Google omits the `items` key entirely (rather than sending `items: []`) for
 * a user with zero task lists, so each page's items default to `[]` — a user
 * with no task lists resolves to an empty array instead of throwing and
 * taking down the whole Calendar page's render. Throws on a non-ok response.
 */
export async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const all: GoogleTaskList[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: TASKS_MAX_RESULTS });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://tasks.googleapis.com/tasks/v1/users/@me/lists?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new Error(`Google taskLists request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { items?: GoogleTaskList[]; nextPageToken?: string };
    all.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

/**
 * Fetches tasks for a single task list, following `nextPageToken` until every
 * page has been read. `showCompleted=true` includes completed tasks so they
 * remain visible (e.g., struck-through), and `showHidden=true` includes
 * hidden tasks. Google's response omits `taskListId` on each item, so it is
 * stamped on here before returning. A page with no `items` key contributes
 * nothing rather than throwing. Throws on a non-ok response.
 */
export async function listTasks(accessToken: string, taskListId: string): Promise<GoogleTask[]> {
  const all: GoogleTask[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      showCompleted: "true",
      showHidden: "true",
      maxResults: TASKS_MAX_RESULTS,
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new Error(`Google tasks request failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Omit<GoogleTask, "taskListId">[];
      nextPageToken?: string;
    };
    all.push(...(data.items ?? []).map((item) => ({ ...item, taskListId })));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
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
