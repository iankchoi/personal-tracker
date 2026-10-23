# Calendar — Read-Only Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the signed-in user a live, read-only view of their real Google Calendar across Day/Week/Month/Agenda, matching the approved mockups — no event creation/editing/deleting yet (that's a later plan).

**Architecture:** Next.js Server Components fetch directly from the Google Calendar REST API on each request (no DB caching of events — Google stays the source of truth, per spec). A new `getGoogleAccessToken(userId)` helper centralizes the decrypt/refresh-if-expired logic that today lives inline in `auth.ts`'s `jwt` callback; both `auth.ts` and the Calendar page now call the same function instead of duplicating it. A small set of pure, unit-tested functions (view-range math, event-grid layout, calendar→color-token assignment) sit between the raw Google API client and the view components, so the one page under test is the plumbing, not React rendering.

**Tech Stack:** Next.js 16 Server Components, native `fetch` against `https://www.googleapis.com/calendar/v3/*` (no `googleapis` SDK — consistent with how `auth.ts` already talks to Google's token endpoint directly), Vitest for unit/integration tests.

**Spec:** `docs/superpowers/specs/2026-10-21-personal-tracker-design.md`

**Design:** Week view is ported verbatim from `.taste-skill/build/calendar.html`/`calendar-dark.html` (already approved). Day, Month, and Agenda views are newly designed and approved in this session, built in `.taste-skill/build/calendar-day.html`, `calendar-month.html`, `calendar-agenda.html` (+ `-dark` variants) — 0 FAIL on `design-taste-frontend`'s app-screen inspector for all six files. Copy markup/CSS from these files verbatim; do not redesign.

## Global Constraints

- Google Calendar events are **never** duplicated into Postgres — every event render is a live API read, no `events` table, no caching layer (spec: "Google Calendar events are not duplicated in the database... Google Calendar is the source of truth, queried live via the API on each request").
- No local conflict detection — this app reflects whatever Google returns, full stop (spec, Error handling).
- A failed Google token refresh must show a "reconnect Google" banner and let the rest of the app keep working — never crash the page (spec: "a failed refresh shows a 'reconnect Google' banner; Calendar-dependent features degrade, Reminders/Notes/Journal remain fully functional").
- The design system is ported verbatim from the approved mockup files named above — copy values, don't invent new ones.
- Event creation, editing, deletion, recurrence authoring, and attendee invites are explicitly **out of scope** for this plan (separate follow-up plans). The "+ New event" button renders but is disabled.
- Multi-calendar **visibility toggling** (show/hide a specific calendar) is also out of scope — this plan renders every calendar the user has, color-coded, with a static (non-interactive) legend. Toggling is a follow-up plan.

## Review Focus

- **A user whose Google refresh token was revoked mid-session must see a reconnect banner, not a crashed or blank Calendar page.** `getGoogleAccessToken` is the single chokepoint for this — pinned to Task 2's unit tests and Task 11's integration test.
- **All-day events (no `dateTime`, only a `date`) must render in the all-day row without breaking the hour-grid's pixel-position math**, which only makes sense for timed events. Pinned to Task 6.
- **Events must display in the viewer's real local time, not silently shifted by a UTC/timezone mismatch** between Google's returned `dateTime` (which carries its own offset) and however the grid does its hour math. Pinned to Task 5/Task 6.
- **An event starting before 7 AM or after 9 PM must not silently vanish from every view** — it's excluded from the Day/Week hour grid by design (documented v1 limit, matching the approved mockup's fixed visible window), but it must still appear in Month and Agenda, which have no such window. Pinned to Task 6 (exclusion, not corruption) and Task 10 (Agenda has no window at all).
- **A user with only their one primary Google calendar (the common case right after first sign-in) must render correctly**, not assume multiple calendars exist. Pinned to Task 3 and Task 11.

---

## File Structure

```
lib/
  google-token.ts          # getGoogleAccessToken + refreshGoogleToken (moved from auth.ts)
  google-calendar.ts        # listCalendars, listEvents — thin REST client
  calendar-colors.ts        # calendar id -> app color-token assignment
  calendar-ranges.ts        # view range math (day/week/month/agenda) + label + navigate
  calendar-layout.ts        # event -> {top,height} pixel layout for the hour grid
auth.ts                     # modified: jwt callback now calls lib/google-token.ts
components/
  calendar/
    CalendarToolbar.tsx
    ReconnectBanner.tsx
    HourGrid.tsx             # shared Day/Week hour-grid chrome
    WeekView.tsx
    DayView.tsx
    MonthView.tsx
    AgendaView.tsx
    MiniMonth.tsx            # shared Day/Agenda rail
    UpNext.tsx                # Day view rail only
    CalendarsLegend.tsx       # shared Day/Agenda rail
app/
  (app)/
    calendar/
      page.tsx                # reads ?view=&date=, renders the right view
  globals.css                 # extended with calendar tokens/classes
tests/
  lib/
    google-token.test.ts
    google-calendar.test.ts
    calendar-colors.test.ts
    calendar-ranges.test.ts
    calendar-layout.test.ts
```

---

### Task 1: Port Calendar CSS into `app/globals.css`

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `.cal-col`, `.cal-toolbar*`, `.segmented*`, `.cal-nav*`, `.cal-range`, `.cal-today`, `.cal-new`, `.day-grid`/`.week-grid` + `.wg-*` (shared hour-grid mechanics), `.day-layout`/`.day-rail`, `.month-grid` + `.mg-*`, `.agenda-layout`/`.agenda-col`/`.agenda-rail`/`.agenda-group`/`.agenda-date`, `.mini-month` + `.mini-*`, `.up-next`/`.un-*`, `.cal-legend`/`.cl-*`, all consumed by Tasks 7-11's components.

- [ ] **Step 1: Port the toolbar + hour-grid classes** from `.taste-skill/build/calendar.html`'s `<style>` block (the `.cal-col` through `.wg-now::before` rules) into `app/globals.css`. These already exist verbatim in that file — copy them exactly, including both the light values and anything under `:root[data-theme="dark"]` (calendar.html uses the same token names as the rest of the app, so no new dark-mode values are needed beyond what Task 1 of the foundation plan already ported).

- [ ] **Step 2: Port the Day-view-specific rail classes** (`.day-layout`, `.day-rail`, `.mini-month`, `.mini-nav*`, `.mini-dow*`, `.mini-weeks`, `.mini-week`, `.mini-date*`, `.up-next`, `.un-item*`, `.cal-legend`, `.cl-*`) from `.taste-skill/build/calendar-day.html`'s `<style>` block, verbatim.

- [ ] **Step 3: Port the Month-view classes** (`.month-grid`, `.mg-*`) from `.taste-skill/build/calendar-month.html`'s `<style>` block, verbatim.

- [ ] **Step 4: Port the Agenda-view classes** (`.agenda-layout`, `.agenda-col`, `.agenda-rail`, `.agenda-group*`, `.agenda-date*`, `.cards`, `.rowcard*`, `.src*`) from `.taste-skill/build/calendar-agenda.html`'s `<style>` block, verbatim. Note `.rowcard`/`.cards`/`.src` already appear in `calendar.html` too (shared with the future Home dashboard) — if Task 1 of this plan already added them in Step 1, don't duplicate; just confirm they're present. **Also port `.mini-date.inrange`** from this same file — it's an Agenda-only modifier (marking the 14-day window on the shared mini-calendar) that doesn't exist in `calendar-day.html`'s copy of `.mini-date`, so Step 2 alone won't have picked it up.

- [ ] **Step 5: Verify no duplicate class definitions** were introduced across the four source files (all four mockups share the sidebar/topbar/toolbar/hour-grid rules) — each class should appear exactly once in `globals.css`.

- [ ] **Step 6: Verify the app still builds**

Run: `npm run build`
Expected: succeeds, no CSS parse errors.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "feat: port Calendar design tokens for Day/Week/Month/Agenda views"
```

---

### Task 2: `getGoogleAccessToken` helper (and the `auth.ts` refactor it requires)

**Files:**
- Create: `lib/google-token.ts`
- Modify: `auth.ts`
- Test: `tests/lib/google-token.test.ts`

**Interfaces:**
- Consumes: `db`/`users` schema (`db/schema.ts`), `encrypt`/`decrypt` (`lib/crypto.ts`).
- Produces: `refreshGoogleToken(user: { id: string; googleRefreshToken: string | null }): Promise<{ accessToken: string; needsGoogleReconnect: boolean; expiresAt?: number }>` and `getGoogleAccessToken(userId: string): Promise<{ accessToken: string; needsGoogleReconnect: false } | { accessToken: null; needsGoogleReconnect: true }>`, both from `lib/google-token.ts`. Consumed by Task 11 (the Calendar page) and by `auth.ts`'s `jwt` callback.

This task **moves** `refreshGoogleToken` out of `auth.ts` (where it currently lives, built in the foundation plan) into `lib/google-token.ts`, and adds `getGoogleAccessToken` beside it. `auth.ts` must re-export `refreshGoogleToken` from the new location (`export { refreshGoogleToken } from "./lib/google-token";`) so `tests/auth/auth.test.ts`'s existing import keeps working unmodified — do not edit that test file.

- [ ] **Step 1: Write the failing tests**

```ts
test("getGoogleAccessToken returns the decrypted token when it has not expired", async () => {
  const [user] = await db.insert(users).values({
    email: "fresh@test.com",
    googleAccessToken: encrypt("fresh-access-token"),
    googleRefreshToken: encrypt("refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: "fresh-access-token", needsGoogleReconnect: false });
});

test("getGoogleAccessToken refreshes and persists a new token when the stored one has expired", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "refreshed-token", expires_in: 3600 }),
  }));
  const [user] = await db.insert(users).values({
    email: "expired@test.com",
    googleAccessToken: encrypt("stale-token"),
    googleRefreshToken: encrypt("refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() - 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: "refreshed-token", needsGoogleReconnect: false });
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(decrypt(row.googleAccessToken!)).toBe("refreshed-token");
});

test("getGoogleAccessToken reports needsGoogleReconnect when refresh fails, without throwing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
  const [user] = await db.insert(users).values({
    email: "revoked@test.com",
    googleAccessToken: encrypt("stale-token"),
    googleRefreshToken: encrypt("revoked-refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() - 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: null, needsGoogleReconnect: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/google-token.test.ts`
Expected: FAIL with "getGoogleAccessToken is not defined"

- [ ] **Step 3: Move `refreshGoogleToken` from `auth.ts` into `lib/google-token.ts`** unchanged (same body, same signature). Implement `getGoogleAccessToken(userId)`: select the user row; if no `googleAccessToken`, return `{ accessToken: null, needsGoogleReconnect: true }`; if `googleTokenExpiresAt` is in the future, return the decrypted `googleAccessToken`; otherwise call `refreshGoogleToken`, and on success, encrypt+persist the new `googleAccessToken`/`googleTokenExpiresAt` to the `users` row (same pattern as `auth.ts`'s `jwt` callback already does after a refresh) and return the fresh token; on failure, return `{ accessToken: null, needsGoogleReconnect: true }` without writing anything.

- [ ] **Step 4: Update `auth.ts`** — delete its inline `refreshGoogleToken` definition, `import { refreshGoogleToken } from "./lib/google-token"` instead, add `export { refreshGoogleToken } from "./lib/google-token";`, and leave the `jwt` callback's call site (`refreshGoogleToken({...})`) unchanged — it already calls the function by the same name, so only the import source changes.

- [ ] **Step 5: Run the new tests, and the existing auth tests, to verify everything passes**

Run: `npx vitest run tests/lib/google-token.test.ts tests/auth/auth.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add lib/google-token.ts auth.ts tests/lib/google-token.test.ts
git commit -m "refactor: extract getGoogleAccessToken helper, shared by auth.ts and the Calendar page"
```

---

### Task 3: Google Calendar API client

**Files:**
- Create: `lib/google-calendar.ts`
- Test: `tests/lib/google-calendar.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GoogleCalendarListEntry = { id: string; summary: string; backgroundColor: string; primary?: boolean };
  export type GoogleCalendarEvent = {
    id: string;
    calendarId: string;
    summary: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
  };
  export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]>;
  export async function listEvents(accessToken: string, calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<GoogleCalendarEvent[]>;
  ```
  Consumed by Task 11 (the Calendar page).

- [ ] **Step 1: Write the failing tests**, mocking `fetch`:

```ts
test("listCalendars returns the user's calendars from Google's calendarList endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ id: "primary", summary: "Ian Choi", backgroundColor: "#3b6ea5", primary: true }] }),
  }));

  const result = await listCalendars("test-token");

  expect(result).toEqual([{ id: "primary", summary: "Ian Choi", backgroundColor: "#3b6ea5", primary: true }]);
  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
  );
});

test("listEvents stamps calendarId onto every returned event, since Google's response omits it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ id: "evt1", summary: "Team standup", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T09:15:00-04:00" } }] }),
  }));

  const result = await listEvents("test-token", "primary", "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z");

  expect(result).toEqual([{
    id: "evt1", calendarId: "primary", summary: "Team standup",
    start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T09:15:00-04:00" },
  }]);
});

test("listEvents throws a descriptive error on a non-ok response, rather than returning garbage", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

  await expect(listEvents("bad-token", "primary", "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z")).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: FAIL with "listCalendars is not defined"

- [ ] **Step 3: Implement `listCalendars` and `listEvents`** in `lib/google-calendar.ts`. `listEvents` calls `GET https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` with query params `timeMin`, `timeMax`, `singleEvents=true` (expands recurring events into concrete instances — needed to render anything, even though recurrence *authoring* is a later plan), `orderBy=startTime`; both functions send `Authorization: Bearer ${accessToken}` and throw on a non-ok response. `listEvents` must add `calendarId` onto each returned item (Google's own response doesn't include it) before returning.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/google-calendar.ts tests/lib/google-calendar.test.ts
git commit -m "feat: add Google Calendar API client (listCalendars, listEvents)"
```

---

### Task 4: Calendar color assignment

**Files:**
- Create: `lib/calendar-colors.ts`
- Test: `tests/lib/calendar-colors.test.ts`

**Interfaces:**
- Produces: `export type CalendarColorToken = "cal" | "wk" | "rem" | "note" | "jour" | "cv";` and `export function assignCalendarColors(calendarIds: string[]): Record<string, CalendarColorToken>`. Consumed by Tasks 7-10 (every view that renders an event or the Calendars legend) and Task 11.

**Design decision (binding for this task):** the app does not use Google's own per-calendar `backgroundColor` hex values directly — they'd be arbitrary and could clash with the app's carefully designed light/dark palettes. Instead, each of the user's calendars is deterministically assigned one of the app's six existing category tint tokens, in rotation, in the order Google returned them (primary calendar first) — `["cal", "wk", "rem", "note", "jour", "cv"]`, wrapping around via modulo if the user has more than six calendars.

- [ ] **Step 1: Write the failing tests**

```ts
test("assignCalendarColors cycles through the six tokens in input order", () => {
  const result = assignCalendarColors(["primary", "work@group.calendar.google.com", "birthdays"]);

  expect(result).toEqual({
    primary: "cal",
    "work@group.calendar.google.com": "wk",
    birthdays: "rem",
  });
});

test("assignCalendarColors wraps around after six calendars", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  const result = assignCalendarColors(ids);

  expect(result.a).toBe("cal");
  expect(result.g).toBe("cal");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-colors.test.ts`
Expected: FAIL with "assignCalendarColors is not defined"

- [ ] **Step 3: Implement `assignCalendarColors`** in `lib/calendar-colors.ts` — a pure function over the rotation array above, no I/O.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-colors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-colors.ts tests/lib/calendar-colors.test.ts
git commit -m "feat: add deterministic calendar-to-color-token assignment"
```

---

### Task 5: View-range date math

**Files:**
- Create: `lib/calendar-ranges.ts`
- Test: `tests/lib/calendar-ranges.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ViewType = "day" | "week" | "month" | "agenda";
  export type ViewRange = { start: Date; end: Date; label: string };
  export function getViewRange(view: ViewType, referenceDate: Date): ViewRange;
  export function navigateDate(view: ViewType, referenceDate: Date, direction: "prev" | "next"): Date;
  ```
  Consumed by Task 11 (the Calendar page, to compute what to fetch and what the toolbar shows) and Tasks 7-10 (each view's own header labels, e.g. the day-of-week cells).

- [ ] **Step 1: Write the failing tests** (reference date is always a `Date` at local midnight; use `2026-10-22`, a Wednesday, matching the approved mockups):

```ts
test("getViewRange('day', ...) spans exactly one day and labels it in full", () => {
  const range = getViewRange("day", new Date(2026, 9, 22));
  expect(range.start).toEqual(new Date(2026, 9, 22, 0, 0, 0));
  expect(range.end).toEqual(new Date(2026, 9, 23, 0, 0, 0));
  expect(range.label).toBe("Wednesday, October 22, 2026");
});

test("getViewRange('week', ...) starts on Sunday and spans 7 days", () => {
  const range = getViewRange("week", new Date(2026, 9, 22));
  expect(range.start).toEqual(new Date(2026, 9, 19, 0, 0, 0));
  expect(range.end).toEqual(new Date(2026, 9, 26, 0, 0, 0));
  expect(range.label).toBe("October 19–25, 2026");
});

test("getViewRange('week', ...) labels a week that crosses a month boundary correctly", () => {
  const range = getViewRange("week", new Date(2026, 9, 29));
  expect(range.label).toBe("Oct 25 – Oct 31, 2026");
});

test("getViewRange('month', ...) spans the full calendar month", () => {
  const range = getViewRange("month", new Date(2026, 9, 22));
  expect(range.start).toEqual(new Date(2026, 9, 1, 0, 0, 0));
  expect(range.end).toEqual(new Date(2026, 10, 1, 0, 0, 0));
  expect(range.label).toBe("October 2026");
});

test("getViewRange('agenda', ...) spans 14 days from the reference date", () => {
  const range = getViewRange("agenda", new Date(2026, 9, 22));
  expect(range.start).toEqual(new Date(2026, 9, 22, 0, 0, 0));
  expect(range.end).toEqual(new Date(2026, 10, 5, 0, 0, 0));
  expect(range.label).toBe("Oct 22 – Nov 4, 2026");
});

test("navigateDate('day', ..., 'next') moves forward exactly one day", () => {
  expect(navigateDate("day", new Date(2026, 9, 22), "next")).toEqual(new Date(2026, 9, 23));
});

test("navigateDate('month', ..., 'prev') moves to the same day one month earlier", () => {
  expect(navigateDate("month", new Date(2026, 9, 22), "prev")).toEqual(new Date(2026, 8, 22));
});

test("navigateDate('agenda', ..., 'next') moves forward 14 days", () => {
  expect(navigateDate("agenda", new Date(2026, 9, 22), "next")).toEqual(new Date(2026, 10, 5));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-ranges.test.ts`
Expected: FAIL with "getViewRange is not defined"

- [ ] **Step 3: Implement `getViewRange` and `navigateDate`** in `lib/calendar-ranges.ts`. Week starts on Sunday (matching the approved mockup's `SUN` first column). Label formatting: `day` uses the full weekday+month+day+year; `week` uses `"MMM D–D, YYYY"` when both ends share a month, `"MMM D – MMM D, YYYY"` when they don't (per the second test above); `month` uses `"MMMM YYYY"`; `agenda` uses `"MMM D – MMM D, YYYY"` always.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-ranges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-ranges.ts tests/lib/calendar-ranges.test.ts
git commit -m "feat: add Calendar view-range date math"
```

---

### Task 6: Event grid-layout math

**Files:**
- Create: `lib/calendar-layout.ts`
- Test: `tests/lib/calendar-layout.test.ts`

**Interfaces:**
- Consumes: `GoogleCalendarEvent` (Task 3).
- Produces:
  ```ts
  export const GRID_START_HOUR = 7;
  export const GRID_END_HOUR = 22;
  export const HOUR_ROW_HEIGHT = 56;
  export type PositionedEvent = { event: GoogleCalendarEvent; top: number; height: number };
  export function layoutTimedEvents(events: GoogleCalendarEvent[], day: Date): PositionedEvent[];
  export function getAllDayEvents(events: GoogleCalendarEvent[], day: Date): GoogleCalendarEvent[];
  ```
  Consumed by Task 7 (`HourGrid`, shared by Day/Week views).

**v1 limitation (binding, matches the approved mockup's fixed 7 AM–9 PM window):** an event entirely before `GRID_START_HOUR` or entirely after `GRID_END_HOUR` is excluded from `layoutTimedEvents`'s result — not clamped to the grid's edge, not dropped silently from the app as a whole (it still appears in Month and Agenda, which have no such window — see Tasks 9 and 10).

- [ ] **Step 1: Write the failing tests**

```ts
test("layoutTimedEvents positions a 9:00-9:15 AM event at the correct pixel offset", () => {
  const event = { id: "1", calendarId: "primary", summary: "Team standup", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T09:15:00-04:00" } };
  const [positioned] = layoutTimedEvents([event], new Date(2026, 9, 22));
  expect(positioned.top).toBe(2 * HOUR_ROW_HEIGHT); // 2 hours after 7 AM
  expect(positioned.height).toBe(HOUR_ROW_HEIGHT * 0.25); // 15 minutes
});

test("layoutTimedEvents excludes an event entirely before the visible window", () => {
  const event = { id: "2", calendarId: "primary", summary: "Early flight", start: { dateTime: "2026-10-22T06:15:00-04:00" }, end: { dateTime: "2026-10-22T06:45:00-04:00" } };
  expect(layoutTimedEvents([event], new Date(2026, 9, 22))).toEqual([]);
});

test("layoutTimedEvents excludes all-day events, routing them to getAllDayEvents instead", () => {
  const allDay = { id: "3", calendarId: "primary", summary: "Mom's birthday", start: { date: "2026-10-25" }, end: { date: "2026-10-26" } };
  expect(layoutTimedEvents([allDay], new Date(2026, 9, 25))).toEqual([]);
  expect(getAllDayEvents([allDay], new Date(2026, 9, 25))).toEqual([allDay]);
});

test("layoutTimedEvents only includes events that fall on the given day", () => {
  const otherDay = { id: "4", calendarId: "primary", summary: "Tomorrow's standup", start: { dateTime: "2026-10-23T09:00:00-04:00" }, end: { dateTime: "2026-10-23T09:15:00-04:00" } };
  expect(layoutTimedEvents([otherDay], new Date(2026, 9, 22))).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-layout.test.ts`
Expected: FAIL with "layoutTimedEvents is not defined"

- [ ] **Step 3: Implement `layoutTimedEvents` and `getAllDayEvents`.** Parse `event.start.dateTime`/`event.end.dateTime` as real `Date` objects (these strings carry an explicit UTC offset from Google, e.g. `-04:00` — parse them with the built-in `Date` constructor, which correctly honors the offset, then read hours/minutes via the methods that reflect the *local* time represented by that offset, not `getUTCHours()`, so the event renders at the wall-clock time Google says it's at). `top = (eventStartHour - GRID_START_HOUR) * HOUR_ROW_HEIGHT` (fractional hours allowed), `height = durationHours * HOUR_ROW_HEIGHT`. An event with no `dateTime` (only `date`) is all-day — never passed through to `layoutTimedEvents`'s output. An event whose local start hour is before `GRID_START_HOUR`, or whose start hour is at/after `GRID_END_HOUR`, is excluded.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-layout.ts tests/lib/calendar-layout.test.ts
git commit -m "feat: add event-to-pixel layout math for the Day/Week hour grid"
```

---

### Task 7: `HourGrid` shared component + Week view

**Files:**
- Create: `components/calendar/HourGrid.tsx`
- Create: `components/calendar/WeekView.tsx`

**Interfaces:**
- Consumes: `PositionedEvent`/`layoutTimedEvents`/`getAllDayEvents` (Task 6), `GoogleCalendarEvent` (Task 3), `CalendarColorToken` (Task 4).
- Produces: `<HourGrid days={Date[]} events={GoogleCalendarEvent[]} colorByCalendar={Record<string, CalendarColorToken>} today={Date} />` rendering the `.week-grid`/`.day-grid` markup from the mockups for 1 or 7 days (the component takes an array of 1 or 7 `Date`s and renders that many `.wg-day-head`/`.wg-allday`/`.wg-col` columns — Day view in Task 8 passes a 1-element array, reusing this same component rather than Day view having its own copy of the hour-grid markup). `events` is the flat, unfiltered list for the whole visible range; `HourGrid` calls `layoutTimedEvents(events, day)` and `getAllDayEvents(events, day)` (Task 6) itself, once per day in `days`, to get each column's content. `<WeekView referenceDate={Date} events={GoogleCalendarEvent[]} colorByCalendar={...} />` composes `HourGrid` with the 7-day range from `getViewRange("week", referenceDate)`.

- [ ] **Step 1: Port the hour-grid markup** from `.taste-skill/build/calendar.html`'s `<div class="week-grid">` block into `HourGrid.tsx`, parameterizing the hardcoded 7 columns / hardcoded event positions into props-driven loops: one `.wg-day-head` + `.wg-allday` per entry in `days`, one `.wg-hour` per hour from `GRID_START_HOUR` to `GRID_END_HOUR` (Task 6's constants), one `.wg-col` per day rendering that day's `layoutTimedEvents(...)` result as absolutely-positioned `.wg-event` blocks (color class from `colorByCalendar[event.calendarId]`, mapped `cal`→`pers` and `wk`→`work` to match the mockup's existing `.wg-event.pers`/`.work` class names — or extend those CSS classes to accept all six color tokens directly if that's cleaner; implementer's call, document whichever is chosen). Render `.wg-now` only on the column matching today, positioned from the current wall-clock hour.
- [ ] **Step 2: Write `WeekView.tsx`** calling `getViewRange("week", referenceDate)` to get the 7 days, then `<HourGrid days={...} .../>`.
- [ ] **Step 3: Manual verification** — this component has no automated test (it's presentational, and its one piece of real logic is already covered by Task 6's unit tests); confirm visually once Task 11 wires it into a live page.
- [ ] **Step 4: Commit**

```bash
git add components/calendar/HourGrid.tsx components/calendar/WeekView.tsx
git commit -m "feat: add shared HourGrid component and Week view"
```

---

### Task 8: Day view (+ rail: MiniMonth, UpNext, CalendarsLegend)

**Files:**
- Create: `components/calendar/DayView.tsx`
- Create: `components/calendar/MiniMonth.tsx`
- Create: `components/calendar/UpNext.tsx`
- Create: `components/calendar/CalendarsLegend.tsx`

**Interfaces:**
- Consumes: `HourGrid` (Task 7), `GoogleCalendarEvent`/`GoogleCalendarListEntry` (Task 3), `CalendarColorToken`/`assignCalendarColors` (Task 4), `getAllDayEvents` (Task 6).
- Produces: `<DayView referenceDate={Date} events={GoogleCalendarEvent[]} calendars={GoogleCalendarListEntry[]} colorByCalendar={...} upcoming={GoogleCalendarEvent[]} />`, `<MiniMonth referenceDate={Date} selectedDate={Date} inRangeStart={Date} inRangeEnd={Date} />` (the `inRange*` props mark the `.mini-date.inrange` cells — Agenda view in Task 10 reuses this same component with its own 14-day range), `<CalendarsLegend calendars={GoogleCalendarListEntry[]} colorByCalendar={...} />` (also reused by Task 10).

- [ ] **Step 1: Port the Day-view layout** from `.taste-skill/build/calendar-day.html` — `.day-layout` wrapping a single-day `<HourGrid days={[referenceDate]} .../>` and a `.day-rail`.
- [ ] **Step 2: Implement `MiniMonth`** — ports the `.mini-month` markup, rendering the month containing `referenceDate`, marking `today`'s cell and (when `inRangeStart`/`inRangeEnd` are passed) the cells between them per `.mini-date.inrange`.
- [ ] **Step 3: Implement `UpNext`** — ports the `.up-next`/`.un-item` markup, rendering up to 4 entries from the `upcoming` prop (events after `referenceDate`, formatted as "Tomorrow" / weekday name / time, matching the mockup's mixed format).
- [ ] **Step 4: Implement `CalendarsLegend`** — ports the second `.up-next` block (titled "Calendars") with one `.cl-item`/`.cl-dot` per entry in `calendars`, dot color from `colorByCalendar[calendar.id]`.
- [ ] **Step 5: Manual verification** once wired into Task 11's live page.
- [ ] **Step 6: Commit**

```bash
git add components/calendar/DayView.tsx components/calendar/MiniMonth.tsx components/calendar/UpNext.tsx components/calendar/CalendarsLegend.tsx
git commit -m "feat: add Day view with mini-month, up-next, and calendars rail"
```

---

### Task 9: Month view

**Files:**
- Create: `components/calendar/MonthView.tsx`

**Interfaces:**
- Consumes: `GoogleCalendarEvent` (Task 3), `CalendarColorToken` (Task 4), `getViewRange` (Task 5).
- Produces: `<MonthView referenceDate={Date} events={GoogleCalendarEvent[]} colorByCalendar={...} today={Date} />`.

- [ ] **Step 1: Port the month-grid markup** from `.taste-skill/build/calendar-month.html` — `.month-grid`/`.mg-dow-row`/`.mg-weeks`/`.mg-week`/`.mg-cell`, generating 5 or 6 week-rows as needed to cover the month (not always exactly 5 — October 2026 happens to fit 5 rows per the mockup, but the component must compute the real row count for any month, including leading/trailing days from adjacent months marked `.mg-cell.outside`).
- [ ] **Step 2: Render events per day** as `.mg-chip` (color class from `colorByCalendar`), capped at 3 visible chips per cell with a `.mg-more` "+N more" when a day has more than 3 (matching the mockup's Oct 28 example). No side-effect on click in this plan — overflow is display-only for now.
- [ ] **Step 3: Manual verification** once wired into Task 11's live page.
- [ ] **Step 4: Commit**

```bash
git add components/calendar/MonthView.tsx
git commit -m "feat: add Month view"
```

---

### Task 10: Agenda view

**Files:**
- Create: `components/calendar/AgendaView.tsx`

**Interfaces:**
- Consumes: `GoogleCalendarEvent` (Task 3), `CalendarColorToken` (Task 4), `MiniMonth`/`CalendarsLegend` (Task 8).
- Produces: `<AgendaView referenceDate={Date} events={GoogleCalendarEvent[]} calendars={GoogleCalendarListEntry[]} colorByCalendar={...} today={Date} />`.

- [ ] **Step 1: Port the agenda layout** from `.taste-skill/build/calendar-agenda.html` — `.agenda-layout` wrapping `.agenda-col` (grouped-by-day `.rowcard` rows, per `.agenda-group`) and `.agenda-rail` (reusing `MiniMonth` with `inRangeStart`/`inRangeEnd` set to the 14-day agenda window, and `CalendarsLegend`, both from Task 8).
- [ ] **Step 2: Group events by day**, skipping any day with zero events entirely (the mockup never shows an empty day group) — all-day events render with `"All day"` in the time slot (matching the mockup's "Mom's birthday" row).
- [ ] **Step 3: Manual verification** once wired into Task 11's live page.
- [ ] **Step 4: Commit**

```bash
git add components/calendar/AgendaView.tsx
git commit -m "feat: add Agenda view"
```

---

### Task 11: Toolbar, routing page, reconnect banner, and error/empty states

**Files:**
- Create: `components/calendar/CalendarToolbar.tsx`
- Create: `components/calendar/ReconnectBanner.tsx`
- Create: `app/(app)/calendar/page.tsx`

This task adds no new test file — its only real logic (token fetching, color assignment, range math, event layout) is already unit-tested in Tasks 2-6; this task's own correctness is verified by the manual check in Step 4, consistent with the foundation plan's precedent for pages that are mostly composition over already-tested helpers.

**Interfaces:**
- Consumes: everything from Tasks 2-10.
- Produces: the live `/calendar` route. `needsGoogleReconnect` banner is now shipped — this is the designated home the foundation plan reserved for it ("the banner's visual rendering is explicitly deferred to the Calendar plan, which is the first screen that needs it").

- [ ] **Step 1: Write `CalendarToolbar.tsx`** — ports `.cal-toolbar` markup: the `view`/`date` props drive which `.segmented` button has `aria-pressed="true"`, the `cal-range` label from `getViewRange(...).label`, prev/next buttons that link to the same route with `date` replaced by `navigateDate(view, date, "prev"|"next")`, a `Today` button linking to today's date, and a `+ New event` button rendered **disabled** (`<button className="cal-new" disabled>`) — event creation ships in a later plan.

- [ ] **Step 2: Write `ReconnectBanner.tsx`** — a small banner (reuse `--warning`/`.pill-warning*` tokens already in `globals.css`) reading "We couldn't refresh your Google connection." with a button whose `onClick`/form action calls `signIn("google", { redirectTo: "/calendar" })` (same pattern as the foundation's Settings → Account "Reconnect Google" button).

- [ ] **Step 3: Write `app/(app)/calendar/page.tsx`.** Server component reading `searchParams: { view?: string; date?: string }` (default `view="week"`, `date=`today's date, formatted `YYYY-MM-DD`). Calls `await auth()` for the session (already guaranteed non-null by middleware), then `getGoogleAccessToken(session.user.id)`. If `needsGoogleReconnect`, render `<CalendarToolbar .../>` + `<ReconnectBanner />` and stop — no API calls. Otherwise: `listCalendars(accessToken)`, `assignCalendarColors(calendars.map(c => c.id))`, compute `getViewRange(view, date)`, call `listEvents` for every calendar in parallel (`Promise.all`) across that range, flatten the results, and render the matching view component (`WeekView`/`DayView`/`MonthView`/`AgendaView`) from Tasks 7-10. Wrap the `listEvents` calls in a try/catch; on failure, render the `.error-block`/`.error-retry` markup (already in `globals.css` from the foundation's Task 1) instead of crashing — "Couldn't load your calendar. [Retry]" where Retry re-links to the same URL. When the resolved event list is empty for the range, render `.empty-block`. This page reads cookies (via `auth()`) so, like the Settings pages, needs `export const instant = false;` (the same `cacheComponents` reasoning Task 7 of the foundation plan established).

- [ ] **Step 4: Manual verification** — run `npm run dev`, sign in with real Google credentials, visit `/calendar`, confirm:
  - Default load shows this week, with real events from the signed-in Google account.
  - Clicking Day/Month/Agenda switches views via the URL; clicking prev/next/Today navigates correctly in every view.
  - An account with only a primary calendar (no secondary calendars) still renders without error (Review Focus item).
  - (If feasible to test live) temporarily revoking the app's Google access from https://myaccount.google.com/permissions and reloading `/calendar` shows the reconnect banner, not a crash.

- [ ] **Step 5: Commit**

```bash
git add components/calendar/CalendarToolbar.tsx components/calendar/ReconnectBanner.tsx "app/(app)/calendar/page.tsx"
git commit -m "feat: add Calendar page wiring Day/Week/Month/Agenda views to live Google data"
```

---

## Self-Review

**1. Spec coverage.** Calendar section's view-only surface (multiple views, color-coded calendars, live data, no local duplication) is covered by Tasks 1-11. Event CRUD, recurrence authoring, and attendee invites are explicitly deferred (Global Constraints) — separate follow-up plans per the user's "piece by piece" direction. The reconnect-banner requirement the foundation plan reserved for this plan is covered by Task 11.

**2. Step scan.** Each step names an exact file, signature, or markup source; no step says "handle appropriately" without a concrete behavior. Task 9's month-row-count note ("not always exactly 5") is the one place a step calls out that the mockup's example data doesn't generalize — flagged explicitly rather than left implicit.

**3. Type consistency.** `GoogleCalendarEvent` (Task 3) is the one shape every downstream task imports — Tasks 6-10 all consume it unchanged. `CalendarColorToken` (Task 4) is the one color-token type every view and the legend import. `ViewType`/`ViewRange` (Task 5) match what Task 11's routing logic and every view's toolbar label consume.

**4. Review Focus.** All five items list a task and a concrete test above (reconnect-banner → Task 2 unit tests + Task 11 manual check; all-day events → Task 6; timezone correctness → Task 6's offset-parsing requirement; events outside the 7 AM–9 PM window → Task 6 exclusion + Task 9/10 having no such window; single-calendar account → Task 3's shape handles any array length + Task 11's manual check).

**5. Proportion.** This plan is longer than the foundation plan's average task because it pins five new pure-function modules' exact signatures and test cases (the parts no implementer could derive alone) — but every code block above is a test, a signature, or a design decision with its reasoning; no block is a full implementation.

## Next plans (not in this one)

Per the agreed "piece by piece" breakdown: **multiple calendars + visibility toggling** (next), then **create/edit/delete events**, then **recurring + all-day event authoring**, then **attendees/invites**. The day-detail panel's "Journal" button and reminders-on-the-day-view both stay deferred until the Journal and Reminders plans exist.
