# Calendar — Event & Task Creation, Part 3: Recurring Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 3 of 3** of the Calendar Event & Task Creation feature. Builds directly on **Part 2** (`2026-10-22-calendar-event-task-creation-2-create-edit.md`), which must already be merged/present: `EventEditor`'s disabled Repeat placeholder, `RecurrenceEditScope`/the `scope` parameter on `updateEventAction`/`deleteEventAction` (accepted but ignored until this part), and the full click-to-create/edit flow for non-recurring events and tasks all already exist. This part adds the Repeat dropdown, Custom recurrence patterns, and the three-way "this event / all events / this and following events" edit-and-delete scope — the single most complex piece of the whole feature, per the design doc. Tasks never repeat; this part touches events only.

**Goal:** Let the user create a recurring event with Google Calendar's own Repeat options (including Custom), and edit or delete an occurrence of an existing recurring series with the same three-way choice Google Calendar's own UI offers.

**Architecture:** Recurrence is represented the same way Google represents it: raw RRULE string arrays. `lib/calendar-rrule.ts` builds, parses, and truncates them; `RepeatPicker` is the only UI surface that touches RRULE syntax directly. The three-way edit/delete scope is implemented entirely in `lib/actions/calendar-events.ts` (already structured for it since Part 1) by branching on the instance's `recurringEventId` and, for the hardest case ("this and following"), inserting a new continuation event *before* truncating the original series — never the reverse, since a failure between the two steps must never leave the series silently missing its future occurrences.

**Tech Stack:** Next.js 16 App Router (server actions, client components), Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-calendar-event-task-creation-design.md`

## Global Constraints

- Recurrence is **events only** — Tasks never repeat, per the design doc.
- RRULE's `UNTIL` value is a bare date (`YYYYMMDD`) for an all-day series and a UTC date-time (`YYYYMMDDTHHMMSSZ`) for a timed one — a formatting detail, not a product decision, but one that must be gotten right in both directions.
- "This and following" **write ordering is load-bearing**: insert the continuation event first, then truncate the original series' `UNTIL` only after that insert succeeds. Truncating first and having the insert then fail would silently delete the series' future occurrences with nothing to replace them.
- "This event" hides/disables the Repeat field (a single instance can't carry its own recurrence rule); "All events" and "this and following" leave it fully live, including collapsing to "Does not repeat."
- Icons match the sidebar's existing visual language: inline SVG, `viewBox="0 0 24 24"`, rendered 16×16, `stroke-width: 1.6`, `stroke: currentColor`, `fill: none`.

## Review Focus

- **"This and following" on the series' very first or very last occurrence** must fall through to the general `UNTIL`-truncation logic rather than crash or silently no-op on a degenerate range. Covered in Task 3.
- **All-day vs. timed recurring series must produce the correct `UNTIL` format** (bare date vs. UTC date-time) when truncating — the two code paths are easy to conflate. Covered in Task 2.
- **Collapsing an existing recurring series back to "Does not repeat"** via the "All events" scope must clear `recurrence` entirely on the master event, not leave a stale RRULE behind. Covered in Task 3.

---

## File Structure

**New files:**
- `lib/calendar-rrule.ts` — RRULE build/parse/truncate helpers
- `components/calendar/RepeatPicker.tsx` — Repeat dropdown + Custom sub-picker
- `components/calendar/RecurrenceScopeDialog.tsx` — "this event / all events / this and following" chooser

**Modified files:**
- `lib/google-calendar.ts` — add `getEvent`
- `lib/actions/calendar-events.ts` — scope-aware `updateEventAction`/`deleteEventAction`
- `components/calendar/EventEditor.tsx` — live Repeat field, recurrence-scope dialog on Save/Delete

---

### Task 1: Repeat picker — standard options + RRULE builder

**Files:**
- Create: `lib/calendar-rrule.ts`
- Create: `components/calendar/RepeatPicker.tsx`
- Modify: `components/calendar/EventEditor.tsx`
- Test: `tests/lib/calendar-rrule.test.ts`
- Test: `tests/components/repeat-picker.test.tsx`

**Interfaces:**
- Produces: `type RepeatOption = "none" | "daily" | "weekly" | "monthly" | "yearly" | "weekday" | "custom"`; `buildStandardRecurrenceRule(option: Exclude<RepeatOption, "none" | "custom">, eventStart: { date: string; allDay: boolean }): string[]` (returns an RRULE line array, e.g. `["RRULE:FREQ=DAILY"]`); `function RepeatPicker(props: { value: string[] | undefined; allDay: boolean; eventStartDate: string; onChange(rrule: string[] | undefined): void }): JSX.Element` (Custom is stubbed as a disabled option in this task — Task 2 enables it).

- [ ] **Step 1: Write the failing `calendar-rrule` tests**

```ts
test("daily builds FREQ=DAILY", () => { expect(buildStandardRecurrenceRule("daily", { date: "2026-10-22", allDay: false })).toEqual(["RRULE:FREQ=DAILY"]); });
test("weekly builds FREQ=WEEKLY on the event's own weekday", () => {
  // 2026-10-22 is a Thursday -> ["RRULE:FREQ=WEEKLY;BYDAY=TH"]
  expect(buildStandardRecurrenceRule("weekly", { date: "2026-10-22", allDay: false })).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
});
test("monthly builds FREQ=MONTHLY", () => { /* ["RRULE:FREQ=MONTHLY"] */ });
test("yearly builds FREQ=YEARLY", () => { /* ["RRULE:FREQ=YEARLY"] */ });
test("weekday builds FREQ=WEEKLY with Mon-Fri BYDAY", () => { expect(buildStandardRecurrenceRule("weekday", { date: "2026-10-22", allDay: false })).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]); });
```

- [ ] **Step 2: Run, verify fail, implement, run, verify pass**

Run: `npx vitest run tests/lib/calendar-rrule.test.ts`. `BYDAY` abbreviations: `SU,MO,TU,WE,TH,FR,SA` indexed by the date string's own weekday. Parse the bare `YYYY-MM-DD` string's digits directly (do not use `new Date(dateString).getDay()`, which re-parses through the runtime's timezone — the exact bug class `lib/calendar-dates.ts`'s docstring warns about for `dateTime` strings; here there's no offset at all, so parse the digits via a small regex, then compute the weekday from the resulting `{year, month, day}` via `new Date(year, month, day).getDay()`, which is safe local-index arithmetic).

- [ ] **Step 3: Write the failing `RepeatPicker` tests**

```tsx
test("selecting Weekly calls onChange with buildStandardRecurrenceRule('weekly', ...)", async () => {
  const onChange = vi.fn();
  render(<RepeatPicker value={undefined} allDay={false} eventStartDate="2026-10-22" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByRole("combobox"), "Weekly");
  expect(onChange).toHaveBeenCalledWith(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
});

test("selecting Does not repeat calls onChange with undefined", async () => { /* ... */ });

test("Custom is present in the dropdown but selecting it does not yet change the value (stub)", async () => {
  // selecting Custom calls onChange with undefined or leaves it unchanged — document whichever this task's stub does, and assert that
});
```

- [ ] **Step 4: Run, verify fail, implement `RepeatPicker` (dropdown only; Custom inert for now), run, verify pass**

Run: `npx vitest run tests/components/repeat-picker.test.tsx`

- [ ] **Step 5: Wire into `EventEditor`**

Replace the disabled Repeat placeholder (from Part 2) with `<RepeatPicker value={recurrence} allDay={allDay} eventStartDate={startDate} onChange={setRecurrence} />`; `recurrence` is included in the `EventActionInput` passed to `createEventAction`/`updateEventAction`.

- [ ] **Step 6: Commit**

```bash
git add lib/calendar-rrule.ts components/calendar/RepeatPicker.tsx components/calendar/EventEditor.tsx tests/lib/calendar-rrule.test.ts tests/components/repeat-picker.test.tsx
git commit -m "feat: add the Repeat dropdown with standard recurrence patterns"
```

---

### Task 2: Custom repeat sub-picker + RRULE parse/truncate

**Files:**
- Modify: `lib/calendar-rrule.ts`
- Modify: `components/calendar/RepeatPicker.tsx`
- Test: `tests/lib/calendar-rrule.test.ts` (add cases)
- Test: `tests/components/repeat-picker.test.tsx` (add cases)

**Interfaces:**
- Produces: `type CustomRecurrence = { interval: number; unit: "day" | "week" | "month" | "year"; byDay?: string[]; end: { type: "never" } | { type: "on-date"; date: string } | { type: "after-count"; count: number } }`; `buildCustomRecurrenceRule(custom: CustomRecurrence): string[]`; `parseRecurrenceRule(rrule: string[]): { option: RepeatOption; custom?: CustomRecurrence }` (inverse, used when editing an existing recurring event so the dropdown reflects its real pattern); `truncateRecurrenceUntil(rrule: string[], untilExclusive: { date: string; allDay: boolean }): string[]` (returns a new RRULE array with `UNTIL` set to just before `untilExclusive`, preserving every other RRULE part unchanged).

- [ ] **Step 1: Write the failing tests**

```ts
test("buildCustomRecurrenceRule: every 2 weeks on Mon & Thu, ending after 10 occurrences", () => {
  expect(buildCustomRecurrenceRule({ interval: 2, unit: "week", byDay: ["MO", "TH"], end: { type: "after-count", count: 10 } }))
    .toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10"]);
});

test("buildCustomRecurrenceRule: every 3 months, ending on a date", () => {
  expect(buildCustomRecurrenceRule({ interval: 3, unit: "month", end: { type: "on-date", date: "2027-01-01" } }))
    .toEqual(["RRULE:FREQ=MONTHLY;INTERVAL=3;UNTIL=20270101"]);
});

test("parseRecurrenceRule inverts buildStandardRecurrenceRule output back to its option", () => {
  expect(parseRecurrenceRule(["RRULE:FREQ=DAILY"])).toEqual({ option: "daily" });
  expect(parseRecurrenceRule(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"])).toEqual({ option: "weekday" });
});

test("parseRecurrenceRule falls back to option: 'custom' with the parsed CustomRecurrence for anything else", () => {
  expect(parseRecurrenceRule(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10"])).toEqual({
    option: "custom",
    custom: { interval: 2, unit: "week", byDay: ["MO", "TH"], end: { type: "after-count", count: 10 } },
  });
});

test("truncateRecurrenceUntil sets a bare-date UNTIL for an all-day series, one day before the given date", () => {
  expect(truncateRecurrenceUntil(["RRULE:FREQ=WEEKLY;BYDAY=TH"], { date: "2026-11-05", allDay: true }))
    .toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261104"]);
});

test("truncateRecurrenceUntil sets a UTC date-time UNTIL for a timed series, at the instant just before the given date's same wall-clock start", () => {
  // timed series starting 09:00 -04:00 originally; truncating before 2026-11-05 -> UNTIL=20261104T130000Z (09:00 -04:00 the day before, in UTC)
  // exact input/output left to the implementer's test fixture, but the UTC-vs-bare-date distinction must be exercised
});

test("truncateRecurrenceUntil replaces an existing UNTIL or COUNT rather than appending a second one", () => {
  expect(truncateRecurrenceUntil(["RRULE:FREQ=DAILY;COUNT=50"], { date: "2026-10-25", allDay: true }))
    .toEqual(["RRULE:FREQ=DAILY;UNTIL=20261024"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calendar-rrule.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the three new functions in `lib/calendar-rrule.ts`**

`buildCustomRecurrenceRule`: map `unit` to `FREQ` (`day→DAILY`, `week→WEEKLY`, `month→MONTHLY`, `year→YEARLY`), add `INTERVAL=N` only when `interval !== 1`, add `BYDAY=...` when present, add `UNTIL=YYYYMMDD` (`end.type === "on-date"`) or `COUNT=N` (`end.type === "after-count"`) — omit both for `"never"`. `parseRecurrenceRule`: split the single RRULE string on `;`, parse into a key/value map, then pattern-match: `FREQ=DAILY` with no other parts → `"daily"`; `FREQ=WEEKLY` with `BYDAY=MO,TU,WE,TH,FR` and no other parts → `"weekday"`; `FREQ=WEEKLY` with a single `BYDAY` matching the series' own start weekday and no other parts → `"weekly"`; `FREQ=MONTHLY`/`FREQ=YEARLY` with no other parts → `"monthly"`/`"yearly"`; anything else → `"custom"` with every present part reconstructed into a `CustomRecurrence`. `truncateRecurrenceUntil`: parse the existing rule into parts (reuse the same key/value map), delete any existing `UNTIL`/`COUNT` key, compute the replacement `UNTIL` value as one calendar day before `untilExclusive.date` when `allDay` (bare `YYYYMMDD`), or as the exact instant one day before `untilExclusive.date` at the series' original start time, formatted in UTC with a trailing `Z` (`YYYYMMDDTHHMMSSZ`) otherwise, re-join the parts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calendar-rrule.test.ts`
Expected: PASS

- [ ] **Step 5: Build the Custom sub-picker UI in `RepeatPicker`**

Selecting "Custom" reveals: an interval number input + unit `<select>`, a day-of-week multi-select (shown only when unit is "week"), and an end-condition radio group (Never / On date / After N occurrences) with the matching input shown per choice. Calls `onChange(buildCustomRecurrenceRule(custom))` on every change. When `props.value` is already set to a non-standard rule at mount (editing an existing event), call `parseRecurrenceRule(props.value)` to decide the dropdown's initial selection and, if `option === "custom"`, the sub-picker's initial fields.

- [ ] **Step 6: Run the updated `RepeatPicker` tests**

Add and run cases for: Custom sub-form renders when selected; changing the interval/unit/end-condition calls `onChange` with the matching `buildCustomRecurrenceRule` output; mounting with an existing custom RRULE pre-fills the sub-form via `parseRecurrenceRule`.

Run: `npx vitest run tests/components/repeat-picker.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/calendar-rrule.ts components/calendar/RepeatPicker.tsx tests/lib/calendar-rrule.test.ts tests/components/repeat-picker.test.tsx
git commit -m "feat: add Custom repeat patterns and RRULE parsing/truncation"
```

---

### Task 3: Recurring event edit/delete — the three-way scope

**Files:**
- Modify: `lib/google-calendar.ts`
- Modify: `lib/actions/calendar-events.ts`
- Create: `components/calendar/RecurrenceScopeDialog.tsx`
- Modify: `components/calendar/EventEditor.tsx`
- Test: `tests/lib/google-calendar.test.ts` (add one case)
- Test: `tests/actions/calendar-events.test.ts` (add cases)
- Test: `tests/components/recurrence-scope-dialog.test.tsx`

**Interfaces:**
- Consumes: `truncateRecurrenceUntil` (Task 2), `createEvent`/`updateEvent`/`deleteEvent` (Part 1).
- Produces: `getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEvent>` (in `lib/google-calendar.ts`, a thin `GET .../events/{eventId}`); `function RecurrenceScopeDialog(props: { onChoose(scope: RecurrenceEditScope): void; onCancel(): void }): JSX.Element` (three buttons: "This event" / "This and following events" / "All events"). `updateEventAction`/`deleteEventAction` (Part 1) become scope-aware per the branching below, replacing their current "always act on `eventId` as given" behavior.

- [ ] **Step 1: Write the failing test for `getEvent`, then implement it**

```ts
test("getEvent fetches a single event and stamps calendarId onto it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "e1", summary: "Standup", recurringEventId: "master1", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T10:00:00-04:00" } }) }));
  const result = await getEvent("tok", "primary", "e1");
  expect(result.calendarId).toBe("primary");
  expect(fetch).toHaveBeenCalledWith("https://www.googleapis.com/calendar/v3/calendars/primary/events/e1", expect.objectContaining({ headers: { Authorization: "Bearer tok" } }));
});
```

Run: `npx vitest run tests/lib/google-calendar.test.ts` (fails, then implement `getEvent` alongside `createEvent`/`updateEvent`/`deleteEvent`, then re-run to confirm it passes).

- [ ] **Step 2: Write the failing tests for the scope-aware actions**

Add to `tests/actions/calendar-events.test.ts`:

```ts
test("updateEventAction with scope 'this' patches exactly the given eventId and does not touch recurrence", async () => {
  // updateEvent called once, with the instance's own eventId, patch has no recurrence key added/removed beyond what was passed
});

test("updateEventAction with scope 'all' looks up the event's recurringEventId and patches the master event instead", async () => {
  // getEvent called to read recurringEventId, then updateEvent called with the MASTER's id, not the instance's
});

test("updateEventAction with scope 'all' and recurrence explicitly cleared collapses the series to a plain event", async () => {
  // payload.recurrence passed as [] (or omitted entirely) -> updateEvent called with a patch that clears recurrence on the master, not one that leaves the old RRULE in place
});

test("updateEventAction with scope 'following': inserts a new continuation event first, then truncates the original master's UNTIL — in that order", async () => {
  const calls: string[] = [];
  vi.mocked(createEvent).mockImplementation(async () => { calls.push("create"); return { id: "new-continuation" } as any; });
  vi.mocked(updateEvent).mockImplementation(async () => { calls.push("truncate"); return {} as any; });
  await updateEventAction({ /* ...scope: "following" */ });
  expect(calls).toEqual(["create", "truncate"]);
});

test("updateEventAction with scope 'following' leaves the original master untouched if the continuation insert fails", async () => {
  vi.mocked(createEvent).mockRejectedValue(new Error("network"));
  await expect(updateEventAction({ /* ... */ })).rejects.toThrow();
  expect(updateEvent).not.toHaveBeenCalled();
});

test("updateEventAction with scope 'following' on the series' very first occurrence still succeeds (degenerate UNTIL case)", async () => {
  // the computed UNTIL ends up before the master's own DTSTART; this is accepted as-is (Google's own API tolerates
  // a vacuous recurrence), not special-cased — assert no throw and that truncateRecurrenceUntil's normal output is used verbatim
});

test("deleteEventAction with scope 'this' deletes exactly the given eventId", async () => { /* ... */ });

test("deleteEventAction with scope 'all' deletes the recurringEventId master, not the instance", async () => { /* ... */ });

test("deleteEventAction with scope 'following' truncates the master's UNTIL (an update, not a delete) and issues no create", async () => { /* ... */ });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement the scope branching in `lib/actions/calendar-events.ts`**

Use `getEvent` (Step 1) to read `recurringEventId` and the master's current `start`/`recurrence` when scope is `"all"` or `"following"`.

- `updateEventAction`:
  - `scope: "this"` or no `scope` (non-recurring): unchanged from Part 1 — `updateEvent(accessToken, calendarId, eventId, payload)`.
  - `scope: "all"`: fetch the instance to get `recurringEventId`, then `updateEvent(accessToken, calendarId, recurringEventId, payload)` — including the possibly-changed `recurrence` field (collapsing to "Does not repeat" means `payload.recurrence` is explicitly `[]`/`null`, which Google accepts as removing recurrence).
  - `scope: "following"`: fetch the instance to get `recurringEventId` and the instance's own `start`; fetch the master to read its current `recurrence`. First `createEvent(accessToken, calendarId, { ...payload, start: instance.start, end: instance.end, recurrence: payload.recurrence ?? master.recurrence })` (the continuation — carries the new pattern if the Repeat field changed, otherwise the master's existing pattern re-based from here, per the design doc). Only after that insert resolves, `updateEvent(accessToken, calendarId, recurringEventId, { recurrence: truncateRecurrenceUntil(master.recurrence, { date: instance.start, allDay: payload.allDay }) })`. This insert-then-truncate order is load-bearing: swapping it would silently lose future occurrences if the insert then failed.
- `deleteEventAction`: `scope: "this"`/none → `deleteEvent` on `eventId` unchanged. `scope: "all"` → fetch `recurringEventId`, `deleteEvent` on that. `scope: "following"` → fetch `recurringEventId` + master `recurrence`, then `updateEvent(accessToken, calendarId, recurringEventId, { recurrence: truncateRecurrenceUntil(master.recurrence, { date: instanceStart, allDay }) })` — an update, never a `deleteEvent` call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/actions/calendar-events.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing `RecurrenceScopeDialog` tests**

```tsx
test("renders exactly three choices and calls onChoose with the matching scope", async () => {
  const onChoose = vi.fn();
  render(<RecurrenceScopeDialog onChoose={onChoose} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /this event/i }));
  expect(onChoose).toHaveBeenCalledWith("this");
});
```

- [ ] **Step 7: Run, verify fail, implement, run, verify pass**

Run: `npx vitest run tests/components/recurrence-scope-dialog.test.tsx`

- [ ] **Step 8: Wire into `EventEditor`**

When `mode === "edit"` and `initial.recurrence` is present or `initial.eventId`'s source event carries a `recurringEventId` (i.e., this is a recurring event — either a master or an instance), Save and Delete first render `<RecurrenceScopeDialog>` in place of immediately calling the action; the chosen scope is passed through to `updateEventAction`/`deleteEventAction`. A non-recurring event's Save/Delete call the actions directly as before (no dialog), preserving the existing non-recurring test suite unchanged. The Repeat field itself (`RepeatPicker`) is hidden/disabled whenever editing a *recurring instance* at all, until/unless the user picks "All events" or "This and following" from the dialog, matching the design doc's "Repeat field hidden/disabled in 'This event' mode, fully live in the other two."

- [ ] **Step 9: Manually verify in the browser**

Create a weekly recurring event via the app, then: edit "this event" only (confirm only one instance changes in Google Calendar's own UI); edit "all events" (confirm the whole series changes); edit "this and following" (confirm the series splits into two in Google Calendar's own UI, with the right event starting the new pattern).

- [ ] **Step 10: Commit**

```bash
git add lib/google-calendar.ts lib/actions/calendar-events.ts components/calendar/RecurrenceScopeDialog.tsx components/calendar/EventEditor.tsx tests/lib/google-calendar.test.ts tests/actions/calendar-events.test.ts tests/components/recurrence-scope-dialog.test.tsx
git commit -m "feat: add the this-event/all-events/this-and-following recurring event edit and delete scope"
```

---

## After Task 3

Run the full suite (`npm run test`) and `npm run build` once more, then follow superpowers:finishing-a-development-branch. This is the last part of the feature — after this lands, the whole design doc (`2026-10-22-calendar-event-task-creation-design.md`) is fully implemented.
