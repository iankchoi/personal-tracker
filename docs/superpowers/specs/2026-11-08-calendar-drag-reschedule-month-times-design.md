# Calendar — Drag-to-Reschedule + Month View Time Labels Design

**Intent:** Two related improvements to the Calendar's existing grid views (Month, Week, Day — Agenda is a flat list and is out of scope for drag): dragging an event or task to a new day/time reschedules it without opening its editor, and Month view's chips grow a Google-Calendar-style time label so a glance at a busy day tells you order and roughly distinguishes events (which carry a time) from tasks (which still carry their own checkbox).

**Why now:** Requested directly by the user as the next piece of Calendar work, after the live-tested create/edit flow (PR #3) shipped. Recurring events (the already-written Part 3 plan) is deliberately sequenced after this, not before — drag-to-reschedule for a recurring instance is real added scope this doc does not take on.

This conversation skipped the brainstorming Q&A (user said "skip questions"), so every decision below is the author's call, not something the user was asked to confirm. Flagged inline as `(call)` where a reasonable alternative existed.

## Goals

- Drag an event or task chip in Month view to a different day; its date changes, nothing else does.
- Drag an event or task block in Week/Day view's hour grid to a new time and/or (Week only) a new day column; duration is preserved for events.
- Drag a task between the all-day row and the timed grid in Week/Day view, picking up or clearing its due time.
- Month view's event chips show a time label (e.g. "10:00 AM") before the title, for timed events only.
- A failed reschedule (network/Google error) leaves the item where it was and tells the user, rather than silently doing nothing or crashing the view.

## Non-Goals (v1)

- **No lane-crossing for events.** An all-day event dragged in Week/Day view stays in the all-day row (day changes only); a timed event dragged in the hour grid stays timed (time and/or day changes only). Converting an event between all-day and timed via drag is real UX Google Calendar has, but it requires picking a default duration/time with no obvious right answer — deferred. `(call)`
- **No drag in Agenda view.** It's a pure chronological list with no day/time drop target the way the three grid views have one.
- **No resize-by-dragging an edge** (changing only duration). This plan is move-only.
- **No recurring-event-aware drag.** Recurrence (Part 3) hasn't shipped yet on `main`; when it does, dragging a recurring instance is new scope, not implied by this doc.
- **No cross-view drag** (e.g., dragging from a Month cell into a Week grid rendered elsewhere) — not meaningful, since only one view renders at a time.

## Constraints

- No new dependency: implemented with the browser's native HTML5 Drag and Drop API (`draggable`, `dragstart`/`dragover`/`drop`), not a library. `(call, stated in chat and already agreed)`
- `updateEventAction`/`updateTaskAction` (in `lib/actions/calendar-events.ts` / `lib/actions/calendar-tasks.ts`) take the *full* `EventActionInput`/`TaskActionInput`, not a partial patch — a drag handler must reconstruct the complete payload from the dragged item (reusing the same Google-shape → action-input mapping `EventTaskModal.tsx` already has for its editors) and override only the fields the drop actually changed.
- Existing convention for mutations in this codebase: call the server action, then `router.refresh()` — no separate local optimistic-state tracking (see `TaskCheckbox`'s own doc comment). Drag follows the same pattern: the dragged DOM node does not move until the refreshed server data re-renders it in its new slot.
- Time-grid drop position snaps to the nearest **15 minutes**, clamped to the grid's existing fixed window (`GRID_START_HOUR`–`GRID_END_HOUR` in `lib/calendar-layout.ts`) — the same window timed events/tasks are already confined to. `(call)`
- A multi-day all-day event's **span length must be preserved** when dragged — shifting both `start` and `end` by the same day delta, never just overwriting `start`.
- Dragging a task's or event's own interactive control (the task's checkbox input) must not itself start a drag — only the chip body does.

## What's Left to the Builder

- Exact CSS for the drag-over hover affordance (highlighting the candidate drop cell/column) — any visible, non-jarring treatment is fine.
- Exact wording/placement of the failure message when a drag's update call fails.
- Whether the mapping-extraction task (pulling `googleEventToEditorInitial`/`calendarTaskToEditorInitial` out of `EventTaskModal.tsx`) lands in one new file or two — the plan's File Structure section makes this call, but a sensible alternative split is fine.
