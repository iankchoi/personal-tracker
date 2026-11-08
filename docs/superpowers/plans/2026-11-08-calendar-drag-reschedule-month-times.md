# Calendar — Drag-to-Reschedule + Month View Time Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag an event or task to a new day (Month view) or a new day/time (Week/Day view) to reschedule it, and show a time label on Month view's timed-event chips so events read differently from tasks at a glance.

**Architecture:** Native HTML5 Drag and Drop (`draggable` + `dragstart`/`dragover`/`drop`), no new dependency. All date/time math for a drop lives in pure, independently-tested functions in a new `lib/calendar-drag.ts`; `MonthView`/`HourGrid` only wire DOM events to those functions and to `updateEventAction`/`updateTaskAction`, then `router.refresh()` — the same "call the server action, let fresh data re-render" convention `TaskCheckbox` already uses, so a dragged chip's DOM node doesn't actually move until the refreshed props place it in its new slot. The two Google-shape → action-input mapping functions `EventTaskModal.tsx` already has for its editors are extracted into a shared module first, so the drag handlers can reuse them instead of re-deriving the same `colorToken`/`guestEmails`/etc. unwrapping.

**Tech Stack:** Next.js 16 App Router (client components, server actions), Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-calendar-drag-reschedule-month-times-design.md`

## Global Constraints

- No new dependency — native HTML5 Drag and Drop only.
- Events never cross lanes via drag: an all-day event stays all-day (day changes only); a timed event stays timed (time and/or day changes only). Tasks *can* cross lanes (timed ⇄ all-day) since a task's `dueTime` is already nullable.
- No drag in Agenda view, no resize-by-drag, no recurrence-aware drag — recurrence (Part 3) isn't on `main` yet.
- Time-grid drop position snaps to the nearest 15 minutes, clamped to `[GRID_START_HOUR, GRID_END_HOUR)` from `lib/calendar-layout.ts`.
- A multi-day all-day event's span length must be preserved on drag — shift `start` and `end` by the identical day delta.
- `EventActionInput.end` for an all-day event is Google's raw **exclusive** end date (the same shape `event.end.date` already carries) — do not route it through `allDayEndToInclusive`/`allDayEndToExclusive`, which exist only for the editor's inclusive-date-picker UI.
- `updateEventAction`/`updateTaskAction` take the full action-input shape, not a partial patch — every drag handler must reconstruct the complete payload (via the extracted mapping helpers) and override only `start`/`end` or `dueDate`/`dueTime`.
- Mutations follow the existing convention: call the server action, then `router.refresh()`; no separate local optimistic-state tracking.

## Review Focus

- A multi-day all-day event dragged to a new day must keep its original span length, not collapse to one day or invert. Covered in Task 2.
- Dropping an item on the day/slot it already occupies must no-op (no action call, no error). Covered in Tasks 4 and 6.
- Starting a drag from a task's checkbox input must not happen — it would block toggling completion by mouse. Covered in Tasks 4 and 6.
- A failed `updateEventAction`/`updateTaskAction` call (the action throws) must leave the item visually in its original slot and show an inline error, not crash the view. Covered in Tasks 4 and 6.
- A time-grid drop above the first hour row or below the last must clamp into `[GRID_START_HOUR, GRID_END_HOUR)`, never produce a negative or out-of-window hour. Covered in Task 2.

---

## File Structure

**New files:**
- `lib/calendar-event-task-mapping.ts` — `googleEventToEditorInitial`/`calendarTaskToEditorInitial`, moved out of `EventTaskModal.tsx` unchanged, exported for reuse.
- `lib/calendar-drag.ts` — pure drop-target → date/time computation.
- `tests/lib/calendar-drag.test.ts`

**Modified files:**
- `components/calendar/EventTaskModal.tsx` — import the two mapping functions instead of defining them.
- `components/calendar/MonthView.tsx` — time label on timed-event chips; drag-and-drop wiring.
- `components/calendar/HourGrid.tsx` — drag-and-drop wiring for both the all-day row and the timed grid.
- `app/globals.css` — `.mg-chip-time`, drag-over hover classes, `[draggable="true"]` cursor, inline drag-error banner style.
- `tests/components/month-view.test.tsx`, `tests/components/hour-grid.test.tsx` — new files; neither component has a dedicated test file today (`MonthView`/`HourGrid` are currently only exercised incidentally inside `tests/components/calendar-view-colors.test.tsx` and `tests/components/day-detail-view.test.tsx`'s harnesses). Created in Task 3 and Task 5 respectively, extended by the tasks after.

---

### Task 1: Extract the Google-shape → action-input mapping helpers

**Files:**
- Create: `lib/calendar-event-task-mapping.ts`
- Modify: `components/calendar/EventTaskModal.tsx`
- Test: existing `EventTaskModal` tests must pass unchanged (no new test file — this is a pure extraction).

**Interfaces:**
- Produces: `googleEventToEditorInitial(event: GoogleCalendarEvent): Partial<EventActionInput> & { eventId: string; calendarId: string }`; `calendarTaskToEditorInitial(task: CalendarTaskItem): Partial<TaskActionInput> & { taskId: string; taskListId: string }` — same names, signatures, and bodies `EventTaskModal.tsx` already has.

- [ ] **Step 1: Move both functions, their doc comments, and their types verbatim into `lib/calendar-event-task-mapping.ts`**

Import `EventActionInput`/`TaskActionInput`/`GoogleCalendarEvent`/`CalendarTaskItem`/`allDayEndToInclusive`/`tokenForColorId` there instead of in `EventTaskModal.tsx`.

- [ ] **Step 2: Update `EventTaskModal.tsx` to import both functions from the new module and delete its own copies**

- [ ] **Step 3: Run the existing Calendar test suite**

Run: `npx vitest run tests/components/`
Expected: PASS, identical results to before the move (this step changes nothing observable).

- [ ] **Step 4: Commit**

```bash
git add lib/calendar-event-task-mapping.ts components/calendar/EventTaskModal.tsx
git commit -m "refactor: extract event/task editor-mapping helpers for reuse by drag-and-drop"
```

---

### Task 2: `lib/calendar-drag.ts` — pure drop-target math

**Files:**
- Create: `lib/calendar-drag.ts`
- Test: `tests/lib/calendar-drag.test.ts`

**Interfaces:**
- Consumes: `GRID_START_HOUR`, `GRID_END_HOUR`, `HOUR_ROW_HEIGHT` from `lib/calendar-layout.ts`; `eventStartDay`, `addDays`, `formatDateParam`, `parseZonedDateTime` from `lib/calendar-dates.ts`; `GoogleCalendarEvent` from `lib/google-calendar.ts`; `CalendarTaskItem` from `lib/calendar-tasks-for-grid.ts`.
- Produces: `shiftEventToDay(event: GoogleCalendarEvent, targetDay: Date): { start: string; end: string }`; `shiftTaskToDay(task: CalendarTaskItem, targetDay: Date): { dueDate: string }`; `hourFromDropOffset(offsetY: number): number` (a quarter-hour-granular value, e.g. `9.25`); `moveEventToSlot(event: GoogleCalendarEvent, targetDay: Date, targetHour: number): { start: string; end: string }`; `moveTaskToSlot(task: CalendarTaskItem, targetDay: Date, targetHour: number | null): { dueDate: string; dueTime: string | null }`.

- [ ] **Step 1: Write the failing tests for `shiftEventToDay`**

```ts
test("shifts a timed event's start/end to a new day, keeping time-of-day and duration", () => {
  const event = timedEvent({ start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:30:00-04:00" });
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({
    start: "2026-10-25T09:00:00-04:00",
    end: "2026-10-25T10:30:00-04:00",
  });
});

test("shifts a single-day all-day event's exclusive end along with its start", () => {
  const event = allDayEvent({ start: "2026-10-20", end: "2026-10-21" }); // Google's exclusive end
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({ start: "2026-10-25", end: "2026-10-26" });
});

test("preserves a multi-day all-day event's span length", () => {
  const event = allDayEvent({ start: "2026-10-20", end: "2026-10-23" }); // 3-day span, exclusive end
  expect(shiftEventToDay(event, new Date(2026, 9, 25))).toEqual({ start: "2026-10-25", end: "2026-10-28" });
});
```

- [ ] **Step 2: Run, verify fail, implement `shiftEventToDay`, run, verify pass**

Run: `npx vitest run tests/lib/calendar-drag.test.ts -t "shift"`. Compute the day delta between `eventStartDay(event)` and `targetDay` with plain calendar-date subtraction (not ms-based — these are local midnight `Date`s already, see `isSameLocalDay`'s sibling helpers for the pattern). For a timed event, parse `start`/`end` via `parseZonedDateTime`, replace only the year/month/day with the shifted day's, and keep the original hour/minute/second and UTC offset string exactly — do not use millisecond arithmetic, which would misfire across a DST boundary. For an all-day event, apply `addDays` to `start.date`/`end.date` (parsed as plain calendar dates) by the same delta and re-format with `formatDateParam`; `end.date` is Google's raw exclusive end — shift it as-is, with no inclusive/exclusive conversion.

- [ ] **Step 3: Write the failing test for `shiftTaskToDay`**

```ts
test("changes dueDate only, leaving dueTime untouched", () => {
  const task = calendarTask({ dueDate: "2026-10-20", dueTime: "14:30" });
  expect(shiftTaskToDay(task, new Date(2026, 9, 25))).toEqual({ dueDate: "2026-10-25" });
});
```

- [ ] **Step 4: Run, verify fail, implement, run, verify pass**

- [ ] **Step 5: Write the failing tests for `hourFromDropOffset`**

```ts
test("snaps to the nearest quarter hour", () => {
  expect(hourFromDropOffset(2 * HOUR_ROW_HEIGHT + 20)).toBeCloseTo(GRID_START_HOUR + 2.25);
});
test("clamps a negative offset (dropped above the grid) to the grid's start hour", () => {
  expect(hourFromDropOffset(-50)).toBe(GRID_START_HOUR);
});
test("clamps an offset past the grid's bottom to its last quarter-hour slot", () => {
  expect(hourFromDropOffset(999999)).toBe(GRID_END_HOUR - 0.25);
});
```

- [ ] **Step 6: Run, verify fail, implement, run, verify pass**

`hour = GRID_START_HOUR + round((offsetY / HOUR_ROW_HEIGHT) * 4) / 4`, then clamp to `[GRID_START_HOUR, GRID_END_HOUR - 0.25]`.

- [ ] **Step 7: Write the failing tests for `moveEventToSlot` and `moveTaskToSlot`**

```ts
test("moveEventToSlot sets a new start at the target day/hour and preserves the original duration", () => {
  const event = timedEvent({ start: "2026-10-20T09:00:00-04:00", end: "2026-10-20T10:30:00-04:00" }); // 90 min
  const result = moveEventToSlot(event, new Date(2026, 9, 25), 14.5); // 2:30 PM
  expect(new Date(result.start).getHours()).toBe(14);
  expect(new Date(result.start).getMinutes()).toBe(30);
  expect(new Date(result.end).getTime() - new Date(result.start).getTime()).toBe(90 * 60 * 1000);
});

test("moveTaskToSlot with a target hour sets dueDate and a quarter-hour dueTime", () => {
  expect(moveTaskToSlot(calendarTask({}), new Date(2026, 9, 25), 14.25)).toEqual({
    dueDate: "2026-10-25",
    dueTime: "14:15",
  });
});

test("moveTaskToSlot with a null target hour clears dueTime (dropped into the all-day row)", () => {
  expect(moveTaskToSlot(calendarTask({ dueTime: "09:00" }), new Date(2026, 9, 25), null)).toEqual({
    dueDate: "2026-10-25",
    dueTime: null,
  });
});
```

- [ ] **Step 8: Run, verify fail, implement, run, verify pass**

`moveEventToSlot` builds a new local `Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), hour, minute)` the same way `QuickCreatePopup`'s `combineDateTime` already does for a freshly-picked date+time, adds the original event's duration (`end - start` in ms) for the new end, and returns both as ISO strings. `moveTaskToSlot` formats `targetHour` to an `"HH:MM"` string the same way, or `null` through untouched.

- [ ] **Step 9: Commit**

```bash
git add lib/calendar-drag.ts tests/lib/calendar-drag.test.ts
git commit -m "feat: add pure drop-target date/time math for calendar drag-and-drop"
```

---

### Task 3: Month view — time label on timed-event chips

**Files:**
- Modify: `components/calendar/MonthView.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/month-view.test.tsx` (create — first dedicated test file for `MonthView`; give it its own `Harness`/fixtures the way `tests/components/day-detail-view.test.tsx` does, rather than reaching into `calendar-view-colors.test.tsx`)

**Interfaces:**
- Consumes: `formatTimeLabel(isoDateTime: string): string` from `lib/calendar-dates.ts` (already used by `AgendaView`/`DayDetailView`).

- [ ] **Step 1: Write the failing test**

```tsx
test("a timed event's month chip shows its start time before the title", () => {
  render(<MonthView ... events={[timedEvent({ id: "e1", summary: "Standup", start: "...T09:00:00-04:00" })]} ... />);
  expect(screen.getByText("9:00 AM")).toBeInTheDocument();
  expect(screen.getByText("Standup")).toBeInTheDocument();
});

test("an all-day event's month chip has no time label", () => {
  render(<MonthView ... events={[allDayEvent({ id: "e1", summary: "Holiday" })]} ... />);
  expect(screen.queryByText(/\d{1,2}:\d{2} (AM|PM)/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/components/month-view.test.tsx -t "time"`

- [ ] **Step 3: Add the time label**

In the `.mg-chip` span (the event branch of `visibleEntries.map`), when `entry.event.start.dateTime` is set, render `<span className="mg-chip-time">{formatTimeLabel(entry.event.start.dateTime)}</span>` immediately before the existing summary text; render nothing extra for an all-day event. Add `.mg-chip-time { opacity: .75; margin-right: 4px; }` to `app/globals.css` near the existing `.mg-chip` rules.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/calendar/MonthView.tsx app/globals.css tests/components/month-view.test.tsx
git commit -m "feat: show a timed event's start time on its Month view chip"
```

---

### Task 4: Month view — drag-to-reschedule

**Files:**
- Modify: `components/calendar/MonthView.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/month-view.test.tsx` (extend)

**Interfaces:**
- Consumes: `shiftEventToDay`, `shiftTaskToDay` from `lib/calendar-drag.ts`; `googleEventToEditorInitial`, `calendarTaskToEditorInitial` from `lib/calendar-event-task-mapping.ts`; `updateEventAction` from `lib/actions/calendar-events.ts`; `updateTaskAction` from `lib/actions/calendar-tasks.ts`; `useRouter` from `next/navigation`.

- [ ] **Step 1: Write the failing tests**

```tsx
test("dragging an event chip onto a different day cell calls updateEventAction with that day's date and refreshes", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "...-10-20T09:00:00-04:00" })]} />);
  fireDrop(screen.getByText("Standup"), cellForDay(25));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(expect.objectContaining({ eventId: "e1", start: expect.stringContaining("10-25") }));
  expect(mockRefresh).toHaveBeenCalled();
});

test("dropping an item back on its own day cell is a no-op", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "...-10-20T09:00:00-04:00" })]} />);
  fireDrop(screen.getByText("Standup"), cellForDay(20));
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging a task's checkbox does not start a drag", () => {
  render(<Harness tasks={[calendarTask({ id: "t1" })]} />);
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox.closest("[draggable='true']")).toBeNull();
});

test("a failed drop shows an inline error and leaves the event where it was", async () => {
  mockUpdateEventAction.mockRejectedValueOnce(new Error("boom"));
  render(<Harness events={[timedEvent({ id: "e1", start: "...-10-20T09:00:00-04:00" })]} />);
  fireDrop(screen.getByText("Standup"), cellForDay(25));
  await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t reschedule/i));
  expect(screen.getByText("Standup")).toBeInTheDocument(); // still rendered from unchanged props
});
```

Add a small `fireDrop(source, target)` test helper at the top of the file that dispatches `dragstart` on `source`, then `dragover` and `drop` on `target` — the minimal native-DnD event sequence jsdom needs to exercise real handlers (not a library's synthetic helper, since there's no DnD library here).

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/components/month-view.test.tsx -t "drag"`

- [ ] **Step 3: Implement drag-and-drop on `MonthView`**

Add `"use client"`-scoped state `dragError: string | null` and a drag payload ref/state identifying what's being dragged (`{ kind: "event"; event } | { kind: "task"; task }`). Make the event chip `<span>` and the task's wrapping element `draggable`, guarding the task case so starting a drag from the checkbox `<input>` itself is prevented (check `event.target` in `onDragStart`, or simply put `draggable` on a wrapper that excludes the `<input>` from its own drag region). On a cell's `onDrop`, call `shiftEventToDay`/`shiftTaskToDay`, merge the result into `googleEventToEditorInitial(event)`/`calendarTaskToEditorInitial(task)`, call `updateEventAction`/`updateTaskAction`, then `router.refresh()`; skip the call entirely when the target day equals the item's current day (`isSameLocalDay`). On failure, set `dragError` to a short message and render it as a dismissible `role="alert"` banner at the top of `.month-grid`. Add `.mg-cell.drag-over { background: var(--active); }` (toggled via `onDragEnter`/`onDragLeave`) and a `[draggable="true"] { cursor: grab; }` rule to `app/globals.css`.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/calendar/MonthView.tsx app/globals.css tests/components/month-view.test.tsx
git commit -m "feat: drag an event or task to a new day in Month view to reschedule it"
```

---

### Task 5: HourGrid — drag-to-reschedule in the all-day row

**Files:**
- Modify: `components/calendar/HourGrid.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/hour-grid.test.tsx` (create — first dedicated test file for `HourGrid`; same rationale as Task 3's `month-view.test.tsx`)

**Interfaces:**
- Consumes: same as Task 4, plus this task's drag payload can additionally be an all-day event.

- [ ] **Step 1: Write the failing tests**

```tsx
test("dragging an all-day event chip to a different day column reschedules it and preserves a multi-day span", async () => {
  render(<Harness days={sevenDays} events={[allDayEvent({ id: "e1", start: "2026-10-20", end: "2026-10-22" })]} />);
  fireDrop(screen.getByText("Conference"), alldayCellForDay(25));
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e1", start: "2026-10-25", end: "2026-10-27" }),
  ));
});

test("dragging an all-day task onto a day column changes its dueDate only", async () => {
  render(<Harness days={sevenDays} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDrop(screen.getByText("Errand"), alldayCellForDay(25));
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "t1", dueDate: "2026-10-25", dueTime: null }),
  ));
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement drag-and-drop on `.wg-allday`**

Same pattern as Task 4: make `.wg-chip`/all-day `TaskCheckbox` wrapper draggable, wire `onDrop` on each day's `.wg-allday` div to `shiftEventToDay`/`shiftTaskToDay`, skip the no-op same-day case, surface failures the same way (a shared `dragError` state at the `HourGrid` level, rendered once above the grid). Track "what's being dragged" (`{ kind: "event"; event } | { kind: "task"; task }`) as `HourGrid`-level state too, not local to the all-day row — Task 6 reuses it so a task can be dropped into either lane regardless of which one it was picked up from. Give the all-day row a `data-testid="wg-allday"` for the drop-target queries in both this task's and Task 6's tests.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/calendar/HourGrid.tsx app/globals.css tests/components/hour-grid.test.tsx
git commit -m "feat: drag an all-day event or task to a new day in Week/Day view"
```

---

### Task 6: HourGrid — drag-to-reschedule in the timed grid

**Files:**
- Modify: `components/calendar/HourGrid.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/hour-grid.test.tsx` (extend)

**Interfaces:**
- Consumes: `hourFromDropOffset`, `moveEventToSlot`, `moveTaskToSlot` from `lib/calendar-drag.ts`.

- [ ] **Step 1: Write the failing tests**

```tsx
test("dragging a timed event within its own day column to a new time changes start/end, preserving duration", async () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1", start: "...T09:00:00-04:00", end: "...T10:00:00-04:00" })]} />);
  fireDropAt(screen.getByText("Standup"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT }); // -> 2 PM
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(new Date(call.start).getHours()).toBe(14);
  expect(new Date(call.end).getTime() - new Date(call.start).getTime()).toBe(60 * 60 * 1000);
});

test("dragging a timed task to a new time sets a quarter-hour dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", dueTime: "09:00" })]} />);
  fireDropAt(screen.getByText("Follow up"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT });
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dueTime: "14:00" })));
});

test("dropping a timed event into the all-day row is not a valid target (events don't cross lanes)", () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDrop(screen.getByText("Standup"), alldayRow);
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
});

test("dragging an all-day task into the timed grid picks up a dueTime at the drop position", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: null })]} />);
  fireDropAt(screen.getByText("Errand"), dayColumn(), { offsetY: 7 * HOUR_ROW_HEIGHT }); // -> 2 PM
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "t1", dueTime: "14:00" }),
  ));
});

test("dragging a timed task into the all-day row clears its dueTime", async () => {
  render(<Harness days={[oneDay]} tasks={[calendarTask({ id: "t1", dueDate: "2026-10-20", dueTime: "09:00" })]} />);
  const alldayRow = screen.getByTestId("wg-allday");
  fireDrop(screen.getByText("Follow up"), alldayRow);
  await vi.waitFor(() => expect(mockUpdateTaskAction).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "t1", dueTime: null }),
  ));
});
```

Extend the `fireDrop` helper (or add `fireDropAt`) to stub the target's `getBoundingClientRect()` so `offsetY` is derived deterministically in jsdom, which doesn't lay out real pixels.

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement drag-and-drop on the timed grid's `.wg-col`, sharing drag state with the all-day row**

Make each timed `.wg-event`/timed task block draggable (guarding the checkbox the same way as Task 4/5). The "what's being dragged" state lives once at the `HourGrid` level (not per-row), so a task chip dragged from either the all-day row (Task 5) or the timed grid can be dropped on either — a task is never pinned to the lane it started in. On a `.wg-col`'s `onDrop`, compute `offsetY` from the drop event's clientY minus the column's own `getBoundingClientRect().top`, pass through `hourFromDropOffset`, then `moveEventToSlot` for an event payload or `moveTaskToSlot` for a task payload with that day/hour; reject (no-op) an event-kind payload dropped on `.wg-allday` — only a task payload is valid there, and dropping one calls `moveTaskToSlot` with `targetHour: null`. Merge the result into the full action input the same way as Task 4, call the action, `router.refresh()`, and reuse the same `dragError` banner Task 5 added.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Run the full suite, tsc, and build**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/calendar/HourGrid.tsx app/globals.css tests/components/hour-grid.test.tsx
git commit -m "feat: drag a timed event or task to a new day/time in Week/Day view"
```
