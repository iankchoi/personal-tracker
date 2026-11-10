# Calendar — Pointer-Based Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native HTML5 Drag and Drop's event triggers (`draggable`/`dragstart`/`dragover`/`drop`/`dragend`) with Pointer Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`) across Month view and Week/Day view's hour grid, so the existing drag-to-reschedule feature's visual feedback (the 15-minute snap indicator, the drag-over highlight) renders reliably in Safari — where native-drag paint timing is unreliable — while every piece of reschedule business logic stays exactly as it is.

**Architecture:** A new shared `usePointerDrag` hook owns the pointer mechanics (capture, movement-threshold click-vs-drag disambiguation) and is the only thing both `MonthView.tsx` and `HourGrid.tsx` call into for starting/continuing/ending a drag. Hit-testing — "which day cell, which hour, is the pointer over right now" — reads a new `data-day` attribute via `document.elementFromPoint`, replacing the drop-target `onDrop`/`onDragOver` handlers' role. The existing `dragPayload`/`dragOverKey`/`dragPreviewHour`/`dragError` state and the `handleDrop`/`handleAllDayDrop`/`handleTimedDrop` business-logic functions in both components are kept as-is; only what calls them changes.

**Tech Stack:** Next.js 16 App Router (client components), Vitest + Testing Library, native Pointer Events API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-calendar-pointer-based-drag-design.md`

## Global Constraints

- No new dependency — Pointer Events only.
- `document.elementFromPoint`, `Element.prototype.setPointerCapture`, `Element.prototype.releasePointerCapture` are not implemented in jsdom (confirmed) — tests stub them (a global stub for the capture methods in `tests/setup.ts`, a per-test stub for `elementFromPoint` returning whatever element the test needs "hit"). Production code calls all three unconditionally.
- A 4px movement threshold distinguishes a drag from a click. Below it, pointerup invokes the click-equivalent action; at or above it, pointerup commits the reschedule. No draggable element keeps a native `onClick` handler once converted — the pointer handlers call the click-equivalent action directly, since a native `click` after a real drag's `pointerup` can't be reliably suppressed.
- Hit-testing reads `data-day="YYYY-MM-DD"` (new attribute on `.mg-cell`/`.wg-allday`/`.wg-col`) via `elementFromPoint(x, y).closest("[data-day]")`; `lib/calendar-dates.ts` gains a `parseDateParam` export as `formatDateParam`'s inverse.
- Every existing `lib/calendar-drag.ts` export, and every existing business-logic function in `MonthView.tsx`/`HourGrid.tsx` (`handleDrop`, `handleAllDayDrop`, `handleTimedDrop`), keeps its current signature and behavior unchanged.

## Review Focus

- A plain click on an event/task chip (no pointer movement) must still open its editor / toggle its checkbox — not be swallowed as a zero-distance drag. Covered in Tasks 3 and 5.
- Dragging a task's checkbox input specifically must still not start a drag (the same constraint the native-DnD version had). Covered in Task 5.
- `pointercancel` (the drag is interrupted, e.g. by the OS) must leave the dragged item unchanged — no partial/stuck state, no reschedule call. Covered in Task 1.
- Releasing the pointer over a non-drop-target area (outside any `.mg-cell`/`.wg-allday`/`.wg-col`) must not throw and must not reschedule anything. Covered in Tasks 3 and 4.
- The existing clobber-field masking, grab-day anchoring, and lane-crossing no-ops (all already covered by the native-DnD test suite) must still pass once their trigger is pointer-based — the rewritten tests for Tasks 3 and 4 carry these forward, not just the new pointer-specific behavior.

---

## File Structure

**New files:**
- `components/calendar/usePointerDrag.ts` — the shared pointer-mechanics hook
- `tests/components/use-pointer-drag.test.tsx`

**Modified files:**
- `lib/calendar-dates.ts` — add `parseDateParam`
- `tests/lib/calendar-dates.test.ts` (or wherever its tests live — extend)
- `components/calendar/MonthView.tsx` — swap native DnD for `usePointerDrag` + hit-testing; add `data-day` to `.mg-cell`
- `components/calendar/HourGrid.tsx` — same, for `.wg-allday`/`.wg-col`; keep `dragOverKey`/`dragPreviewHour`/`.wg-drop-indicator` rendering as-is
- `components/calendar/TaskCheckbox.tsx` — replace `draggable`/`onDragStart`/`onDragEnd` props with the pointer-handler props `usePointerDrag` returns
- `app/globals.css` — remove native-DnD-only rules (`[draggable="true"]`'s `-webkit-user-drag`/`cursor: grab` — replaced by a `.pointer-draggable { cursor: grab; }` class applied directly, since there's no `draggable` attribute left to select on)
- `tests/components/month-view.test.tsx`, `tests/components/hour-grid.test.tsx` — rewritten to drive pointer events instead of drag events; existing assertions about business logic (clobber masking, grab-day anchoring, lane-crossing no-ops) are carried forward unchanged in what they assert, only in how the interaction is simulated

---

### Task 1: `usePointerDrag` — the shared pointer-mechanics hook

**Files:**
- Create: `components/calendar/usePointerDrag.ts`
- Create: `tests/components/use-pointer-drag.test.tsx`

**Interfaces:**
- Produces: `usePointerDrag(options: { onClick(): void; onMove(clientX: number, clientY: number): void; onDrop(clientX: number, clientY: number): void; threshold?: number }): { isDragging: boolean; onPointerDown(event: React.PointerEvent): void; onPointerMove(event: React.PointerEvent): void; onPointerUp(event: React.PointerEvent): void; onPointerCancel(event: React.PointerEvent): void }`

- [ ] **Step 1: Write the failing tests**

Build a tiny test component rendering a single `<div>` with the hook's returned handlers spread onto it, plus `onClick`/`onMove`/`onDrop` as `vi.fn()`s passed into the hook.

```tsx
test("a pointerdown+pointerup with no movement calls onClick, not onDrop", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onDrop).not.toHaveBeenCalled();
});

test("movement past the threshold calls onMove during the drag and onDrop (not onClick) on release", () => {
  const onClick = vi.fn();
  const onMove = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={onMove} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 112, pointerId: 1 }); // 12px, past the 4px default
  fireEvent.pointerUp(el, { clientX: 100, clientY: 112, pointerId: 1 });
  expect(onMove).toHaveBeenCalledWith(100, 112);
  expect(onDrop).toHaveBeenCalledWith(100, 112);
  expect(onClick).not.toHaveBeenCalled();
});

test("movement under the threshold does not count as a drag", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 101, clientY: 101, pointerId: 1 }); // ~1.4px
  fireEvent.pointerUp(el, { clientX: 101, clientY: 101, pointerId: 1 });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onDrop).not.toHaveBeenCalled();
});

test("pointercancel aborts without calling onDrop or onClick", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 112, pointerId: 1 });
  fireEvent(el, new Event("pointercancel", { bubbles: true, cancelable: true }));
  fireEvent.pointerUp(el, { clientX: 100, clientY: 112, pointerId: 1 }); // stray late pointerup after cancel
  expect(onClick).not.toHaveBeenCalled();
  expect(onDrop).not.toHaveBeenCalled();
});
```

`Harness` destructures `const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = usePointerDrag({ onClick, onMove, onDrop })` and spreads those four handlers (not `isDragging`, which isn't a DOM prop) onto `<div data-testid="target">`. `jsdom` has a real `PointerEvent` constructor (confirmed), so `fireEvent.pointerDown`/`pointerMove`/`pointerUp` work directly; `pointercancel` isn't in `@testing-library/dom`'s event map, so build it by hand the same way this plan's predecessor PR built `dragstart`/`dragover`/`drop` events it didn't have a shorthand for.

Add a global stub to `tests/setup.ts` (guarded for files that don't load `jsdom` — most of this repo's lib tests run in Node, where `Element` doesn't exist):

```ts
if (typeof Element !== "undefined") {
  Element.prototype.setPointerCapture ??= function () {};
  Element.prototype.releasePointerCapture ??= function () {};
}
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/components/use-pointer-drag.test.tsx`
Expected: FAIL — `usePointerDrag` doesn't exist yet.

- [ ] **Step 3: Implement `usePointerDrag`**

On `pointerdown`: call `event.currentTarget.setPointerCapture(event.pointerId)`, record `{x: event.clientX, y: event.clientY}` in a ref (not state — this is read-and-compared on every move, not rendered). On `pointermove`: compute `Math.hypot(dx, dy)` against the recorded start; once it first reaches `threshold` (default 4), flip an internal "is dragging" ref to true and call `setIsDragging(true)` (exactly once — guard the state update so a long drag doesn't re-render on every pixel); call `options.onMove(event.clientX, event.clientY)` on every move from that point on (and on the one move that crosses the threshold). On `pointerup`: if the internal ref says dragging, call `options.onDrop(event.clientX, event.clientY)`; otherwise call `options.onClick()`; then reset the ref, `setIsDragging(false)`, and `event.currentTarget.releasePointerCapture(event.pointerId)`. On `pointercancel`: reset the ref and `setIsDragging(false)` without calling either callback.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/calendar/usePointerDrag.ts tests/components/use-pointer-drag.test.tsx tests/setup.ts
git commit -m "feat: add usePointerDrag, the shared pointer-event drag mechanics hook"
```

---

### Task 2: `parseDateParam` — hit-testing's date parser

**Files:**
- Modify: `lib/calendar-dates.ts`
- Test: `tests/lib/calendar-dates.test.ts` (extend — find its current location/filename first; create alongside the existing date-utility tests if none exists yet for this file)

**Interfaces:**
- Produces: `parseDateParam(dateParam: string): Date` — the inverse of `formatDateParam`; `parseDateParam(formatDateParam(d))` round-trips to the same calendar day for any plain local-midnight `Date`.

- [ ] **Step 1: Write the failing test**

```ts
test("parseDateParam is formatDateParam's inverse", () => {
  expect(parseDateParam("2026-10-25")).toEqual(new Date(2026, 9, 25));
});
test("parseDateParam round-trips through formatDateParam", () => {
  const day = new Date(2026, 9, 25);
  expect(parseDateParam(formatDateParam(day))).toEqual(day);
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

`const [year, month, day] = dateParam.split("-").map(Number); return new Date(year, month - 1, day);` — the same pattern `lib/calendar-drag.ts`'s `shiftDateString` already uses inline; this is that same logic, exported for hit-testing to reuse.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add lib/calendar-dates.ts tests/lib/calendar-dates.test.ts
git commit -m "feat: add parseDateParam, formatDateParam's inverse, for pointer-drag hit-testing"
```

---

### Task 3: Month view — pointer-based drag

**Files:**
- Modify: `components/calendar/MonthView.tsx`
- Modify: `app/globals.css`
- Modify: `components/calendar/TaskCheckbox.tsx`
- Test: `tests/components/month-view.test.tsx` (rewrite the drag-triggering tests; leave the non-drag tests — time labels — untouched)

**Interfaces:**
- Consumes: `usePointerDrag` from `./usePointerDrag`; `parseDateParam` from `@/lib/calendar-dates`.

- [ ] **Step 1: Write the failing tests**

Replace `fireDrop`/the `fakeDataTransfer` helper with pointer-event equivalents:

```tsx
function fireDragTo(source: HTMLElement, hitDataDay: string) {
  const target = document.createElement("div");
  target.dataset.day = hitDataDay;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => target;
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(source, { clientX: 20, clientY: 20, pointerId: 1 }); // past the 4px threshold
  fireEvent.pointerUp(source, { clientX: 20, clientY: 20, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
}

test("dragging an event chip onto a different day cell calls updateEventAction with that day's date and refreshes", async () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  fireDragTo(screen.getByText("Standup"), "2026-10-25");
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e1", start: expect.stringContaining("10-25") }),
  );
  expect(mockRefresh).toHaveBeenCalled();
});

test("clicking an event chip without moving the pointer opens its editor, not a reschedule", () => {
  render(<Harness events={[timedEvent({ id: "e1", start: "2026-10-20T09:00:00-04:00" })]} />);
  const chip = screen.getByText("Standup");
  fireEvent.pointerDown(chip, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(chip, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(mockUpdateEventAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument(); // the event editor opened
});
```

Carry forward (rewritten to use `fireDragTo`/pointer events instead of `fireDrop`) every existing scenario this file already covers: the same-day no-op, the clobber-fields-not-resent assertion, the multi-day grab-day nudge, the multi-day same-cell no-op, and the failed-drop error banner. Each keeps its existing assertions — only the simulated interaction changes.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/components/month-view.test.tsx`

- [ ] **Step 3: Rewire `MonthView.tsx` onto `usePointerDrag`**

Add `data-day={formatDateParam(day)}` to each `.mg-cell`. Replace the event chip's `draggable`/`onDragStart`/`onDragEnd`/`onClick` with the object `usePointerDrag` returns, where `onClick` is the existing `openEditEvent(entry.event)` call, `onMove` is a no-op (Month view has no sub-cell indicator to update — only `handleDrop`'s existing day-level highlight, which can still be driven here by setting `dragOverDay` from the hit-tested day), and `onDrop` calls the existing `handleDrop` business logic with the hit-tested day (via `document.elementFromPoint(clientX, clientY)?.closest("[data-day]")`, parsed with `parseDateParam`). Do the same for the task entry, threading the new pointer props through to `TaskCheckbox` (Task 3's own sub-step below) in place of the old `draggable`/`onDragStart`/`onDragEnd`. Remove the cell's own `onDragEnter`/`onDragLeave`/`onDragOver`/`onDrop` handlers entirely — there's nothing left to drop onto natively; the cell's role now is purely to carry `data-day` for hit-testing and to render the `.drag-over` class when `dragOverDay` (set from `onMove`) matches it.

- [ ] **Step 3b: Update `TaskCheckbox.tsx`'s drag props**

Replace `draggable?: boolean; onDragStart?(event): void; onDragEnd?(event): void;` with `dragHandlers?: ReturnType<typeof usePointerDrag>` (or the equivalent spread shape), applied to the same `.task-title` span as before (still never the checkbox `<input>`). `AgendaView`'s own usage (no drag props passed) is unaffected.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add components/calendar/MonthView.tsx components/calendar/TaskCheckbox.tsx app/globals.css tests/components/month-view.test.tsx
git commit -m "feat: drive Month view's drag-to-reschedule with Pointer Events instead of native HTML5 DnD"
```

---

### Task 4: HourGrid — pointer-based drag (all-day row + timed grid)

**Files:**
- Modify: `components/calendar/HourGrid.tsx`
- Test: `tests/components/hour-grid.test.tsx` (rewrite the drag-triggering tests and helpers; carry forward every existing assertion — clobber masking, grab-day anchoring, lane-crossing no-ops, the quarter-hour snap indicator, the task all-day-row no-op — simulated via pointer events instead of drag events)

**Interfaces:**
- Consumes: same as Task 3, plus `hourFromDropOffset` (already imported) for the timed grid's sub-cell snap.

- [ ] **Step 1: Write the failing tests**

Replace `fireDrop`/`fireDropAt`/`dragOverAt`/`fakeDataTransfer` with pointer-event equivalents built the same way as Task 3's `fireDragTo`, plus a variant that also stubs the hit-tested element's `getBoundingClientRect()` (for the timed grid's offsetY-based hour snap, same technique the native-DnD version already used — only the triggering events change, not this part).

```tsx
test("dragging a timed event within its own day column to a new time changes start/end, preserving duration and the event's own offset", async () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => column;
  const source = screen.getByText("Standup");
  fireEvent.pointerDown(source, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 }); // -> 2 PM
  fireEvent.pointerUp(source, { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  const call = mockUpdateEventAction.mock.calls[0][0];
  expect(call.start).toBe("2026-10-20T14:00:00-04:00");
  expect(call.end).toBe("2026-10-20T15:00:00-04:00");
});

test("dragging over the timed grid shows a drop indicator snapped to the nearest quarter hour", () => {
  render(<Harness days={[oneDay]} events={[timedEvent({ id: "e1" })]} />);
  const column = dayColumn();
  column.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => column;
  fireEvent.pointerDown(screen.getByText("Standup"), { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(screen.getByText("Standup"), { clientX: 0, clientY: 7 * HOUR_ROW_HEIGHT + 20, pointerId: 1 });
  document.elementFromPoint = originalElementFromPoint;
  const indicator = column.querySelector(".wg-drop-indicator") as HTMLElement;
  expect(indicator).not.toBeNull();
  expect(indicator.style.top).toBe(`${7.25 * HOUR_ROW_HEIGHT}px`);
});
```

Carry forward every other existing `hour-grid.test.tsx` scenario (there are ~15 after the native-DnD and flicker-fix work) rewritten the same way: the all-day-row multi-day grab-day nudge, the all-day task no-op, the cross-lane task moves in both directions, the event lane-crossing no-ops in both directions, the clobber-fields assertions for both the all-day and timed paths, and the pointercancel-equivalent cleanup (now exercised via `usePointerDrag`'s own Task-1 tests, not re-tested here — this file's job is the hit-testing/business-logic wiring, not the pointer mechanics themselves).

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Rewire `HourGrid.tsx` onto `usePointerDrag`**

Add `data-day={formatDateParam(day)}` to `.wg-allday` and `.wg-col`. Each draggable element (all-day event chip, all-day `TaskCheckbox`, timed event block, timed task block) gets its `draggable`/`onDragStart`/`onDragEnd` replaced with `usePointerDrag`'s returned props, with `onClick` wired to the existing `openEditEvent`/`openEditTask` calls. `onMove` hit-tests via `document.elementFromPoint(clientX, clientY)?.closest("[data-day]")`: reading `data-day` gives the target day; checking whether the hit element (or its closest `[data-day]`) has the `wg-allday` vs `wg-col` class decides the lane, and for `wg-col` specifically, `clientY - hitElement.getBoundingClientRect().top` feeds `hourFromDropOffset` exactly as the native-DnD `onDragOver` used to — this is the same math, just computed from a hit-tested element instead of `event.currentTarget`. Sets `dragOverKey`/`dragPreviewHour` exactly as before. `onDrop` calls the existing `handleAllDayDrop`/`handleTimedDrop` with the hit-tested day (and offsetY, for the timed case) in place of what the native `onDrop` handler used to compute from its own event. Remove every `onDragOver`/`onDrop` handler from `.wg-allday`/`.wg-col` themselves — they're pure hit-test targets now, not drop targets with their own handlers.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Run the full suite, tsc, eslint, and build**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build`
Expected: all pass. (This plan's predecessor skipped `next build` before its own final review and that review flagged it — don't repeat that.)

- [ ] **Step 6: Commit**

```bash
git add components/calendar/HourGrid.tsx tests/components/hour-grid.test.tsx
git commit -m "feat: drive Week/Day view's drag-to-reschedule with Pointer Events instead of native HTML5 DnD"
```

---

### Task 5: Remove native-DnD remnants

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

No new test — this is cleanup of CSS Tasks 3/4 already made unreachable (the `draggable` attribute no longer exists anywhere in the codebase after Tasks 3/4, so `[draggable="true"]` selectors now match nothing). Verification is `grep -rn "draggable" components/` returning no production-code hits, and the existing Month/HourGrid test suites (already green from Tasks 3/4) staying green.

- [ ] **Step 2: Remove `[draggable="true"] { cursor: grab; -webkit-user-drag: element; }` from `app/globals.css`**

Add `.pointer-draggable { cursor: grab; }` in its place, and apply that class (alongside each element's existing classes) to every element `usePointerDrag`'s handlers are spread onto in `MonthView.tsx`/`HourGrid.tsx`/`TaskCheckbox.tsx` — the `cursor: grab` affordance Task 4 of the native-DnD plan added, now keyed off a real class instead of an attribute that no longer exists.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all pass, unchanged count from Task 4's final run.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/calendar/MonthView.tsx components/calendar/HourGrid.tsx components/calendar/TaskCheckbox.tsx
git commit -m "chore: remove native-DnD CSS remnants now that drag is pointer-based"
```
