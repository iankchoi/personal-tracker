# Calendar — Event & Task Creation, Part 1: Foundations & Task Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 1 of 3** of the Calendar Event & Task Creation feature. This part builds the data model and API clients, makes Google Tasks render on the Calendar grid (with complete/incomplete checkboxes), and fixes Day/Week's overlapping-event layout. It ships working, testable value on its own — tasks become visible, overlap stops stacking — with no create/edit UI yet. **Part 2** (`2026-10-22-calendar-event-task-creation-2-create-edit.md`) builds click-to-create, the full editors, and Places autocomplete on top of this. **Part 3** (`2026-10-22-calendar-event-task-creation-3-recurrence.md`) builds recurring-event support on top of Part 2.

**Goal:** Lay the data and API foundation for event/task writes, and make Google Tasks visible and completable on the Calendar grid, with Day/Week's overlapping events rendering side-by-side instead of stacked.

**Architecture:** Two new thin REST clients (`lib/google-tasks.ts`, an extended `lib/google-calendar.ts`) back a small set of server actions (`lib/actions/calendar-events.ts`, `lib/actions/calendar-tasks.ts`) that are the only place writes happen — built now even though no UI calls them yet, so Part 2 can build directly against a stable, already-tested surface. One new Postgres table (`task_metadata`) holds the two things Google Tasks has nowhere to put: a time-of-day and a color. The Calendar page fetches tasks alongside events and merges them into each view's existing day-bucketing logic.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Drizzle ORM/Postgres, Vitest + Testing Library, vanilla `fetch` REST clients (no Google API SDK, matching the existing `lib/google-calendar.ts` style).

**Spec:** `docs/superpowers/specs/2026-10-22-calendar-event-task-creation-design.md`

## Global Constraints

- Events are written through the real Google Calendar API (`events.insert`/`events.patch`/`events.delete`) — never duplicated into Postgres. Tasks are written through the real Google Tasks API (`tasks.insert`/`tasks.patch`/`tasks.delete`) — title/notes/status/due stay live-read from Google; only a time-of-day and a color live locally.
- Google Tasks' `due` field is **date-only** (hard API limit) — any time-of-day lives only in the new `task_metadata` table.
- Adding an attendee via an event's `attendees` field triggers a real Gmail invite from Google — no custom email system is built (not exercised until Part 2, but the action's shape is decided now).
- No new OAuth scopes are needed for Calendar or Tasks — `auth.ts` already requests `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks` (full read/write), confirmed at `auth.ts:94`.
- Per-event color is the real Google `colorId` field (an 11-value enum); per-task color is local-only (no such field exists in the Tasks API) and lives in `task_metadata`.
- Per-item color is an **override** on top of the existing per-calendar color assignment (`lib/calendar-colors.ts`, unchanged) — absent an override, an event/task still shows its calendar's/list's assigned color.
- Icons match the sidebar's existing visual language: inline SVG, `viewBox="0 0 24 24"`, rendered 16×16, `stroke-width: 1.6`, `stroke: currentColor`, `fill: none` — no emoji, no icon font/library.
- All date/time handling follows the existing convention in `lib/calendar-dates.ts`: an event's own wall-clock components are read from its ISO string's literal digits (`parseZonedDateTime`), never via `new Date(...)` plus local accessors.

## Review Focus

- **A task with a Google `due` date but no `task_metadata` row** (created by another Google Tasks client, not this app) must still render on the grid — no time, default color — not throw. Covered in Task 6.
- **A user with no Google Task lists, or lists with zero tasks,** must not crash the Calendar page — the grid should render normally with just events. Covered in Task 6.

---

## File Structure

**New files:**
- `lib/google-tasks.ts` — Google Tasks REST client (list/create/update/delete/complete)
- `lib/task-metadata.ts` — Drizzle queries against the new `task_metadata` table
- `lib/calendar-event-colors.ts` — app color token ↔ Google `colorId` mapping
- `lib/calendar-overlap.ts` — Day/Week overlapping-event column layout
- `lib/calendar-tasks-for-grid.ts` — merges a task list's Google tasks with their local metadata into render-ready items
- `lib/actions/calendar-events.ts` — `"use server"` create/update/delete actions for events
- `lib/actions/calendar-tasks.ts` — `"use server"` create/update/delete/complete actions for tasks
- `components/calendar/TaskCheckbox.tsx` — complete/incomplete checkbox + title, used by every view

**Modified files:**
- `db/schema.ts` — add `taskMetadata` table
- `lib/google-calendar.ts` — extend `GoogleCalendarListEntry`/`GoogleCalendarEvent`, add `createEvent`/`updateEvent`/`deleteEvent`
- `app/(app)/calendar/page.tsx` — fetch task lists/tasks/metadata, merge into the render model
- `components/calendar/HourGrid.tsx` — render tasks, use overlap layout for timed events
- `components/calendar/MonthView.tsx` — merge tasks into day cells
- `components/calendar/AgendaView.tsx` — merge tasks into day groups
- `components/calendar/DayView.tsx` — pass through task data
- `app/globals.css` — task-checkbox and overlap-column styles

---

### Task 1: Task metadata table

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/task-metadata.ts`
- Test: `tests/lib/task-metadata.test.ts`
- Test: `tests/db/schema.test.ts` (add one case)

**Interfaces:**
- Produces: `taskMetadata` Drizzle table; `getTaskMetadata(userId, googleTaskId, googleTaskListId): Promise<TaskMetadataRow | null>`, `upsertTaskMetadata(input: { userId: string; googleTaskId: string; googleTaskListId: string; dueAt: Date | null; colorToken: CalendarColorToken | null }): Promise<TaskMetadataRow>`, `deleteTaskMetadata(userId, googleTaskId, googleTaskListId): Promise<void>`, where `TaskMetadataRow = { id: string; userId: string; googleTaskId: string; googleTaskListId: string; dueAt: Date | null; colorToken: CalendarColorToken | null; createdAt: Date; updatedAt: Date }`.

- [ ] **Step 1: Add the `taskMetadata` table to `db/schema.ts`**

Follow the `canvasSync` table's shape and style (`db/schema.ts:147-164`) immediately below it:

```ts
export const taskMetadata = pgTable(
  "task_metadata",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    googleTaskId: text("google_task_id").notNull(),
    googleTaskListId: text("google_task_list_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    colorToken: text("color_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.googleTaskId, table.googleTaskListId)],
);
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx drizzle-kit generate` then `npm run db:migrate`
Expected: a new file under `drizzle/` creating `task_metadata`; migration applies cleanly against `DATABASE_URL`.

- [ ] **Step 3: Write the failing cascade-delete test**

Add to `tests/db/schema.test.ts`, following the existing `userA`/`userB` pattern (lines 11-26):

```ts
test("deleting a user cascades to their task_metadata rows", async () => {
  const [userA] = await db.insert(users).values({ email: "taskmeta-a@test.com" }).returning();
  await db.insert(taskMetadata).values({ userId: userA.id, googleTaskId: "t1", googleTaskListId: "l1" });

  await db.delete(users).where(eq(users.id, userA.id));

  const remaining = await db.select().from(taskMetadata);
  expect(remaining).toHaveLength(0);
});
```

(Remember to add `taskMetadata` to the import and to the `afterAll` cleanup's email list.)

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: FAIL (table/import doesn't exist) before Step 1-2, PASS after.

- [ ] **Step 5: Write `lib/task-metadata.ts`**

Implement `getTaskMetadata`, `upsertTaskMetadata` (use Drizzle's `.onConflictDoUpdate` targeting the `(userId, googleTaskId, googleTaskListId)` unique constraint, setting `updatedAt: new Date()`), `deleteTaskMetadata`.

- [ ] **Step 6: Write and run `tests/lib/task-metadata.test.ts`**

Test names: `"upsertTaskMetadata creates a row on first call and updates it in place on a second call"`, `"getTaskMetadata returns null for an unknown task"`, `"deleteTaskMetadata removes the row"`. Use the real test DB (same pattern as `tests/db/schema.test.ts`), clean up inserted users in `afterAll`.

Run: `npx vitest run tests/lib/task-metadata.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts drizzle lib/task-metadata.ts tests/lib/task-metadata.test.ts tests/db/schema.test.ts
git commit -m "feat: add task_metadata table for task time-of-day and color overrides"
```

---

### Task 2: Google Tasks API client

**Files:**
- Create: `lib/google-tasks.ts`
- Test: `tests/lib/google-tasks.test.ts`

**Interfaces:**
- Produces: `GoogleTaskList = { id: string; title: string }`; `GoogleTask = { id: string; taskListId: string; title: string; notes?: string; due?: string; status: "needsAction" | "completed"; completed?: string }`; `listTaskLists(accessToken: string): Promise<GoogleTaskList[]>`; `listTasks(accessToken: string, taskListId: string): Promise<GoogleTask[]>`; `createTask(accessToken: string, taskListId: string, input: { title: string; notes?: string; due?: string }): Promise<GoogleTask>`; `updateTask(accessToken: string, taskListId: string, taskId: string, patch: Partial<{ title: string; notes: string; due: string | null }>): Promise<GoogleTask>`; `deleteTask(accessToken: string, taskListId: string, taskId: string): Promise<void>`; `setTaskComplete(accessToken: string, taskListId: string, taskId: string, completed: boolean): Promise<GoogleTask>`.

- [ ] **Step 1: Write the failing tests**

Mirror `tests/lib/google-calendar.test.ts`'s `vi.stubGlobal("fetch", ...)` style. Key cases:

```ts
test("listTaskLists fetches the user's task lists", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "l1", title: "My Tasks" }] }) }));
  expect(await listTaskLists("tok")).toEqual([{ id: "l1", title: "My Tasks" }]);
  expect(fetch).toHaveBeenCalledWith(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
  );
});

test("listTasks stamps taskListId onto every returned task and requests completed tasks too", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: "t1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" }] }) }));
  expect(await listTasks("tok", "l1")).toEqual([{ id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" }]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("showCompleted=true"), expect.anything());
});

test("createTask POSTs to the task list's tasks endpoint", async () => { /* assert method: "POST", body JSON.stringify({ title, notes, due }), URL .../lists/l1/tasks */ });

test("setTaskComplete PATCHes status to completed and sets a completed timestamp", async () => {
  // assert body includes { status: "completed" } and a non-null `completed` field
});

test("setTaskComplete(..., false) PATCHes status back to needsAction with completed: null", async () => {
  // assert body is { status: "needsAction", completed: null }
});

test("deleteTask throws a descriptive error on a non-ok response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  await expect(deleteTask("tok", "l1", "t1")).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/google-tasks.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement `lib/google-tasks.ts`**

Base URL `https://tasks.googleapis.com/tasks/v1`. `listTaskLists` → `GET /users/@me/lists`. `listTasks` → `GET /lists/{taskListId}/tasks?showCompleted=true&showHidden=true` (completed tasks must still be fetched so a just-checked-off task keeps rendering struck-through instead of disappearing), stamping `taskListId` onto each item the same way `listEvents` stamps `calendarId` (`lib/google-calendar.ts:63-64`). `createTask` → `POST /lists/{taskListId}/tasks`. `updateTask` → `PATCH /lists/{taskListId}/tasks/{taskId}`. `deleteTask` → `DELETE /lists/{taskListId}/tasks/{taskId}`. `setTaskComplete` → `PATCH /lists/{taskListId}/tasks/{taskId}` with body `{ status: "completed", completed: new Date().toISOString() }` or `{ status: "needsAction", completed: null }`. Every function throws a descriptive `Error` on a non-ok response, matching `listEvents`' existing style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/google-tasks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/google-tasks.ts tests/lib/google-tasks.test.ts
git commit -m "feat: add Google Tasks API client"
```

---

### Task 3: Google Calendar write client + extended event type

**Files:**
- Modify: `lib/google-calendar.ts`
- Test: `tests/lib/google-calendar.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GoogleCalendarListEntry` gains `accessRole?: "owner" | "writer" | "reader" | "freeBusyReader"`. `GoogleCalendarEvent` gains `recurringEventId?: string; recurrence?: string[]; colorId?: string; location?: string; description?: string; attendees?: { email: string }[]; conferenceData?: { createRequest?: { requestId: string }; entryPoints?: { entryPointType: string; uri: string }[] }; reminders?: { useDefault: boolean; overrides?: { method: "popup"; minutes: number }[] }; guestsCanModify?: boolean; guestsCanInviteOthers?: boolean; guestsCanSeeOtherGuests?: boolean; organizer?: { self?: boolean }`. New: `createEvent(accessToken: string, calendarId: string, event: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent>`; `updateEvent(accessToken: string, calendarId: string, eventId: string, patch: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent>`; `deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("createEvent POSTs to the calendar's events endpoint and returns the created event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new1", summary: "Standup", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T10:00:00-04:00" } }) }));
  const result = await createEvent("tok", "primary", { summary: "Standup", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T10:00:00-04:00" } });
  expect(result.calendarId).toBe("primary");
  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    expect.objectContaining({ method: "POST" }),
  );
});

test("createEvent requests conferenceDataVersion=1 when conferenceData.createRequest is set", async () => {
  // assert the request URL contains "conferenceDataVersion=1" when event.conferenceData is present, and omits it otherwise
});

test("updateEvent PATCHes the specific event", async () => {
  // assert PATCH to .../calendars/primary/events/evt1, body is JSON.stringify(patch)
});

test("deleteEvent DELETEs the specific event and throws on a non-ok response", async () => {
  // success case: DELETE to .../calendars/primary/events/evt1, no return value
  // failure case: ok: false -> rejects.toThrow()
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: FAIL (functions don't exist)

- [ ] **Step 3: Extend the types and add the three functions**

Add the new optional fields to `GoogleCalendarListEntry`/`GoogleCalendarEvent` (`lib/google-calendar.ts:1-14`). `createEvent`/`updateEvent` stamp `calendarId` onto the returned object the same way `listEvents` does. `createEvent` appends `?conferenceDataVersion=1` to the URL only when `event.conferenceData?.createRequest` is present — Google rejects `conferenceData` writes without that query param. All three throw a descriptive `Error` on a non-ok response.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/google-calendar.ts tests/lib/google-calendar.test.ts
git commit -m "feat: add Google Calendar event write client (create/update/delete)"
```

---

### Task 4: Color token ↔ Google colorId mapping

**Files:**
- Create: `lib/calendar-event-colors.ts`
- Test: `tests/lib/calendar-event-colors.test.ts`

**Interfaces:**
- Consumes: `CalendarColorToken` from `lib/calendar-colors.ts`.
- Produces: `TOKEN_TO_COLOR_ID: Record<CalendarColorToken, string>`; `colorIdForToken(token: CalendarColorToken): string`; `tokenForColorId(colorId: string | undefined): CalendarColorToken | null` (returns `null` for an unmapped or absent `colorId`, meaning "no override — use the calendar's own color").

- [ ] **Step 1: Write the failing tests**

```ts
test("colorIdForToken maps each of the 6 app tokens to a distinct Google colorId", () => {
  const ids = (["cal", "wk", "rem", "note", "jour", "cv"] as const).map(colorIdForToken);
  expect(new Set(ids).size).toBe(6);
});

test("colorIdForToken maps cal to Google's Peacock (7)", () => {
  expect(colorIdForToken("cal")).toBe("7");
});

test("tokenForColorId is the inverse of colorIdForToken for every app token", () => {
  for (const token of ["cal", "wk", "rem", "note", "jour", "cv"] as const) {
    expect(tokenForColorId(colorIdForToken(token))).toBe(token);
  }
});

test("tokenForColorId returns null for a colorId the app never writes (e.g. Lavender) and for undefined", () => {
  expect(tokenForColorId("1")).toBeNull();
  expect(tokenForColorId(undefined)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-event-colors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the mapping**

Use this exact nearest-hue mapping (Google's fixed `colorId` enum: 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana, 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato — matched against each token's `--*-accent` hex in `app/globals.css:14-19`):

| Token | Hex | → colorId | Name |
|---|---|---|---|
| `cal` | `#3b6ea5` | `"7"` | Peacock |
| `wk` | `#2f7a6b` | `"2"` | Sage |
| `rem` | `#92650f` | `"5"` | Banana |
| `note` | `#4b7a5a` | `"10"` | Basil |
| `jour` | `#7a4a6a` | `"3"` | Grape |
| `cv` | `#b2483f` | `"11"` | Tomato |

`tokenForColorId` builds its lookup by inverting `TOKEN_TO_COLOR_ID`; any `colorId` not in that inverted map (including `undefined`) returns `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-event-colors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-event-colors.ts tests/lib/calendar-event-colors.test.ts
git commit -m "feat: add app color token to Google colorId mapping"
```

---

### Task 5: Server actions for events and tasks (non-recurring, full field surface)

**Files:**
- Create: `lib/actions/calendar-events.ts`
- Create: `lib/actions/calendar-tasks.ts`
- Test: `tests/actions/calendar-events.test.ts`
- Test: `tests/actions/calendar-tasks.test.ts`

**Interfaces:**
- Consumes: `getGoogleAccessToken` (`lib/google-token.ts`), `createEvent`/`updateEvent`/`deleteEvent` (Task 3), `createTask`/`updateTask`/`deleteTask`/`setTaskComplete` (Task 2), `upsertTaskMetadata`/`deleteTaskMetadata` (Task 1), `colorIdForToken` (Task 4).
- Produces (locked for Part 2 and Part 3 to build against — fields unused by Part 2's early tasks are still part of the type and handled in the body, just not yet populated by a form; Part 3 is the only later plan that changes this file's behavior, adding `scope`-aware branching to `updateEventAction`/`deleteEventAction`):

```ts
// lib/actions/calendar-events.ts
export type RecurrenceEditScope = "this" | "all" | "following";

export type EventActionInput = {
  calendarId: string;
  title: string;
  start: string;       // ISO date-time, or YYYY-MM-DD when allDay
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  colorToken?: CalendarColorToken | null; // null/absent = no override
  notifyMinutesBefore?: number | null;    // null = no reminder
  addGoogleMeet?: boolean;
  guestEmails?: string[];
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  recurrence?: string[]; // RRULE lines; absent = one-off
};

export async function createEventAction(input: EventActionInput): Promise<{ id: string; calendarId: string }>;
export async function updateEventAction(
  input: EventActionInput & { eventId: string; scope?: RecurrenceEditScope },
): Promise<{ id: string }>;
export async function deleteEventAction(
  input: { calendarId: string; eventId: string; scope?: RecurrenceEditScope },
): Promise<void>;
```

```ts
// lib/actions/calendar-tasks.ts
export type TaskActionInput = {
  taskListId: string;
  title: string;
  dueDate: string | null; // YYYY-MM-DD; null = no due date (won't render on the grid)
  dueTime: string | null; // HH:MM; null = date-only
  notes?: string;
  colorToken?: CalendarColorToken | null;
};

export async function createTaskAction(input: TaskActionInput): Promise<{ id: string; taskListId: string }>;
export async function updateTaskAction(input: TaskActionInput & { taskId: string }): Promise<{ id: string }>;
export async function deleteTaskAction(input: { taskListId: string; taskId: string }): Promise<void>;
export async function completeTaskAction(
  input: { taskListId: string; taskId: string; completed: boolean },
): Promise<void>;
```

This task implements the **non-recurring** path only: `scope` is accepted but ignored (every call acts on exactly the given `eventId`); `recurrence` is passed straight through to `createEvent` unmodified.

- [ ] **Step 1: Write the failing tests**

Both action modules need the signed-in user's id, which in a real request comes from `auth()` — but a server action under test has no request context, so mock `auth` the same way the existing auth-dependent tests in this repo do (check `tests/auth/auth.test.ts` for the exact mocking pattern used elsewhere) and mock `getGoogleAccessToken` to resolve a fixed token. Key cases:

```ts
test("createEventAction builds the Google event payload from the input and returns its id", async () => {
  // mock createEvent to capture its call; assert payload.summary === title, start/end pass through,
  // allDay true -> payload.start = { date: input.start } (no dateTime), allDay false -> { dateTime: input.start }
});

test("createEventAction maps colorToken to colorId and omits colorId when colorToken is absent", async () => {
  // colorToken: "cv" -> payload.colorId === colorIdForToken("cv"); colorToken omitted -> payload.colorId undefined
});

test("createEventAction sets reminders.overrides from notifyMinutesBefore, and useDefault:false", async () => {
  // notifyMinutesBefore: 10 -> payload.reminders === { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] }
});

test("createEventAction omits reminders when notifyMinutesBefore is null", async () => { /* ... */ });

test("createEventAction sets attendees from guestEmails and the three guest-permission flags", async () => { /* ... */ });

test("createEventAction requests a Google Meet link when addGoogleMeet is true", async () => {
  // payload.conferenceData.createRequest.requestId is a non-empty string
});

test("deleteEventAction calls deleteEvent with the given calendarId and eventId", async () => { /* ... */ });
```

```ts
test("createTaskAction creates the Google task, then upserts task_metadata with the parsed due date/time and color", async () => {
  // dueDate "2026-10-25", dueTime "14:30" -> createTask called with due: "2026-10-25T00:00:00.000Z"
  // upsertTaskMetadata called with dueAt = new Date("2026-10-25T14:30:00")
});

test("createTaskAction with dueDate but no dueTime upserts task_metadata with dueAt: null", async () => { /* ... */ });

test("createTaskAction with dueDate: null creates the task with no due field and no task_metadata row is required to have a dueAt", async () => { /* ... */ });

test("deleteTaskAction deletes the Google task and the task_metadata row", async () => {
  // both deleteTask and deleteTaskMetadata are called with matching ids
});

test("completeTaskAction(..., true) calls setTaskComplete(..., true)", async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/calendar-events.test.ts tests/actions/calendar-tasks.test.ts`
Expected: FAIL (modules don't exist)

- [ ] **Step 3: Implement `lib/actions/calendar-events.ts`**

Each action starts `const session = await auth(); const { accessToken } = await getGoogleAccessToken(session!.user.id);` (same chokepoint `app/(app)/calendar/page.tsx` already uses). Build the Google event payload from `EventActionInput`:
- `start`/`end`: `allDay ? { date: value } : { dateTime: value }`.
- `colorId: input.colorToken ? colorIdForToken(input.colorToken) : undefined`.
- `reminders: input.notifyMinutesBefore != null ? { useDefault: false, overrides: [{ method: "popup", minutes: input.notifyMinutesBefore }] } : undefined`.
- `attendees: input.guestEmails?.map((email) => ({ email }))`.
- `conferenceData: input.addGoogleMeet ? { createRequest: { requestId: crypto.randomUUID() } } : undefined`.
- `recurrence: input.recurrence`.
Call `createEvent`/`updateEvent`/`deleteEvent` from Task 3. `updateEventAction`/`deleteEventAction` ignore `scope` in this task (always act on `eventId` as given — Part 3 changes this).

- [ ] **Step 4: Implement `lib/actions/calendar-tasks.ts`**

`createTaskAction`/`updateTaskAction`: call `createTask`/`updateTask` with `due: input.dueDate ? \`${input.dueDate}T00:00:00.000Z\` : undefined` (Tasks API date-only requirement, per Task 2), then call `upsertTaskMetadata` with `dueAt` computed as `input.dueDate && input.dueTime ? new Date(\`${input.dueDate}T${input.dueTime}:00\`) : null` and `colorToken: input.colorToken ?? null`. `deleteTaskAction` calls `deleteTask` then `deleteTaskMetadata`. `completeTaskAction` calls `setTaskComplete` only (completion state is never duplicated locally, per the Global Constraints).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/actions/calendar-events.test.ts tests/actions/calendar-tasks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/actions/calendar-events.ts lib/actions/calendar-tasks.ts tests/actions
git commit -m "feat: add server actions for creating, updating, and deleting events and tasks"
```

---

### Task 6: Calendar page — fetch tasks and merge into the render model

**Files:**
- Modify: `app/(app)/calendar/page.tsx`
- Create: `lib/calendar-tasks-for-grid.ts`
- Test: `tests/lib/calendar-tasks-for-grid.test.ts`

**Interfaces:**
- Consumes: `listTaskLists`/`listTasks` (Task 2), `getTaskMetadata` (Task 1), `tokenForColorId` (Task 4).
- Produces: `CalendarTaskItem = { id: string; taskListId: string; title: string; notes?: string; completed: boolean; dueDate: string; dueTime: string | null; colorToken: CalendarColorToken | null }` and a pure helper `buildCalendarTaskItems(tasks: GoogleTask[], taskListId: string, metadataByTaskId: Map<string, TaskMetadataRow>): CalendarTaskItem[]`, consumed by `page.tsx` and re-used by Task 7's view components. `CalendarTaskItem`/`GoogleTaskList` are also what Part 2's `CalendarInteractionProvider` and popup/editor components build against.

- [ ] **Step 1: Write the failing test for the extraction helper**

```ts
test("buildCalendarTaskItems excludes tasks with no Google due date", () => {
  const tasks = [{ id: "t1", taskListId: "l1", title: "No date", status: "needsAction" as const }];
  expect(buildCalendarTaskItems(tasks, "l1", new Map())).toEqual([]);
});

test("buildCalendarTaskItems returns an empty array for an empty tasks list (no task lists, or an empty list)", () => {
  expect(buildCalendarTaskItems([], "l1", new Map())).toEqual([]);
});

test("buildCalendarTaskItems keeps the Google due date and falls back to no time/no color when metadata is missing", () => {
  const tasks = [{ id: "t1", taskListId: "l1", title: "Essay", due: "2026-10-25T00:00:00.000Z", status: "needsAction" as const }];
  expect(buildCalendarTaskItems(tasks, "l1", new Map())).toEqual([
    { id: "t1", taskListId: "l1", title: "Essay", notes: undefined, completed: false, dueDate: "2026-10-25", dueTime: null, colorToken: null },
  ]);
});

test("buildCalendarTaskItems applies the task's own metadata row for time and color", () => {
  // metadataByTaskId has an entry with dueAt at 14:30 and colorToken "cv" -> dueTime: "14:30", colorToken: "cv"
});

test("buildCalendarTaskItems marks a completed Google task as completed: true", () => { /* status: "completed" -> completed: true */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calendar-tasks-for-grid.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/calendar-tasks-for-grid.ts`**

Filter out any task with no `due`. Derive `dueDate` as the first 10 characters of `due` (`due.slice(0, 10)`, reusing the date-only-string convention Google itself uses — no timezone math needed since `due`'s time component is always `00:00:00.000Z`). Look up the metadata row by `googleTaskId`; `dueTime` is that row's `dueAt`'s `HH:MM` (via the existing `parseZonedDateTime`/local formatting helpers in `lib/calendar-dates.ts`) or `null` if the row is absent or its `dueAt` is null; `colorToken` is that row's `colorToken` or `null` if absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calendar-tasks-for-grid.test.ts`
Expected: PASS

- [ ] **Step 5: Wire fetching into `app/(app)/calendar/page.tsx`**

Inside the existing `try`/`catch` (around `calendar-read-only-views`' lines 160-169), after fetching `calendars`/`allEvents`, also: `const taskLists = await listTaskLists(accessToken);` then for each list, `listTasks(accessToken, list.id)`, flatten, and for each resulting task look up its `task_metadata` row via `getTaskMetadata` (batch with `Promise.all`), building a `Map<string, TaskMetadataRow>` keyed by `googleTaskId` before calling `buildCalendarTaskItems` per list. An empty `taskLists` array (no Google Task lists at all) must short-circuit to an empty `tasks` array without special-casing — `Promise.all([])` and a `.flat()` over nothing both already do this safely; add a test asserting the page doesn't throw when `listTaskLists` resolves `[]` (satisfies this plan's Review Focus item on it) by exercising this same path through `buildCalendarTaskItems([], ...)`, already covered in Step 1. Pass the combined `CalendarTaskItem[]` and `taskLists` down to each view (`WeekView`, `DayView`, `MonthView`, `AgendaView`) as new `tasks`/`taskLists` props — Task 7 is what makes the views actually render them; this step only threads the data through (views may ignore the new props for now without failing — add them as optional props or accept an unused-prop lint warning until Task 7 lands them in the same commit if that's simpler). Also pass `calendars` through unchanged for now — Part 2 is what filters it by `accessRole` for the create/edit calendar picker.

- [ ] **Step 6: Manually verify the build**

Run: `npm run build`
Expected: succeeds with no new type errors.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/calendar/page.tsx lib/calendar-tasks-for-grid.ts tests/lib/calendar-tasks-for-grid.test.ts
git commit -m "feat: fetch Google Tasks and their local metadata into the Calendar page's render model"
```

---

### Task 7: Render tasks on the grid + complete checkbox

**Files:**
- Modify: `components/calendar/HourGrid.tsx`
- Modify: `components/calendar/MonthView.tsx`
- Modify: `components/calendar/AgendaView.tsx`
- Modify: `components/calendar/DayView.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/task-checkbox.test.tsx`

**Interfaces:**
- Consumes: `CalendarTaskItem` (Task 6), `completeTaskAction` (Task 5).
- Produces: `components/calendar/TaskCheckbox.tsx` — `function TaskCheckbox({ task }: { task: CalendarTaskItem }): JSX.Element`, a small client component used by all four views and, in Part 2, clickable to open the task editor.

- [ ] **Step 1: Write the failing test for `TaskCheckbox`**

```tsx
test("TaskCheckbox renders unchecked for an incomplete task and checked for a completed one", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

test("clicking the checkbox calls completeTaskAction with the task's ids and the new completed state", async () => {
  vi.mock("@/lib/actions/calendar-tasks", () => ({ completeTaskAction: vi.fn() }));
  render(<TaskCheckbox task={{ ...baseTask, completed: false }} />);
  await userEvent.click(screen.getByRole("checkbox"));
  expect(completeTaskAction).toHaveBeenCalledWith({ taskListId: baseTask.taskListId, taskId: baseTask.id, completed: true });
});

test("a completed task's title renders with the struck-through styling class", () => {
  render(<TaskCheckbox task={{ ...baseTask, completed: true }} />);
  expect(screen.getByText(baseTask.title)).toHaveClass("task-done");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/task-checkbox.test.tsx`
Expected: FAIL (component doesn't exist)

- [ ] **Step 3: Implement `components/calendar/TaskCheckbox.tsx`**

`"use client"`. Renders `<input type="checkbox" checked={task.completed} onChange={...} />` plus the title (and `dueTime` formatted via the existing time-label convention, if present), using `task.colorToken ?? "cal"` the same way events fall back to `FALLBACK_COLOR_TOKEN` elsewhere in this codebase. `onChange` calls `completeTaskAction({ taskListId: task.taskListId, taskId: task.id, completed: !task.completed })` and relies on Next's router refresh (`useRouter().refresh()`) after the action resolves to re-pull the now-updated task list, rather than hand-rolling local optimistic state — simplest correct option for a single-user app where the round trip is fast.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/task-checkbox.test.tsx`
Expected: PASS

- [ ] **Step 5: Merge tasks into each view's day-bucketing**

- `MonthView`/`AgendaView`: their private `getEventsForDay` helpers (`MonthView.tsx:34-40`, `AgendaView.tsx:60-66`) only look at `events`. Add a sibling `getTasksForDay(tasks: CalendarTaskItem[], day: Date)` filtering by `task.dueDate === formatDateParam(day)` (reuse the existing `YYYY-MM-DD` formatter already defined in `page.tsx`/`CalendarToolbar.tsx`, hoisted to `lib/calendar-dates.ts` if not already shared — if hoisting, update both existing call sites to import it instead of keeping their private copies). Render each day's tasks via `<TaskCheckbox>` alongside its event chips (tasks after all-day events, before/interleaved with timed events is the implementer's call — do whichever keeps the cell's existing chip-overflow logic, `MAX_VISIBLE_CHIPS`, counting tasks as chips too).
- `HourGrid`: a task with a `dueTime` renders as a timed block as part of the same positioned list `layoutTimedEvents` produces (give it a synthetic `{ top, height: HOUR_ROW_HEIGHT * 0.5 }`, i.e. a fixed 30-minute-tall block, since tasks have no duration); a task with no `dueTime` on a day shown in Day/Week view renders in the existing `.wg-allday` row alongside all-day event chips. `HourGrid` needs a new `tasks: CalendarTaskItem[]` prop.
- `DayView`: thread the new `tasks` prop through to `HourGrid` (it already receives `events`, `calendars`, `colorByCalendar` — add `tasks` alongside, matching its existing prop-threading role).

- [ ] **Step 6: Add CSS**

In `app/globals.css`, add `.task-done { text-decoration: line-through; opacity: 0.6; }` and whatever checkbox/layout rules the chosen markup needs, following the file's existing section-comment convention.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, open `/calendar`, confirm a task created directly in Google Tasks (with a due date) renders on the correct day in all four views, and checking its box strikes it through.

- [ ] **Step 8: Commit**

```bash
git add components/calendar app/globals.css tests/components/task-checkbox.test.tsx
git commit -m "feat: render Google Tasks on the calendar grid with a complete/incomplete checkbox"
```

---

### Task 8: Overlapping-event column layout (Day/Week)

**Files:**
- Create: `lib/calendar-overlap.ts`
- Modify: `components/calendar/HourGrid.tsx`
- Test: `tests/lib/calendar-overlap.test.ts`

**Interfaces:**
- Consumes: `PositionedEvent` (`lib/calendar-layout.ts`).
- Produces: `type ColumnedEvent = PositionedEvent & { column: number; columnCount: number }`; `function layoutColumns(positioned: PositionedEvent[]): ColumnedEvent[]`.

- [ ] **Step 1: Write the failing tests**

```ts
test("two non-overlapping events both get column 0 of a 1-column cluster", () => {
  const a = { event: mk("a", 0, 60), top: 0, height: 60 };
  const b = { event: mk("b", 120, 60), top: 120, height: 60 };
  expect(layoutColumns([a, b])).toEqual([
    { ...a, column: 0, columnCount: 1 },
    { ...b, column: 0, columnCount: 1 },
  ]);
});

test("two events overlapping in time split into 2 side-by-side columns", () => {
  const a = { event: mk("a", 0, 60), top: 0, height: 60 };
  const b = { event: mk("b", 30, 60), top: 30, height: 60 };
  const result = layoutColumns([a, b]);
  expect(result.map((r) => r.columnCount)).toEqual([2, 2]);
  expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1]));
});

test("three mutually overlapping events split into 3 columns", () => { /* all three overlap [t, t+60) at some shared instant */ });

test("a 3rd event that overlaps only the 1st of two already-overlapping events still joins their cluster (transitively) and gets its own column", () => {
  // a: [0,90), b: [60,150), c: [120,180) — a/b overlap, b/c overlap, a/c do not — all three still form one cluster of width 3
});

test("an event that starts exactly when an overlapping one ends does not count as overlapping (half-open interval)", () => {
  // a: [0,60), b: [60,120) -> both columnCount 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-overlap.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `layoutColumns`**

Classic sweep-line column assignment:
1. Sort `positioned` by `top` ascending (ties: longer `height` first, so the widest-reaching event claims column 0 within a tie).
2. Walk the sorted list maintaining `openColumns: (PositionedEvent | null)[]` (events currently "in progress" at the sweep point, indexed by their assigned column) and a running `cluster: ColumnedEvent[]`.
3. For each event: first evict any `openColumns[i]` whose `top + height <= event.top` (it ended before this one starts — half-open interval, so equality evicts). If every slot is now empty and `cluster` is non-empty, the previous cluster just closed: stamp every member of `cluster` with `columnCount = openColumns.length` (its high-water mark), push them to the result, and reset `cluster = []` and `openColumns = []` before continuing.
4. Assign `event` the lowest-indexed `null`/non-existent slot in `openColumns` (push a new slot if none is free), record that as its `column`, and add it to `cluster`.
5. After the loop, close the final open cluster the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-overlap.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `HourGrid`**

In `HourGrid.tsx`'s per-day rendering (`layoutTimedEvents(events, day).map(...)`, lines 107-116), pipe the result through `layoutColumns` first, and use `column`/`columnCount` to compute `left: \`${(column / columnCount) * 100}%\`` and `width: \`${100 / columnCount}%\`` inline styles alongside the existing `top`/`height`, replacing the current full-width block for any event whose `columnCount > 1`.

- [ ] **Step 6: Add CSS**

Add `.wg-event` width/left are now inline styles rather than CSS defaults — confirm no existing `app/globals.css` rule hardcodes `.wg-event { width: ... }` that would fight the new inline style; adjust if so.

- [ ] **Step 7: Manually verify in the browser**

Create two overlapping events directly in Google Calendar and confirm Day/Week view renders them side-by-side, narrower, not stacked full-width (the app itself can't create events yet — that's Part 2).

- [ ] **Step 8: Commit**

```bash
git add lib/calendar-overlap.ts components/calendar/HourGrid.tsx tests/lib/calendar-overlap.test.ts
git commit -m "feat: lay out overlapping Day/Week events in side-by-side columns"
```

---

## After Task 8

Run the full suite (`npm run test`) and `npm run build` once more, then follow superpowers:finishing-a-development-branch for this part before starting Part 2 — Part 2 builds directly on these commits (the server actions and `CalendarTaskItem`/`GoogleTaskList` types from Tasks 5-6 in particular), so it should branch from wherever this part lands.
