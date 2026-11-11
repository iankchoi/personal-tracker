# Calendar Part 3: Recurring Events — Design

## Intent

Calendar events can currently only be one-off. The user wants to create
repeating events (their own example: "change my contacts every 2 weeks"),
see them rendered correctly across every view, and edit or delete them the
same way Google Calendar's own web client does — including the three-way
"This event / All events / This and following events" choice whenever a
recurring event is touched.

This app already syncs live with Google Calendar (no local database of
its own for events). The guiding constraint, stated directly by the user:
**recurrence should work exactly like Google Calendar's own system**, so
that whatever this app writes stays perfectly legible to the real Google
Calendar web/mobile clients and vice versa. This is not "build a
recurrence engine" — it's "drive Google's own RRULE-based recurrence
engine correctly."

Google Tasks has no recurrence concept in its API at all (confirmed by
reading `lib/google-tasks.ts`'s `GoogleTask` type — no RRULE-equivalent
field exists). The user confirmed this feature is calendar-events-only;
repeating tasks are explicitly out of scope and would need a completely
different, app-side mechanism if ever built.

## Current State (confirmed by reading the code)

- `lib/google-calendar.ts`'s `listEvents` already calls Google with
  `singleEvents: "true"`, so a recurring series already arrives as
  individual occurrence objects, each carrying `recurringEventId` (set on
  every occurrence except the series' own master event, which instead
  carries `recurrence: string[]` — the RRULE lines). **No read-side work is
  needed** — every view already renders each occurrence as its own event
  today; only "these shouldn't all look identical to a one-off" is new.
- `lib/actions/calendar-events.ts` already exports
  `RecurrenceEditScope = "this" | "all" | "following"` and threads
  `scope?: RecurrenceEditScope` through `updateEventAction`/
  `deleteEventAction`'s input types — but both functions currently ignore
  it entirely (confirmed by reading them: the comments literally say
  "ignored in this task's implementation" / "deliberately
  recurrence-unaware"). This plan makes that parameter real.
- `buildEventPayload` already passes `recurrence` straight through
  untouched on create and update.
- `components/calendar/EventEditor.tsx`'s "Repeat" field is a disabled
  `<select>` hardcoded to "Does not repeat", with a comment: "Part 3 of
  this feature makes this field live." This plan is that Part 3.
- Three call sites currently mutate an event's `start`/`end` without any
  scope awareness at all, because scope awareness didn't exist until now:
  `MonthView.tsx`'s `handleDrop`, and `HourGrid.tsx`'s
  `handleAllDayDrop`/`handleTimedDrop` — all three call `updateEventAction`
  directly. `EventEditor.tsx`'s `handleSave`/`handleDelete` are the other
  two mutation points.
- There is no keyboard Delete for events today, recurring or not. The
  only existing precedent for a document-level `keydown` listener tied to
  an open editor is `ModalShell.tsx`'s Escape-closes-the-modal listener.
  There is also no concept of "a selected event on the grid" independent
  of the editor being open.

## Goals

1. Let the user set a recurrence rule when creating (or later editing) an
   event, via the "Repeat" field: the same common presets Google Calendar
   itself offers (Daily, Weekly, Monthly, Annually, Every weekday), plus a
   "Custom..." option — repeat every **N** **[days/weeks/months/years]**,
   ending **never** / **on a date** / **after N occurrences**.
2. Visually mark a recurring event's chip (Month/Week/Day views) so it
   reads as part of a series at a glance, reusing `EventEditor.tsx`'s
   existing `RepeatIcon`.
3. Whenever a recurring event is touched — dragged to reschedule, deleted
   (button or keyboard), or saved after editing in the full editor — ask
   **This event / All events / This and following events**, exactly like
   Google Calendar, before sending anything to Google.
4. Make that choice actually change what gets written to Google:
   - **This event**: exactly today's behavior — PATCH/DELETE the specific
     occurrence's own `eventId`.
   - **All events**: resolve the series' master event and PATCH/DELETE
     that instead, so the change applies to the whole series.
   - **This and following events**: end the original series right before
     this occurrence, and — for an edit, not a delete — start a new series
     from this occurrence onward carrying the edit and the same recurrence
     pattern.
5. Add keyboard Delete for an event, scoped to **while its full editor is
   open** (mirroring `ModalShell`'s existing Escape-closes pattern, not a
   new "select an event directly on the grid" feature) — pressing
   Delete/Backspace does what clicking the editor's own Delete button does,
   scope dialog included when the event recurs.

## Non-Goals

- Recurring Google Tasks. Out of scope per the user; Tasks has no RRULE
  concept server-side.
- A full by-day-of-week multi-select for weekly custom rules (e.g. "every
  Mon/Wed/Fri"). The custom builder's weekly/every-N-weeks option repeats
  on the same weekday as the event's own start date only. This is a
  deliberate simplification against Google's actual UI (which lets you
  check multiple weekdays) — it covers the user's own stated need exactly
  ("every 2 weeks" on one day) at a fraction of the UI and RRULE-building
  complexity. Flagged here as my call, not something asked for.
- Selecting/deleting an event directly off the grid without opening it.
  Keyboard Delete only fires while the editor is already open.
- Any local caching/database of events or recurrence state. Google remains
  the sole source of truth, exactly as the rest of this app already works.

## Anti-Goals

- Building an app-side recurrence expansion engine. Google's `singleEvents`
  expansion already does this; duplicating it would both be wasted work and
  a durable source of drift between what this app shows and what Google's
  own clients show.
- A recurrence UI so flexible it stops looking like Google Calendar's own.
  Parity with Google's own system is the explicit design goal, not a
  springboard to a more powerful scheduler.

## Constraints

- Every write must use Google's own RRULE grammar and API semantics
  (`recurrence: string[]` RRULE lines on the master; `recurringEventId` to
  find the master from an instance; `singleEvents=true` for reads) so
  events stay fully legible to real Google Calendar clients.
- No new dependency for RRULE parsing/building — the grammar this feature
  actually needs (FREQ, INTERVAL, UNTIL, COUNT, BYDAY for a single weekday)
  is small enough to hand-write against Google's documented RRULE subset,
  consistent with this codebase's existing style of thin, hand-rolled
  Google API wrappers (see `lib/google-calendar.ts`, `lib/google-tasks.ts`
  — no API client library is used anywhere in this project).
- `lib/calendar-drag.ts`'s existing pure functions
  (`shiftEventToDay`/`moveEventToSlot`/offset-preserving date math) are
  untouched — they already compute the correct new `start`/`end` for a
  dragged occurrence. This plan's job is routing their *result* through
  the scope dialog and the new scope-aware backend, not changing how a new
  time is computed.
- `withoutEventClobberFields` continues to apply to drag-originated writes
  exactly as today (a drag never touches color/reminders/Meet/guests).

## Decided — the How

### RRULE helpers (new file: `lib/calendar-recurrence.ts`)

Pure functions, pure data in/out, no network calls — same style as
`lib/calendar-drag.ts`:

- A `RecurrenceRule` type describing what the UI's Repeat field can
  express: `{ freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval:
  number; end: { type: "never" } | { type: "onDate"; date: string } |
  { type: "afterCount"; count: number } }`. ("Every weekday" is `freq:
  "WEEKLY"`, `interval: 1`, plus the single-weekday `BYDAY` derived from
  the event's own start date — Monday-through-Friday as a UI preset is
  the builder's call on exact wording/shape.)
- `buildRRule(rule: RecurrenceRule, eventStartDay: Date): string` — the
  single RRULE line Google expects in `recurrence: [line]`.
- `parseRRule(line: string): RecurrenceRule` — the inverse, for populating
  the Repeat field when editing an existing recurring event.
- `truncateRRuleBefore(line: string, occurrenceStart: Date): string` —
  returns the RRULE with its `UNTIL` set to end the day before
  `occurrenceStart` (used by both the delete-following and
  edit-following paths to close out the original series). If the
  original rule had `COUNT` instead of `UNTIL`, this still produces an
  `UNTIL`-based rule — Google accepts either, and recomputing a shortened
  `COUNT` would require knowing exactly which occurrences already fired,
  which `UNTIL` avoids needing at all.

### Visual badge

`MonthView.tsx`'s chip components and `HourGrid.tsx`'s chip/block
components each already know the event they're rendering; wherever an
event's `recurringEventId` is set (or, for the series' own master
instance if one is ever rendered directly, `recurrence` is non-empty),
render `EventEditor.tsx`'s existing `RepeatIcon` inline. `EventEditor.tsx`
should export that icon (or move it to a small shared icons file if one
pattern already exists in this codebase — builder's call) rather than
duplicating the SVG.

### The scope dialog

One new shared component, `RecurrenceScopeDialog` (or similar — builder's
naming call), rendered via the same `ModalShell`-backed overlay pattern as
every other create/edit surface in this codebase. Takes the three choices
as buttons, returns the user's pick through a callback/promise — whichever
shape fits this codebase's existing modal-returning-a-result conventions
better (`EventTaskModal`/`CalendarInteractionProvider` are the precedent to
read before deciding). Only ever shown when the event being acted on has
`recurringEventId` set (an occurrence of a series) or `recurrence` set (the
series' own master, if a drag/delete ever targets it directly) — a
genuinely one-off event skips straight to the existing today's-behavior
PATCH/DELETE, no dialog.

Wired into all five mutation points:

- `MonthView.tsx`'s `handleDrop`
- `HourGrid.tsx`'s `handleAllDayDrop` and `handleTimedDrop`
- `EventEditor.tsx`'s `handleSave` (only on the `edit` path — `create`
  never needs a scope choice)
- `EventEditor.tsx`'s `handleDelete`
- The new keyboard Delete listener (see below), which calls the same
  `handleDelete` path `EventEditor`'s own Delete button already uses

### Keyboard Delete

A `keydown` listener added inside `EventEditor.tsx` itself (not a new
grid-level selection concept), scoped to while the editor is mounted —
same lifecycle as `ModalShell`'s existing Escape listener, same
is-typing-target guard `CalendarShortcuts.tsx` already uses so Delete/
Backspace pressed while editing the title or description text fields
doesn't trigger this. Fires the exact same code path as clicking the
editor's own Delete button.

### Backend: making `scope` real

`lib/google-calendar.ts` gains one new thin wrapper, `getEvent(accessToken,
calendarId, eventId): Promise<GoogleCalendarEvent>` (a plain `GET` on the
single-event endpoint — every other verb already exists; this one doesn't
yet), needed to read a series' current master `recurrence`/`start`/`end`
before computing an "all" or "following" write.

`updateEventAction`/`deleteEventAction` in `lib/actions/calendar-events.ts`
branch on `scope`:

- **`scope: "this"` (or absent)** — exactly today's code, no change.
- **`scope: "all"`**:
  - Resolve the master's `eventId`: the acted-on event's own
    `recurringEventId` if present, else its own `id` (it already *is* the
    master).
  - **Update**: fetch the master via `getEvent`, compute the delta between
    the acted-on occurrence's *original* `start`/`end` and the input's new
    `start`/`end` (reusing the same offset-preserving arithmetic
    `lib/calendar-drag.ts` already has — a day delta for all-day events, a
    duration-preserving instant delta for timed ones), apply that delta to
    the master's own `start`/`end`, and PATCH the master with the delta'd
    time plus every other changed field from the input applied directly
    (title, description, etc. — those aren't time-relative, so they just
    overwrite).
  - **Delete**: `deleteEvent` the master `eventId` directly — Google
    removes the whole series.
- **`scope: "following"`**:
  - **First, check whether the acted-on occurrence *is* the series'
    first occurrence** (its original `start` equals the master's own
    `start`). If so, treat this identically to `scope: "all"` instead —
    there is nothing before the first occurrence for "following" to
    preserve, so splitting off a new series here would just produce an
    orphaned, immediately-empty old master for no behavioral difference
    the user could ever observe. **My call**, settled rather than asked,
    because the alternative (actually splitting) has no user-visible
    upside and an extra orphaned-master edge case downside.
  - Otherwise: resolve the master the same way as `"all"`.
  - Fetch the master via `getEvent` to read its current `recurrence` line.
  - PATCH the master with `recurrence: [truncateRRuleBefore(masterRule,
    occurrenceOriginalStart)]` — ends the old series the day before this
    occurrence.
  - **Delete** stops here — nothing further to create.
  - **Update** additionally `createEvent`s a brand-new event: every field
    from the master that the input didn't change, every field the input
    did change, `start`/`end` from the input (the occurrence's new time),
    and `recurrence: [the master's original rule, unmodified]` — a fresh
    series continuing the same pattern from this point on. (If the
    original master had `COUNT` rather than `UNTIL`, the new series'
    exact remaining count is a real ambiguity — `writing-plans`'s Review
    Focus should pin down the exact resolution; a reasonable default is
    switching the new series to `UNTIL` computed from the master's own
    end-date-if-any, or carrying the same `COUNT` forward unmodified as
    the simpler, slightly-over-generous option.)
  - **Google Meet continuity**: the master's read-side `conferenceData`
    (resolved `conferenceId`/`entryPoints`) is not the write-side shape
    `createEvent` accepts (`conferenceData.createRequest`) — copying the
    master's raw `conferenceData` forward into the new series' `createEvent`
    call would silently produce a meeting with no Meet link at all. **My
    call**: if the master had a Meet link, the new split-off series mints
    a *fresh* `createRequest` (same as creating any new event with Meet
    enabled) rather than attempting to carry the old link forward — this
    means the split event gets its own new Meet link, not a continuation
    of the old one, but it keeps Meet working rather than silently
    dropping it. Google itself has no API for "transplant an existing Meet
    link onto a new event," so "mint fresh" is the only option that
    doesn't regress the feature.

### Create

`EventEditor.tsx`'s Repeat field becomes a real control: the preset
options plus "Custom..." opens a small inline sub-form (interval + unit +
end condition) — exact layout is the builder's call, matching this file's
existing row-based field styling. On save, `buildRRule` turns whatever the
user picked into the `recurrence: string[]` already passed straight
through by `buildEventPayload`. Editing an existing recurring event's
*own recurrence rule itself* (as opposed to its time, title, etc.) is the
same `parseRRule`-populated field.

**Changing the Repeat field and the scope dialog, resolved (my call):** a
single occurrence can never carry its own different recurrence rule in
Google's model — "This event" is meaningless for a recurrence change. So:
whenever the Repeat field's value at Save time differs from what it was
populated with on open, the scope dialog offers only **All events** and
**This and following events** ("This event" is omitted, not merely
disabled — there is nothing it could mean here). The two remaining choices
behave exactly as Google Calendar's own web client does:
- **All events** + a new rule picked → PATCH the master's `recurrence` to
  the new rule. + "Does not repeat" picked → PATCH the master's
  `recurrence` to `[]`, collapsing the series into a single non-recurring
  event at the master's own original time (Google's own real behavior for
  this action — every other occurrence simply stops existing).
- **This and following** + a new rule picked → same split as any other
  "following" edit, with the *new* series created using the newly-picked
  rule rather than the old master's rule.
  + "Does not repeat" picked → truncate the old series as usual, but
  instead of creating a new recurring series, `createEvent` a single
  plain one-off event at this occurrence's time/fields (no `recurrence`
  field at all) — "the rest of the series becomes just this one event."

A recurrence change combined with *no* change to the Repeat field uses the
normal all/following scope paths like any other field change, as
originally written.

## What's Left to the Builder

- Exact RRULE construction/parsing code for the specific grammar subset
  above (FREQ/INTERVAL/UNTIL/COUNT/single-BYDAY) — `writing-plans` should
  give exact function signatures and test cases per
  `superpowers:writing-plans`'s own step-granularity rules.
- The scope dialog's exact component shape/naming and how its result gets
  back to each of the five call sites — read `EventTaskModal.tsx` and
  `CalendarInteractionProvider.tsx` first; match whichever
  callback/promise convention this codebase already leans on.
- Exact Repeat-field UI layout for the Custom builder (inline expansion vs.
  a nested popup) — match `EventEditor.tsx`'s existing row style.
- The `COUNT`-vs-`UNTIL` ambiguity on a "following" split noted above —
  pin down one resolution before writing tests for it.
- Where the new `RecurrenceRule`/RRULE helpers' tests live
  (`tests/lib/calendar-recurrence.test.ts`, matching
  `tests/lib/calendar-drag.test.ts`'s precedent) and what test cases cover
  the Review Focus items below.

## Review Focus

- **A drag on a recurring occurrence picks "All events."** The delta
  computed from one occurrence must land correctly on the *master's* own
  start/end, not accidentally reuse the occurrence's absolute time — an
  easy off-by-one-occurrence bug given the master's start can be weeks or
  months before the dragged occurrence.
- **"This and following" picked on the *first* occurrence of a series.**
  Truncating the master to end "the day before" the first occurrence
  should be checked — does it produce a correctly-empty old series (and
  does Google accept/reject that), or should this collapse to the same
  behavior as "All events" instead?
- **A recurring event that's already an exception** (previously dragged
  individually, so its own time no longer matches the series pattern) gets
  "All events" or "This and following" applied. Google's own semantics
  (editing the master doesn't retroactively un-except already-diverged
  instances) should be preserved, not fought.
- **An all-day recurring event** vs. a **timed** one — the delta math for
  "All events" needs the same date-only-vs-offset-aware branching
  `lib/calendar-drag.ts`'s `shiftEventToDay`/`moveEventToSlot` already
  split on, applied now to the *master's* fields rather than the
  occurrence's.
- **Keyboard Delete fired while focus is inside a text field inside the
  editor** (title, description, guest input) must not fire — reuse
  `CalendarShortcuts.tsx`'s `isTypingTarget` guard rather than reinventing
  it.
