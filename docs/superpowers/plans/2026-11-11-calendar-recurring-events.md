# Calendar Part 3: Recurring Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user create repeating calendar events (Google RRULE-based, matching Google Calendar's own system exactly) and edit/delete them with Google's own This-event/All-events/This-and-following-events scope choice, wherever a recurring event can be touched: drag-to-reschedule, the full editor's Save/Delete, and a new keyboard Delete.

**Architecture:** Google Calendar already does all the hard work — `singleEvents=true` (already in use) expands a series into individual occurrences on read, and RRULE lines on the series' master event drive everything on write. This plan adds: (1) pure RRULE build/parse/truncate helpers, (2) a live Repeat field + custom-recurrence builder in the event editor, (3) a shared three-way scope dialog wired into every mutation point, and (4) scope-aware branching inside the existing server actions that resolves the series' master event and applies the right Google writes per scope. No local recurrence engine, no new database, no new dependency.

**Tech Stack:** Next.js App Router Server Actions, TypeScript, React Client Components, Vitest + Testing Library, Google Calendar REST API v3.

**Spec:** `docs/superpowers/specs/2026-11-11-calendar-recurring-events-design.md`

## Global Constraints

- Every write uses Google's own RRULE grammar and API semantics (`recurrence: string[]` on the master; `recurringEventId` to find the master from an instance; `singleEvents=true` reads, already in place) — recurring events must stay fully legible to real Google Calendar clients.
- No new dependency for RRULE handling — hand-written against the small grammar subset this feature needs (FREQ, INTERVAL, UNTIL, COUNT, a single BYDAY), matching this codebase's existing no-API-client-library style (`lib/google-calendar.ts`, `lib/google-tasks.ts`).
- Recurring Google Tasks are out of scope entirely — Tasks has no RRULE concept server-side.
- The weekly/custom recurrence builder repeats on the event's own start-date weekday only — no multi-weekday (`BYDAY` with several days) selection UI, by deliberate design-doc scoping.
- `lib/calendar-drag.ts`'s existing exported functions and their behavior are unchanged; this plan only widens its export surface (two already-written private helpers become exported) for reuse, per Task 3.
- `withoutEventClobberFields` continues to apply to drag-originated writes exactly as before a drag never touches color/reminders/Meet/guests.

## Review Focus

- **An all-day recurring event's end-date round-trips through `allDayEndToInclusive`/`allDayEndToExclusive`** before reaching the scope-aware action — an off-by-one-day bug here would silently shift the whole series' span on every "All events"/"This and following" edit. (Task 7)
- **"All events" chosen on an occurrence that sits weeks or months after the master's own start** — the time-delta must be computed from the *acted-on occurrence's* original time, then applied to the *master's* own start/end, never confusing the two. (Task 3)
- **"This and following" chosen on a series' very first occurrence** collapses to the same behavior as "All events" rather than producing a pointless empty old series. (Task 3)
- **A keyboard Delete keystroke fired while focus sits in the editor's title, description, or guest-email input** must not delete the event. (Task 7)
- **"All events"/"This and following" chosen on an occurrence that is itself already an exception** (previously dragged individually, so its own time no longer matches the series pattern) — the delta baseline must be that occurrence's own original time, not the master's, so an already-diverged instance doesn't throw off the whole series' shift. (Task 3)

---

## Task 1: RRULE helpers

**Files:**
- Create: `lib/calendar-recurrence.ts`
- Test: `tests/lib/calendar-recurrence.test.ts`

**Interfaces:**
- Produces: `RecurrenceRule` type, `buildRRule(rule, eventStartDay)`, `parseRRule(line)`, `truncateRRuleBefore(line, occurrenceStart)`, `isFirstOccurrence(masterStart, occurrenceStart)` — all consumed by Task 3 (actions) and Task 8 (Repeat field UI).

```ts
export type RecurrenceEnd =
  | { type: "never" }
  | { type: "onDate"; date: string } // YYYY-MM-DD, inclusive last possible occurrence day
  | { type: "afterCount"; count: number };

export type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number; // every N [freq units]; 1 = every unit
  end: RecurrenceEnd;
};
```

- [ ] **Step 1: Write the failing tests for `buildRRule`**

```ts
test("buildRRule builds a daily rule with no end condition", () => {
  expect(buildRRule({ freq: "DAILY", interval: 1, end: { type: "never" } }, new Date(2026, 10, 11)))
    .toBe("RRULE:FREQ=DAILY");
});

test("buildRRule builds an every-2-weeks rule on the event's own start weekday", () => {
  // 2026-11-11 is a Wednesday
  expect(buildRRule({ freq: "WEEKLY", interval: 2, end: { type: "never" } }, new Date(2026, 10, 11)))
    .toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
});

test("buildRRule includes INTERVAL only when it's greater than 1", () => {
  expect(buildRRule({ freq: "MONTHLY", interval: 1, end: { type: "never" } }, new Date(2026, 10, 11)))
    .toBe("RRULE:FREQ=MONTHLY");
});

test("buildRRule renders an onDate end as UNTIL in Google's all-day UTC form", () => {
  expect(
    buildRRule({ freq: "WEEKLY", interval: 1, end: { type: "onDate", date: "2026-12-31" } }, new Date(2026, 10, 11)),
  ).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z");
});

test("buildRRule renders an afterCount end as COUNT", () => {
  expect(buildRRule({ freq: "DAILY", interval: 1, end: { type: "afterCount", count: 5 } }, new Date(2026, 10, 11)))
    .toBe("RRULE:FREQ=DAILY;COUNT=5");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: FAIL with "buildRRule is not defined" (or similar — the module doesn't exist yet)

- [ ] **Step 3: Implement `buildRRule(rule: RecurrenceRule, eventStartDay: Date): string` in `lib/calendar-recurrence.ts`**

Field order in the output matters for the exact-string assertions above: `FREQ`, then `INTERVAL` (omitted when `1`), then `BYDAY` (only for `WEEKLY`, the single weekday of `eventStartDay` in Google's two-letter form `MO`/`TU`/`WE`/`TH`/`FR`/`SA`/`SU`), then `UNTIL`/`COUNT` depending on `end.type` (nothing for `"never"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Write the failing tests for `parseRRule`**

```ts
test("parseRRule is buildRRule's inverse for a never-ending every-2-weeks rule", () => {
  const rule: RecurrenceRule = { freq: "WEEKLY", interval: 2, end: { type: "never" } };
  expect(parseRRule(buildRRule(rule, new Date(2026, 10, 11)))).toEqual(rule);
});

test("parseRRule reads an UNTIL date back as an onDate end", () => {
  expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z")).toEqual({
    freq: "WEEKLY",
    interval: 1,
    end: { type: "onDate", date: "2026-12-31" },
  });
});

test("parseRRule reads a COUNT back as an afterCount end", () => {
  expect(parseRRule("RRULE:FREQ=DAILY;COUNT=5")).toEqual({
    freq: "DAILY",
    interval: 1,
    end: { type: "afterCount", count: 5 },
  });
});

test("parseRRule defaults interval to 1 when INTERVAL is absent", () => {
  expect(parseRRule("RRULE:FREQ=MONTHLY").interval).toBe(1);
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: FAIL with "parseRRule is not defined"

- [ ] **Step 7: Implement `parseRRule(line: string): RecurrenceRule` in `lib/calendar-recurrence.ts`**

Split on `;`, read each `KEY=VALUE` pair. `BYDAY` is read but not round-tripped into a separate field on `RecurrenceRule` (the type has no weekday field — it's always derived from the event's own start day by `buildRRule`), so `parseRRule` only needs it to exist, not to store it.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: PASS (4/4 new, 9/9 total)

- [ ] **Step 9: Write the failing tests for `truncateRRuleBefore` and `isFirstOccurrence`**

```ts
test("truncateRRuleBefore sets UNTIL to end the day before the given occurrence", () => {
  expect(truncateRRuleBefore("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", new Date(2026, 11, 9)))
    .toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261208T235959Z");
});

test("truncateRRuleBefore replaces an existing UNTIL or COUNT rather than appending a second one", () => {
  const result = truncateRRuleBefore("RRULE:FREQ=DAILY;COUNT=20", new Date(2026, 11, 9));
  expect(result).toBe("RRULE:FREQ=DAILY;UNTIL=20261208T235959Z");
});

test("isFirstOccurrence is true when the occurrence's own start equals the master's start", () => {
  expect(isFirstOccurrence("2026-11-11T09:00:00-05:00", "2026-11-11T09:00:00-05:00")).toBe(true);
});

test("isFirstOccurrence is false for a later occurrence", () => {
  expect(isFirstOccurrence("2026-11-11T09:00:00-05:00", "2026-11-25T09:00:00-05:00")).toBe(false);
});

test("isFirstOccurrence compares date-only (all-day) start strings too", () => {
  expect(isFirstOccurrence("2026-11-11", "2026-11-11")).toBe(true);
  expect(isFirstOccurrence("2026-11-11", "2026-11-25")).toBe(false);
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: FAIL with "truncateRRuleBefore is not defined"

- [ ] **Step 11: Implement `truncateRRuleBefore(line: string, occurrenceStart: Date): string` and `isFirstOccurrence(masterStart: string, occurrenceStart: string): boolean` in `lib/calendar-recurrence.ts`**

`truncateRRuleBefore` removes any existing `UNTIL=`/`COUNT=` token and appends a new `UNTIL=` one day before `occurrenceStart`, in the same `YYYYMMDDT235959Z` form `buildRRule` already produces for `onDate`. `isFirstOccurrence` does a plain string-prefix-aware equality check — both timed and date-only inputs are compared as given, with no timezone math (the two strings being compared always come from the same event's own stored fields, so they're already in the same form).

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-recurrence.test.ts`
Expected: PASS (5/5 new, 14/14 total)

- [ ] **Step 13: Commit**

```bash
git add lib/calendar-recurrence.ts tests/lib/calendar-recurrence.test.ts
git commit -m "feat: add RRULE build/parse/truncate helpers for recurring events"
```

---

## Task 2: `getEvent` read wrapper

**Files:**
- Modify: `lib/google-calendar.ts`
- Test: `tests/lib/google-calendar.test.ts`

**Interfaces:**
- Produces: `getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEvent>`, consumed by Task 3 to read a series' master event before computing an "all"/"following" write.

- [ ] **Step 1: Write the failing test**

```ts
test("getEvent fetches a single event and stamps calendarId onto it", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ id: "master1", summary: "Standup", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" }, recurrence: ["RRULE:FREQ=WEEKLY"] }),
  );

  const event = await getEvent("token", "primary", "master1");

  expect(event).toEqual(
    expect.objectContaining({ id: "master1", calendarId: "primary", recurrence: ["RRULE:FREQ=WEEKLY"] }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/master1",
    expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
  );
});

test("getEvent throws on a non-ok response", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
  await expect(getEvent("token", "primary", "missing")).rejects.toThrow(/404/);
});
```

Use whatever `fetch`-mocking helper (`fetchMock`/`jsonResponse` or equivalent) this test file already uses for `listEvents`/`createEvent` — read the top of `tests/lib/google-calendar.test.ts` and match its existing setup rather than introducing a second convention.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: FAIL with "getEvent is not defined"

- [ ] **Step 3: Implement `getEvent` in `lib/google-calendar.ts`**

A plain `GET` on `calendars/{calendarId}/events/{eventId}`, matching `updateEvent`'s URL-building and `calendarId`-stamping, with no query params and no write-side concerns (no `eventWriteParams()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/google-calendar.test.ts`
Expected: PASS (2/2 new, full file green)

- [ ] **Step 5: Commit**

```bash
git add lib/google-calendar.ts tests/lib/google-calendar.test.ts
git commit -m "feat: add getEvent, a single-event GET wrapper"
```

---

## Task 3: Scope-aware update/delete actions

**Files:**
- Modify: `lib/actions/calendar-events.ts`
- Modify: `lib/calendar-drag.ts:1-11` (export two already-written private helpers; no behavior change)
- Test: `tests/actions/calendar-events.test.ts`

**Interfaces:**
- Consumes: `getEvent` (Task 2); `RecurrenceEditScope`, `truncateRRuleBefore`, `isFirstOccurrence` (Task 1); `dayDelta`, `shiftDateString` (newly exported from `lib/calendar-drag.ts` by this task).
- Produces: `updateEventAction`/`deleteEventAction`'s new input shape —
  `{ eventId: string; scope?: RecurrenceEditScope; recurringEventId?: string; occurrenceOriginalStart?: string; occurrenceOriginalEnd?: string }` added to each's existing input type (`occurrenceOriginalEnd` only meaningful for update). Consumed by Task 6 (drag call sites) and Task 7 (editor Save/Delete).

- [ ] **Step 1: Export `dayDelta` and `shiftDateString` from `lib/calendar-drag.ts`**

Add the `export` keyword to both existing function declarations (`function dayDelta(...)` → `export function dayDelta(...)`, same for `shiftDateString`). No other change to either function.

- [ ] **Step 2: Write the failing tests for `scope: "this"` (unchanged behavior, now explicit)**

```ts
test("updateEventAction with scope 'this' patches exactly the given eventId, same as no scope at all", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "occ1", calendarId: "primary" });
  await updateEventAction({ ...baseInput(), eventId: "occ1", scope: "this" });
  expect(mockUpdateEvent).toHaveBeenCalledWith("test-token", "primary", "occ1", expect.anything());
});

test("deleteEventAction with scope 'this' deletes exactly the given eventId", async () => {
  await deleteEventAction({ calendarId: "primary", eventId: "occ1", scope: "this" });
  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "occ1");
});
```

- [ ] **Step 3: Run tests to verify they pass already**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: PASS — `"this"` is today's existing behavior; this step just pins it before the branching below is added, so a regression in a later step is caught immediately.

- [ ] **Step 4: Write the failing tests for `scope: "all"` — update**

```ts
test("updateEventAction with scope 'all' resolves the master via recurringEventId and PATCHes it instead", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockGetEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({
      start: { dateTime: "2026-11-11T10:00:00.000Z" },
      end: { dateTime: "2026-11-11T10:30:00.000Z" },
    }),
  );
});

test("updateEventAction with scope 'all' on an all-day event shifts the master's date fields by the same day delta", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { date: "2026-11-11" }, end: { date: "2026-11-12" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ allDay: true, start: "2026-11-26", end: "2026-11-27" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25", occurrenceOriginalEnd: "2026-11-26",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ start: { date: "2026-11-12" }, end: { date: "2026-11-13" } }),
  );
});

test("updateEventAction with scope 'all' and no recurringEventId treats the given eventId as the master itself", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00" }),
    eventId: "master1", scope: "all",
    occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
  });

  expect(mockGetEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
});
```

Add `mockGetEvent: vi.fn()` to this test file's existing `vi.hoisted`/`vi.mock("../../lib/google-calendar", ...)` block, alongside the already-mocked `createEvent`/`updateEvent`/`deleteEvent`.

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: FAIL — `scope: "all"` is currently ignored, so `mockUpdateEvent` is called with `occ3`/`occ1`, not `master1`

- [ ] **Step 6: Implement the `scope: "all"` branch in `updateEventAction` and `deleteEventAction`**

`updateEventAction`: when `scope === "all"`, resolve `masterId = input.recurringEventId ?? input.eventId`, `await getEvent(accessToken, input.calendarId, masterId)`, compute the delta (timed: `new Date(input.start).getTime() - new Date(input.occurrenceOriginalStart!).getTime()` in milliseconds, applied via `new Date(new Date(master.start.dateTime!).getTime() + delta).toISOString()`, same for `end`; all-day: `dayDelta(parseDateOnly(occurrenceOriginalStart), parseDateOnly(input.start))` via a small local date-only parse matching `shiftDateString`'s own `YYYY-MM-DD` parsing, applied via `shiftDateString(master.start.date!, delta)`, same for `end`), then PATCH `masterId` with the shifted time plus every other field from `buildEventPayload(input, { forUpdate: true })` as today, with `start`/`end` overridden to the shifted master values.

`deleteEventAction`: when `scope === "all"`, resolve the same way and `deleteEvent` the master id instead of `input.eventId`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: PASS (new tests green, no regressions)

- [ ] **Step 8: Write the failing tests for `scope: "following"` — delete**

```ts
test("deleteEventAction with scope 'following' truncates the master's RRULE instead of deleting anything", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });

  await deleteEventAction({
    calendarId: "primary", eventId: "occ3", scope: "following",
    recurringEventId: "master1", occurrenceOriginalStart: "2026-11-25T09:00:00-05:00",
  });

  expect(mockDeleteEvent).not.toHaveBeenCalled();
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date(2026, 10, 25))] }),
  );
});

test("deleteEventAction with scope 'following' on the series' first occurrence deletes the whole master instead", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });

  await deleteEventAction({
    calendarId: "primary", eventId: "occ1", scope: "following",
    recurringEventId: "master1", occurrenceOriginalStart: "2026-11-11T09:00:00-05:00",
  });

  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
  expect(mockUpdateEvent).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run tests to verify they fail**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: FAIL — `"following"` is currently ignored

- [ ] **Step 10: Implement the `scope: "following"` branch in `deleteEventAction`**

Resolve the master the same way as `"all"`. `await getEvent` to read the master's current `recurrence[0]`. If `isFirstOccurrence(master.start.dateTime ?? master.start.date!, input.occurrenceOriginalStart!)`, delegate to exactly the `"all"` branch's delete (just `deleteEvent` the master). Otherwise, `updateEvent` the master with `recurrence: [truncateRRuleBefore(master.recurrence![0], new Date(input.occurrenceOriginalStart!))]` and nothing else changed.

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: PASS

- [ ] **Step 12: Write the failing tests for `scope: "following"` — update**

```ts
test("updateEventAction with scope 'following' truncates the old series and creates a new one from this occurrence", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", summary: "Standup",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  const result = await updateEventAction({
    ...baseInput({ title: "Standup (longer)", start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date(2026, 10, 25))] }),
  );
  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({
      summary: "Standup (longer)",
      start: { dateTime: "2026-11-25T10:00:00-05:00" },
      end: { dateTime: "2026-11-25T10:30:00-05:00" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    }),
  );
  expect(result).toEqual({ id: "newseries1" });
});

test("updateEventAction with scope 'following' on the series' first occurrence behaves exactly like scope 'all'", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-11T10:00:00-05:00", end: "2026-11-11T10:30:00-05:00" }),
    eventId: "occ1", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
  });

  expect(mockCreateEvent).not.toHaveBeenCalled();
  expect(mockUpdateEvent).toHaveBeenCalledWith("test-token", "primary", "master1", expect.anything());
});

test("updateEventAction with scope 'following' mints a fresh Meet request for the new series rather than copying the master's resolved conferenceData", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/old-link" }] },
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ addGoogleMeet: true, start: "2026-11-25T09:00:00-05:00", end: "2026-11-25T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.conferenceData).toEqual({ createRequest: { requestId: expect.any(String) } });
});

test("updateEventAction with scope 'following' and recurrence explicitly cleared creates a plain one-off with no recurrence field, not a new series", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "oneoff1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ recurrence: [], start: "2026-11-25T09:00:00-05:00", end: "2026-11-25T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.recurrence).toBeUndefined();
});
```

- [ ] **Step 13: Run tests to verify they fail**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: FAIL

- [ ] **Step 14: Implement the `scope: "following"` branch in `updateEventAction`**

Resolve the master the same way as `"all"`, `await getEvent`. If `isFirstOccurrence(...)` (same check as the delete branch), delegate to the `"all"` branch's update logic entirely (no split). Otherwise: `updateEvent` the master with `recurrence: [truncateRRuleBefore(master.recurrence![0], new Date(input.occurrenceOriginalStart!))]` and nothing else of the master changed; then `createEvent` a new event built from `buildEventPayload(input)` (the `forUpdate: false` form, since this is a create) with `input.recurrence` resolved first: **`input.recurrence === undefined`** (the Repeat field was never touched, matching this file's own `*Touched` convention for color/notify/meet/guests) → the new series continues the master's own original, untruncated rule: pass `recurrence: [master.recurrence![0]]`. **`input.recurrence` is a non-empty array** (the user picked a new rule) → use it as given, overriding the old pattern. **`input.recurrence` is `[]`** (the user explicitly set Repeat to "Does not repeat") → call `buildEventPayload` with `recurrence` left `undefined` on the input passed to it (not `[]`), so the created event has no `recurrence` field at all — a plain one-off, not an empty-but-present array. `buildEventPayload` already mints a fresh `createRequest` whenever `input.addGoogleMeet` is true — this falls out of calling it normally on `input`, with no special-casing needed, as long as this path calls `buildEventPayload(input)` rather than copying `master.conferenceData` directly. Return `{ id: created.id }` (the *new* series' id, not the master's) — a caller that needs to keep acting on this occurrence after a "following" split should now address the new series, not the old master.

- [ ] **Step 15: Run tests to verify they pass**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: PASS, full file green

- [ ] **Step 16: Commit**

```bash
git add lib/actions/calendar-events.ts lib/calendar-drag.ts tests/actions/calendar-events.test.ts
git commit -m "feat: make scope-aware update/delete actions for recurring events real"
```

---

## Task 4: Visual repeat badge

**Files:**
- Create: `components/calendar/CalendarIcons.tsx`
- Modify: `components/calendar/EventEditor.tsx` (import `RepeatIcon` from the new file instead of defining it inline)
- Modify: `components/calendar/MonthView.tsx`
- Modify: `components/calendar/HourGrid.tsx`
- Test: `tests/components/month-view.test.tsx`, `tests/components/hour-grid.test.tsx`

**Interfaces:**
- Produces: `RepeatIcon` exported from `components/calendar/CalendarIcons.tsx`.

- [ ] **Step 1: Move `RepeatIcon` out of `EventEditor.tsx` into `components/calendar/CalendarIcons.tsx`, exported, and re-import it in `EventEditor.tsx`**

No behavior change — same SVG, same markup, just relocated so `MonthView`/`HourGrid` can use it without importing the whole editor module.

- [ ] **Step 2: Write the failing tests**

```ts
test("a recurring event's month chip shows the repeat icon", () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  expect(screen.getByTestId("mg-chip-repeat-icon")).toBeInTheDocument();
});

test("a one-off event's month chip shows no repeat icon", () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  expect(screen.queryByTestId("mg-chip-repeat-icon")).not.toBeInTheDocument();
});
```

Add the equivalent pair in `tests/components/hour-grid.test.tsx` for a timed block, using whatever `data-testid` naming that file's existing chip tests already follow (or `wg-event-repeat-icon` if none exists yet).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx`
Expected: FAIL — no such test id renders yet

- [ ] **Step 4: Render `RepeatIcon` conditionally on `event.recurringEventId != null` in `MonthView.tsx`'s `MonthEventChip` and `HourGrid.tsx`'s `TimedEventBlock`/`AllDayEventChip`**

Wrap the icon in a small `<span data-testid="...">` matching whichever test id the step above asserts, placed inline before the event's title text.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/calendar/CalendarIcons.tsx components/calendar/EventEditor.tsx components/calendar/MonthView.tsx components/calendar/HourGrid.tsx tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx
git commit -m "feat: show a repeat icon on recurring events' chips"
```

---

## Task 5: Recurrence scope dialog

**Files:**
- Create: `components/calendar/RecurrenceScopeDialog.tsx`
- Test: `tests/components/recurrence-scope-dialog.test.tsx`

**Interfaces:**
- Produces: `RecurrenceScopeDialog({ allowThisEvent, onChoose, onCancel }: { allowThisEvent: boolean; onChoose(scope: RecurrenceEditScope): void; onCancel(): void })`, consumed by Task 6 and Task 7.

- [ ] **Step 1: Write the failing tests**

```ts
test("shows all three choices when allowThisEvent is true", () => {
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("button", { name: /this event/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /this and following/i })).toBeInTheDocument();
});

test("omits 'This event' when allowThisEvent is false", () => {
  render(<RecurrenceScopeDialog allowThisEvent={false} onChoose={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /this event/i })).not.toBeInTheDocument();
});

test("clicking a choice calls onChoose with that scope", async () => {
  const onChoose = vi.fn();
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={onChoose} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /all events/i }));
  expect(onChoose).toHaveBeenCalledWith("all");
});

test("Escape calls onCancel, via the shared ModalShell", async () => {
  const onCancel = vi.fn();
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={vi.fn()} onCancel={onCancel} />);
  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/recurrence-scope-dialog.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `RecurrenceScopeDialog` in `components/calendar/RecurrenceScopeDialog.tsx`**

Render inside `ModalShell` (passing `onCancel` as `ModalShell`'s `onClose`, giving Escape-closes for free), with one button per choice calling `onChoose` with the matching `RecurrenceEditScope` value, plus a plain Cancel button also calling `onCancel`. Button labels exactly: "This event", "All events", "This and following events".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/recurrence-scope-dialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/calendar/RecurrenceScopeDialog.tsx tests/components/recurrence-scope-dialog.test.tsx
git commit -m "feat: add the This/All/Following recurrence scope dialog"
```

---

## Task 6: Wire the scope dialog into drag-to-reschedule

**Files:**
- Modify: `components/calendar/MonthView.tsx`
- Modify: `components/calendar/HourGrid.tsx`
- Test: `tests/components/month-view.test.tsx`, `tests/components/hour-grid.test.tsx`

**Interfaces:**
- Consumes: `RecurrenceScopeDialog` (Task 5); `updateEventAction`'s widened input shape (Task 3).

- [ ] **Step 1: Write the failing test for Month view**

```ts
test("dragging a recurring event's chip shows the scope dialog instead of saving immediately", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  expect(await screen.findByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("picking 'This event' after dragging a recurring event sends scope 'this' and the dragged occurrence's own id", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await userEvent.click(await screen.findByRole("button", { name: /this event/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(expect.objectContaining({ eventId: "occ1", scope: "this" }));
});

test("picking 'All events' after dragging a recurring event sends scope 'all' plus the occurrence's original start/end and recurringEventId", async () => {
  render(<Harness events={[{ ...timedEvent({ id: "occ1", start: "2026-10-20T09:00:00-04:00" }), recurringEventId: "master1" }]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await userEvent.click(await screen.findByRole("button", { name: /all events/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "all", recurringEventId: "master1",
      occurrenceOriginalStart: "2026-10-20T09:00:00-04:00", occurrenceOriginalEnd: expect.any(String),
    }),
  );
});

test("dragging a one-off event never shows the scope dialog", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /all events/i })).not.toBeInTheDocument();
});
```

Add the equivalent set for a timed drag in `tests/components/hour-grid.test.tsx`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx`
Expected: FAIL — dragging a recurring event saves immediately with no `scope` today

- [ ] **Step 3: Wire the dialog into `MonthView.tsx`'s `handleDrop` and `HourGrid.tsx`'s `handleAllDayDrop`/`handleTimedDrop`**

In each, when the computed-but-not-yet-saved drop's `event.recurringEventId` is set, hold the pending `{ event, shifted start/end }` in a new piece of local state and render `RecurrenceScopeDialog` (`allowThisEvent={true}` always, for a drag) instead of calling `updateEventAction` right away. On a choice, call `updateEventAction` with `scope`, `recurringEventId: event.recurringEventId`, `occurrenceOriginalStart: event.start.dateTime ?? event.start.date`, `occurrenceOriginalEnd: event.end.dateTime ?? event.end.date`, alongside the already-shifted `start`/`end` exactly as today's unscoped call already sends. When `recurringEventId` is absent, call `updateEventAction` immediately as today, no dialog, `scope` omitted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/calendar/MonthView.tsx components/calendar/HourGrid.tsx tests/components/month-view.test.tsx tests/components/hour-grid.test.tsx
git commit -m "feat: show the recurrence scope dialog when dragging a repeating event"
```

---

## Task 7: Wire the scope dialog into the editor's Save/Delete, and keyboard Delete

**Files:**
- Modify: `components/calendar/EventEditor.tsx`
- Modify: `components/calendar/CalendarShortcuts.tsx:22` (export `isTypingTarget`)
- Modify: `lib/calendar-event-task-mapping.ts` (`googleEventToEditorInitial` carries `recurringEventId` through)
- Test: `tests/components/event-editor.test.tsx`

**Interfaces:**
- Consumes: `RecurrenceScopeDialog` (Task 5); `updateEventAction`/`deleteEventAction`'s widened input shape (Task 3); `isTypingTarget` (newly exported from `CalendarShortcuts.tsx`).
- Produces: `EventEditor`'s `initial` prop type gains `recurringEventId?: string`, consumed by `EventTaskModal.tsx` (no change needed there — it already passes `googleEventToEditorInitial(event)`'s whole return value through).

- [ ] **Step 1: Export `isTypingTarget` from `components/calendar/CalendarShortcuts.tsx`**

Add the `export` keyword to its existing declaration. No behavior change.

- [ ] **Step 2: Add `recurringEventId?: string` to `googleEventToEditorInitial`'s return type in `lib/calendar-event-task-mapping.ts`, carried straight from `event.recurringEventId`**

- [ ] **Step 3: Write the failing tests for Save**

```ts
test("saving an edit to a recurring event shows the scope dialog before calling updateEventAction", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "occ1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false, recurringEventId: "master1" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.click(screen.getByText("Save"));
  expect(await screen.findByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("saving an edit to a one-off event never shows the scope dialog", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "e1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.click(screen.getByText("Save"));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /all events/i })).not.toBeInTheDocument();
});

test("picking a scope after Save sends it, plus the pre-edit occurrenceOriginalStart/End and recurringEventId", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "occ1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false, recurringEventId: "master1" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.click(screen.getByText("Save"));
  await userEvent.click(await screen.findByRole("button", { name: /all events/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "all", recurringEventId: "master1",
      occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
    }),
  );
});

test("picking a scope after Save on an all-day recurring event sends occurrenceOriginalEnd in Google's raw exclusive form, not the editor's inclusive display value", async () => {
  // initial.end is the editor's INCLUSIVE display value (see googleEventToEditorInitial's
  // allDayEndToInclusive conversion) — a 1-day all-day event displayed as the same day it
  // starts, which is one day *before* Google's own raw exclusive end.date.
  render(
    <EventEditor mode="edit" initial={{ eventId: "occ1", calendarId: "primary", title: "Standup", start: "2026-11-11", end: "2026-11-11", allDay: true, recurringEventId: "master1" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.click(screen.getByText("Save"));
  await userEvent.click(await screen.findByRole("button", { name: /all events/i }));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ occurrenceOriginalStart: "2026-11-11", occurrenceOriginalEnd: "2026-11-12" }),
  );
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: FAIL — `handleSave` currently calls `updateEventAction` unconditionally with no `scope`

- [ ] **Step 5: Wire the dialog into `handleSave`**

When `mode === "edit"` and `initial.recurringEventId` is set, hold the built `EventActionInput` in local state and render `RecurrenceScopeDialog` instead of calling `updateEventAction` directly. `allowThisEvent` is `false` when the live Repeat field's current rule differs from what `parseRRule(initial.recurrence?.[0])` produced on open (Task 8 owns the Repeat field itself; this task only reads its current value for this comparison), `true` otherwise. On a choice, call `updateEventAction` with that `scope`, `recurringEventId: initial.recurringEventId`, `occurrenceOriginalStart: initial.start`, and `occurrenceOriginalEnd` — for a timed event, `initial.end` directly; for an all-day event, `allDayEndToExclusive(initial.end)` (converting the editor's inclusive display value back to Google's raw exclusive form, matching what `handleSave` already does for the *new* `end` a few lines above). When `initial.recurringEventId` is absent, call `updateEventAction` immediately as today.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: PASS

- [ ] **Step 7: Write the failing tests for Delete and keyboard Delete**

```ts
test("clicking Delete on a recurring event shows the scope dialog before calling deleteEventAction", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "occ1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false, recurringEventId: "master1" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.click(screen.getByText("Delete"));
  expect(await screen.findByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(mockDeleteEventAction).not.toHaveBeenCalled();
});

test("pressing Backspace while the editor is open deletes a one-off event, same as clicking Delete", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "e1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  await userEvent.keyboard("{Backspace}");
  await vi.waitFor(() => expect(mockDeleteEventAction).toHaveBeenCalledWith({ calendarId: "primary", eventId: "e1" }));
});

test("pressing Delete while focus is in the title input does not delete the event", async () => {
  render(
    <EventEditor mode="edit" initial={{ eventId: "e1", calendarId: "primary", title: "Standup", start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00", allDay: false }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />,
  );
  screen.getByLabelText("Title").focus();
  await userEvent.keyboard("{Delete}");
  expect(mockDeleteEventAction).not.toHaveBeenCalled();
});
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: FAIL — no keyboard listener exists yet; `handleDelete` currently calls `deleteEventAction` unconditionally

- [ ] **Step 9: Wire the dialog into `handleDelete`, and add the keyboard Delete listener**

`handleDelete`: when `initial.recurringEventId` is set, render `RecurrenceScopeDialog` (`allowThisEvent={true}` always — deleting never changes the recurrence rule itself) instead of deleting immediately; on a choice, call `deleteEventAction` with that `scope`, `recurringEventId: initial.recurringEventId`, `occurrenceOriginalStart: initial.start` (or the all-day-exclusive form, matching Step 5's conversion). When absent, delete immediately as today.

Keyboard listener: a `document`-level `keydown` effect scoped to this component's mount lifecycle (mirroring `ModalShell`'s own Escape listener), guarded by this file's own is-typing-target check (reuse the now-exported `isTypingTarget` from `CalendarShortcuts.tsx` rather than reimplementing it) and by `document.activeElement` not being inside this editor's own guest-email input specifically if `isTypingTarget` doesn't already cover it. On `event.key === "Delete" || event.key === "Backspace"` (and the guard passes), call `handleDelete()`.

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: PASS, full file green

- [ ] **Step 11: Commit**

```bash
git add components/calendar/EventEditor.tsx components/calendar/CalendarShortcuts.tsx lib/calendar-event-task-mapping.ts tests/components/event-editor.test.tsx
git commit -m "feat: scope-aware Save/Delete and keyboard Delete for recurring events"
```

---

## Task 8: Live Repeat field with a custom recurrence builder

**Files:**
- Create: `components/calendar/RecurrenceField.tsx`
- Modify: `components/calendar/EventEditor.tsx`
- Test: `tests/components/recurrence-field.test.tsx`

**Interfaces:**
- Consumes: `RecurrenceRule`, `buildRRule`, `parseRRule` (Task 1).
- Produces: `RecurrenceField({ value, onChange }: { value: RecurrenceRule | null; onChange(rule: RecurrenceRule | null): void })`, consumed by `EventEditor.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
test("defaults to 'Does not repeat' when value is null", () => {
  render(<RecurrenceField value={null} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Repeat")).toHaveValue("none");
});

test("picking 'Daily' calls onChange with a daily, never-ending rule", async () => {
  const onChange = vi.fn();
  render(<RecurrenceField value={null} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "daily");
  expect(onChange).toHaveBeenCalledWith({ freq: "DAILY", interval: 1, end: { type: "never" } });
});

test("picking 'Custom...' reveals interval, unit, and end-condition controls", async () => {
  render(<RecurrenceField value={null} onChange={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "custom");
  expect(screen.getByLabelText(/every/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ends/i)).toBeInTheDocument();
});

test("the custom builder's interval+unit produces the matching RecurrenceRule", async () => {
  const onChange = vi.fn();
  render(<RecurrenceField value={null} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "custom");
  await userEvent.clear(screen.getByLabelText(/every/i));
  await userEvent.type(screen.getByLabelText(/every/i), "2");
  await userEvent.selectOptions(screen.getByLabelText(/unit/i), "weeks");
  expect(onChange).toHaveBeenLastCalledWith({ freq: "WEEKLY", interval: 2, end: { type: "never" } });
});

test("a non-null value populates the field as 'Custom...' with its own interval/unit/end pre-filled", () => {
  render(<RecurrenceField value={{ freq: "WEEKLY", interval: 2, end: { type: "never" } }} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Repeat")).toHaveValue("custom");
  expect(screen.getByLabelText(/every/i)).toHaveValue(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/recurrence-field.test.tsx`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `RecurrenceField` in `components/calendar/RecurrenceField.tsx`**

A `<select aria-label="Repeat">` with options `none`/`daily`/`weekly`/`monthly`/`yearly`/`weekday`/`custom`; the five non-`none`/`custom` presets each map to one fixed `RecurrenceRule` (`interval: 1`, `end: { type: "never" }`, and for `weekday` — "every weekday" — this task picks whatever internal representation Task 3/Task 1 already support: since `RecurrenceRule` has no multi-BYDAY concept, represent "every weekday" distinctly in this component's own UI-only preset list without round-tripping it through `RecurrenceRule` at all if `buildRRule` can't express it — or drop the "every weekday" preset from this scope entirely and keep the five the design doc's Global Constraints already cover (`Daily`/`Weekly`/`Monthly`/`Annually`) plus `Custom...`, since "every weekday" needs multi-BYDAY support this plan deliberately excludes. **Builder's call**, consistent with the design doc's own BYDAY scoping.) When `custom` is selected, reveal a number input (`aria-label` containing "every") + a unit `<select>` (`aria-label` containing "unit"; `days`/`weeks`/`months`/`years`) + an end-condition control (`aria-label` containing "ends": never / on a date / after N occurrences, the latter two revealing a date input or a count input respectively). Every control change calls `onChange` with the fully rebuilt `RecurrenceRule`; selecting `none` calls `onChange(null)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/recurrence-field.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `EventEditor` integration**

```ts
test("saving a new event with a custom weekly recurrence sends the matching RRULE line", async () => {
  render(<EventEditor mode="create" initial={{ calendarId: "primary" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />);
  await userEvent.type(screen.getByLabelText("Title"), "Change contacts");
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "custom");
  await userEvent.clear(screen.getByLabelText(/every/i));
  await userEvent.type(screen.getByLabelText(/every/i), "2");
  await userEvent.selectOptions(screen.getByLabelText(/unit/i), "weeks");
  await userEvent.click(screen.getByText("Save"));
  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction.mock.calls[0][0].recurrence).toEqual([expect.stringContaining("FREQ=WEEKLY;INTERVAL=2")]);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: FAIL — the Repeat `<select>` is still the disabled placeholder

- [ ] **Step 7: Replace `EventEditor.tsx`'s disabled Repeat `<select>` with `<RecurrenceField>`**

Controlled by a new `recurrence`/`setRecurrence` state initialized from `parseRRule(initial.recurrence?.[0])` when present, `null` otherwise (matching every other field's `initial.*`-seeded `useState` already in this file). On save, `buildRRule(recurrence, startDate-as-Date)` feeds `EventActionInput.recurrence` when `recurrence` is non-null; `recurrence: mode === "create" || recurrenceTouched ? (recurrence ? [buildRRule(...)] : []) : undefined` — following this file's own established `*Touched` pattern (see `colorTouched`/`notifyTouched`/`meetTouched`/`guestsTouched`) so an edit that never touches Repeat doesn't clobber an existing rule.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: PASS, full file green

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every test file green, no regressions anywhere in the suite

- [ ] **Step 10: Commit**

```bash
git add components/calendar/RecurrenceField.tsx components/calendar/EventEditor.tsx tests/components/recurrence-field.test.tsx tests/components/event-editor.test.tsx
git commit -m "feat: make the Repeat field live with a custom recurrence builder"
```
