# Calendar — Pointer-Based Drag-and-Drop (Replacing Native HTML5 DnD) Design

**Intent:** Replace the native HTML5 Drag and Drop event triggers (`draggable`, `dragstart`/`dragover`/`drop`/`dragend`) built in this same PR's earlier commits with `pointerdown`/`pointermove`/`pointerup`/`pointercancel` — not because the business logic or visual design was wrong, but because the user found live, in Safari, that the 15-minute snap indicator this feature depends on never appeared, while the native drag itself (lift/fade/follow) worked fine. The diagnosis: Safari is documented to defer or throttle page repaints while an OS-level native drag gesture is active, since cursor/ghost rendering is handed off to the OS during that window — a platform rendering behavior, not something fixable from inside the native DnD event handlers themselves. Three narrower attempts (removing a `dragenter`/`dragleave` dependency, adding `-webkit-user-drag`) did not resolve it. Pointer Events are regular DOM events with ordinary paint timing — no OS handoff — so JS-driven visual feedback during the drag repaints normally in every browser, Safari included.

This is **not** a redesign of what the feature does. Every existing piece of business logic from the native-DnD implementation is reused unchanged:
- `shiftEventToDay`, `moveEventToSlot`, `moveTaskToSlot`, `hourFromDropOffset`, `withoutEventClobberFields` (`lib/calendar-drag.ts`)
- The lane-crossing rules, grab-day anchoring for multi-day events, and clobber-field masking
- The `dragOverKey`/`dragPreviewHour`/`.drag-over`/`.wg-drop-indicator` visual-feedback state and rendering already built in `MonthView.tsx`/`HourGrid.tsx`

Only the **trigger mechanism** changes: what starts a drag, what updates it, and what ends it.

## Goals

- Dragging an event or task (Month view's day cells, Week/Day view's all-day row and timed grid) works via Pointer Events, not native HTML5 DnD.
- The 15-minute snap indicator and drag-over highlight render reliably in every browser — Chrome, Firefox, and Safari — since they no longer depend on native-drag paint timing.
- A plain click (no meaningful pointer movement) still opens the event/task editor or toggles a task's checkbox exactly as it did before — a movement threshold distinguishes "clicked" from "dragged."
- Touch devices incidentally gain working drag-to-reschedule as a side effect of using Pointer Events (not a goal this plan tests for, but not something to regress either).

## Non-Goals

- No change to the reschedule business logic, API calls, or any of `lib/calendar-drag.ts`'s existing exports.
- No change to what's draggable or where it can be dropped (lane-crossing rules, Agenda's exclusion, etc. — all unchanged).
- No resize-by-drag.
- Making the dragged block's own DOM node visually relocate pixel-for-pixel during the drag is explicitly out of scope for this pass — the existing separate indicator-line/highlight treatment is kept as-is, just driven by a different event source. (A fuller "ghost that looks like the real block" is a reasonable future enhancement, not required here.)

## Constraints

- No new dependency — Pointer Events are a native Web API, supported in all target browsers.
- `document.elementFromPoint`, `Element.prototype.setPointerCapture`, and `Element.prototype.releasePointerCapture` are not implemented in jsdom (confirmed directly) — tests must stub them; production code calls them unconditionally (they always exist in real browsers, so no defensive existence-checks).
- A fixed movement threshold (4px) distinguishes a drag from a click. Below it, pointerup invokes the same action a plain click would have; at or above it, pointerup commits the reschedule instead. `click` events on draggable elements are no longer relied on at all — the pointer handlers call the click-equivalent action directly, since a native `click` firing after a real drag's `pointerup` cannot be reliably suppressed across browsers (`preventDefault()` on pointer events doesn't guarantee it).
- Hit-testing (which day cell / which hour) reads a `data-day="YYYY-MM-DD"` attribute (new) on `.mg-cell`/`.wg-allday`/`.wg-col` via `document.elementFromPoint(clientX, clientY)` + `.closest("[data-day]")`, mirroring the existing `formatDateParam` convention. A new small `parseDateParam` export in `lib/calendar-dates.ts` is this attribute's inverse.
- Pointer capture (`setPointerCapture` on `pointerdown`) is what lets `pointermove`/`pointerup` keep firing on the originating element regardless of where the cursor physically is — this is what replaces needing `dragenter`/`dragleave` tracking (and its Safari `relatedTarget` unreliability) entirely.

## What's Left to the Builder

- Exact movement-threshold value tuning beyond the stated 4px, if it turns out too twitchy or too sluggish in practice.
- Whether the shared pointer-mechanics hook lives at `components/calendar/usePointerDrag.ts` or another path — the plan's File Structure makes a call, a sensible alternative location is fine.
