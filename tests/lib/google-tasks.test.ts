import { afterEach, expect, test, vi } from "vitest";

import { listTaskLists, listTasks, createTask, setTaskComplete, deleteTask, updateTask } from "../../lib/google-tasks";

/** The stubbed global `fetch`'s recorded calls, as `[url, init]` pairs. */
function fetchCalls(): [string, { body: string }][] {
  return (fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("listTaskLists fetches the user's task lists", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ id: "l1", title: "My Tasks" }] }),
  }));

  const result = await listTaskLists("tok");

  expect(result).toEqual([{ id: "l1", title: "My Tasks" }]);
  // The URL now carries a `maxResults` query string (see TASKS_MAX_RESULTS),
  // so this asserts the endpoint path rather than an exact URL match.
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("https://tasks.googleapis.com/tasks/v1/users/@me/lists"),
    expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
  );
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("maxResults=100"), expect.anything());
});

test("listTaskLists resolves to an empty array when Google omits the items key for a user with zero task lists", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }));

  const result = await listTaskLists("tok");

  expect(result).toEqual([]);
});

test("listTaskLists follows nextPageToken and returns every page's lists combined", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "l1", title: "First" }], nextPageToken: "page-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "l2", title: "Second" }] }),
      }),
  );

  const result = await listTaskLists("tok");

  expect(result).toEqual([
    { id: "l1", title: "First" },
    { id: "l2", title: "Second" },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetchCalls()[0][0]).not.toContain("pageToken");
  expect(fetchCalls()[1][0]).toContain("pageToken=page-2");
});

test("listTasks stamps taskListId onto every returned task and requests completed tasks too", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [{ id: "t1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" }],
    }),
  }));

  const result = await listTasks("tok", "l1");

  expect(result).toEqual([
    { id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" },
  ]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("showCompleted=true"), expect.anything());
});

test("listTasks resolves to an empty array when Google omits the items key for a task list with zero tasks", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }));

  const result = await listTasks("tok", "l1");

  expect(result).toEqual([]);
});

test("listTasks follows nextPageToken and returns every page's tasks combined", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: "t1", title: "Page one", status: "needsAction" }],
          nextPageToken: "page-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "t2", title: "Page two", status: "needsAction" }] }),
      }),
  );

  const result = await listTasks("tok", "l1");

  expect(result).toEqual([
    { id: "t1", taskListId: "l1", title: "Page one", status: "needsAction" },
    { id: "t2", taskListId: "l1", title: "Page two", status: "needsAction" },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetchCalls()[0][0]).toContain("maxResults=100");
  expect(fetchCalls()[0][0]).not.toContain("pageToken");
  expect(fetchCalls()[1][0]).toContain("pageToken=page-2");
});

test("createTask POSTs to the task list's tasks endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "t2", title: "New Task", status: "needsAction" }),
  }));

  const result = await createTask("tok", "l1", { title: "New Task", notes: "Some notes", due: "2026-10-25T00:00:00.000Z" });

  expect(result).toEqual({ id: "t2", taskListId: "l1", title: "New Task", status: "needsAction" });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/lists/l1/tasks"),
    expect.objectContaining({ method: "POST" }),
  );
  const callArgs = fetchCalls()[0];
  const body = JSON.parse(callArgs[1].body);
  expect(body).toEqual({ title: "New Task", notes: "Some notes", due: "2026-10-25T00:00:00.000Z" });
});

test("setTaskComplete PATCHes status to completed and sets a completed timestamp", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "t1", status: "completed", completed: "2026-10-23T12:00:00.000Z" }),
  }));

  await setTaskComplete("tok", "l1", "t1", true);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/lists/l1/tasks/t1"),
    expect.objectContaining({ method: "PATCH" }),
  );
  const callArgs = fetchCalls()[0];
  const body = JSON.parse(callArgs[1].body);
  expect(body.status).toBe("completed");
  expect(body.completed).toBeTruthy();
});

test("setTaskComplete(..., false) PATCHes status back to needsAction with completed: null", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "t1", status: "needsAction", completed: null }),
  }));

  await setTaskComplete("tok", "l1", "t1", false);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/lists/l1/tasks/t1"),
    expect.objectContaining({ method: "PATCH" }),
  );
  const callArgs = fetchCalls()[0];
  const body = JSON.parse(callArgs[1].body);
  expect(body.status).toBe("needsAction");
  expect(body.completed).toBeNull();
});

test("deleteTask throws a descriptive error on a non-ok response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

  await expect(deleteTask("tok", "l1", "t1")).rejects.toThrow();
});

test("updateTask PATCHes the task with provided fields", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "t1", taskListId: "l1", title: "Updated Title", status: "needsAction" }),
  }));

  const result = await updateTask("tok", "l1", "t1", { title: "Updated Title" });

  expect(result).toEqual({ id: "t1", taskListId: "l1", title: "Updated Title", status: "needsAction" });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/lists/l1/tasks/t1"),
    expect.objectContaining({ method: "PATCH" }),
  );
});
