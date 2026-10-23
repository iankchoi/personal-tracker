# Calendar — Event & Task Creation Design

## Intent

The Calendar read-only-views plan shipped Day/Week/Month/Agenda views that render live Google Calendar data, but nothing can be created, edited, or completed from inside the app — the "+ New event" button is disabled, clicking an event does nothing, and there is no concept of a Task at all. This design closes that gap: clicking anywhere on the calendar grid opens a quick-create popup offering either an **Event** (a real Google Calendar event) or a **Task** (a real Google Task, with a few capabilities Google Tasks itself lacks — most importantly, a time of day). Clicking an existing event or task opens the same surface for editing, with a delete action and, for tasks, a checkbox to mark complete.

This is also deliberately the prerequisite layer for a later Canvas-assignment-import feature: assignments pulled from Canvas will create Google Tasks through the exact same mechanism built here (same Google Tasks API calls, same local table for the due-time-with-hours Google Tasks can't natively hold), so that later piece becomes "a cron job that calls the Task-creation path this plan already built," not a second system.

## Why now

The user tried the shipped read-only Calendar and immediately hit the wall of not being able to add anything — "+ New event" does nothing, clicking an event does nothing. This is the next piece in the agreed "piece by piece" Calendar breakdown, pulled forward and widened in one conversation: originally scoped as three separate pieces (CRUD, recurrence, attendees), the user chose to bundle everything *except* recurrence and Drive attachments into one plan, since most of it shares the same click-to-create interaction and the same popup/editor UI.

## Goals

- Click a time slot (Day/Week) or a day box (Month/Agenda) on the calendar → a popup to create an **Event** or a **Task**, prefilled with a sensible default for whatever was clicked.
- A lightweight "quick create" popup (title, when, calendar/list) with a "More options" link expanding to a full editor.
- Full Event editor: description, location (with Google Places autocomplete), guests (real Gmail invites, same mechanism as Google Calendar's own UI), guest permissions, Google Meet, color.
- Full Task editor: due date + *optional* time (a capability layered on top of Google Tasks, which only supports a date), task list, description, color.
- Click an existing event or task on the grid → the same editor, pre-filled, with Save and Delete. Tasks additionally get a checkbox for instant complete/incomplete, both on the grid and in the editor.
- Overlapping same-time events on Day/Week render side-by-side in narrower columns (Google Calendar's own behavior), not stacked at full width.
- Keyboard shortcuts on the Calendar page: `D`/`W`/`M`/`A` switch views, `N` opens the create popup (defaulting to Event, for today).
- A per-item color override, on top of the existing per-*calendar* color assignment (unchanged) — defaulting to the app's blue (`cal` token) when not overridden.
- A "Repeat" picker on Event creation (Does not repeat / Daily / Weekly / Monthly / Yearly / Custom — Google Calendar's own dropdown), and full "this event / this and following events / all events" semantics for editing and deleting existing recurring events. **Events only** — Tasks stay one-off, no recurrence.
- A "Notify before" field on events, defaulting to 30 minutes, user-adjustable — reuses the event's native Google Calendar reminder field, which this app's existing (already-spec'd) push-notification system is designed to read as its own lead time.

## Non-goals (this plan)

- **Google Drive attachments** — requires the Google Picker API (a second client-side widget) and a new Drive OAuth scope beyond what this app already requests. Deferred to its own plan.
- **Canvas → Google Tasks sync** — the periodic cron job, Canvas API client, and the Canvas connection UI in Settings are a separate, already-spec'd piece (`2026-10-21-personal-tracker-design.md`'s "Canvas → Google Tasks sync" section). This plan only needs to leave the right-shaped local table and Task-creation path for that piece to plug into later — it does not build the Canvas side itself.
- **Reminders page changes** — explicitly scratched by the user mid-conversation. Reminders stays exactly as already spec'd (internal-only, never synced to Google); this plan does not touch it.
- **Google Places *structured* location data** (lat/lng, place IDs stored for later use, map previews) — the app only needs the resolved address *text*, which is all Calendar's `location` field holds anyway. Places Autocomplete is a client-side input helper only.

## Anti-goals

- Do not invent a parallel event-storage system. Every event is still a live Google Calendar object, created/edited/deleted via real API calls — the Global Constraint from the read-only-views plan ("Google Calendar events are never duplicated into Postgres") continues to hold for event *content*. The only new local storage is Task metadata Google's API has nowhere to put (see Data model).
- Do not let per-event color become a second, competing color system. It is explicitly an *override* on top of the existing per-calendar assignment (Task 4 of the shipped plan), not a replacement for it — an event with no override still shows its calendar's assigned color, exactly as today.

## Constraints

- **Events: write through to the real Google Calendar API.** Create/update/delete calls go to `events.insert`/`events.patch`/`events.delete`. An event created here is indistinguishable from one created in Google Calendar's own UI — visible in the native app, other devices, to invited guests.
- **Tasks: write through to the real Google Tasks API**, with one local augmentation. `tasks.insert`/`tasks.patch`/`tasks.delete` on `tasks.googleapis.com`. Google Tasks' `due` field is **date-only** — this is a hard API limitation, not a design choice (same constraint already documented for the Canvas sync piece). To give tasks a real time, the local database stores the full due timestamp and an optional color token, keyed by the Google Task's own ID — never the task's title/notes/content, which stay live-read from Google like everything else.
- **Guest invites use the real mechanism.** Adding an attendee via the `attendees` field on an event triggers Google's own invite email — no custom email system, nothing to build beyond passing the right field.
- **Location autocomplete needs a new Google API key.** Places Autocomplete is a different product from the Calendar/Tasks OAuth scopes already granted — it needs its own API key enabled in Google Cloud Console (not part of the existing OAuth client). Confirmed acceptable: for a single personal user, usage stays inside Google's free tier (session-based billing, ~5,000 free sessions/month; realistic personal use is a handful of creations a day).
- **No new OAuth scopes needed for Calendar or Tasks writes.** The existing scope (`.../auth/calendar` and `.../auth/tasks`, both already granted during the foundation sign-in) are the full read/write scopes, not read-only variants — event and task creation/editing/deletion work under consent already obtained. Only Places needs new Google Cloud Console setup.
- **Per-event color is a real Google field, not a local invention.** Google Calendar events support a native `colorId` (an enum of 11 fixed IDs); this app's 6-token palette maps onto 6 of those 11, so a color chosen here is a genuine part of the Google event — it shows (approximately — Google's own fixed hex for that ID, not our exact brand hex) in the native Google Calendar app too, and a color changed there would be picked up here on next read. Per-task color cannot use this mechanism (Google Tasks has no color field at all) — it is local-only by necessity, stored in the same new table as the due-time augmentation.
- **Icons match the existing sidebar's visual language**: custom inline SVGs, `viewBox="0 0 24 24"`, 16×16 rendered, `stroke-width: 1.6`, `stroke: currentColor`, no fill — not emoji, not an icon font/library.

## Decided design (from the brainstorming conversation, with mockups reviewed and approved)

### Click-to-create interaction

- **Day/Week view, click a time slot** → popup anchored there. Event: prefilled to that start time, **1 hour** default duration (not 30 minutes). Task: prefilled to that date and time (tasks *do* get a time when created from a specific slot).
- **Month/Agenda view, click a day** (no time granularity available) → popup for that day. Event: defaults to a sensible time (implementer's call — e.g. 9 AM next full hour — document the choice). Task: defaults to **no time set** ("All day"), since there's nothing to infer from a day-box click — still freely editable to add a specific time in the same popup.
- Clicking an **existing** event or task opens the identical popup/editor, pre-filled with its current data, with a Delete action added.
- The toolbar's **"+ New event"** button opens the same popup, not anchored to a click — defaults to today's date, Event type, a sensible default time.
- **Keyboard shortcuts** (Calendar page only, not global): `D` → Day view, `W` → Week, `M` → Month, `A` → Agenda, `N` → opens the create popup (Event selected, today, default time) — same semantics as "+ New event".

### The popup (quick create)

Title input, an Event/Task toggle (Event selected by default), a date+time section (start/end range for Event; a single optional-time "Due" field for Task), a calendar picker (Event) or task-list picker (Task), and a "More options" link that expands into the full editor. Cancel/Save actions.

### Calendar/list picker scope

The Event popup's calendar picker only lists calendars the user can actually write to (Google's `calendarList` entries carry an `accessRole`; anything less than `writer`/`owner` — e.g. a read-only subscribed Holidays calendar — is excluded). Without this, picking a read-only calendar and hitting Save would fail with a 403 from Google with no useful explanation. `GoogleCalendarListEntry` (currently in `lib/google-calendar.ts`) needs `accessRole` added to support this.

### All-day events

Events get the same "All day" toggle Google Calendar's own editor has — switching it on drops the time pickers in favor of a single date (or date range for multi-day), matching the event-resource shape the read-only views already render (`start.date`/`end.date`, no `dateTime` — see `getAllDayEvents` in `lib/calendar-layout.ts`). This was a real gap in the first draft of this design: the read-only views already show all-day events, and "click an existing event opens the editor" has to work for them too, or clicking one would crash. Not a scope expansion, just closing a hole the first pass missed.

### Recurring events (Events only — Tasks never repeat)

**Creating a recurring event**: the full editor gets a "Repeat" field, matching Google Calendar's own dropdown exactly — Does not repeat / Daily / Weekly (on the day the event falls on) / Monthly / Yearly / Every weekday (Mon–Fri) / Custom. Custom lets the user set an interval + unit (every N days/weeks/months/years), and — for a weekly pattern specifically — which day(s) of the week it falls on (e.g. "every 2 weeks on Mon & Thu"), plus an end condition (never / on a date / after N occurrences). Applies to timed and all-day events alike (e.g. a recurring all-day birthday) — the only implementation consequence is that the RRULE's `UNTIL` value is a bare date for an all-day series and a UTC date-time for a timed one; this is a formatting detail for the implementation plan, not a product decision. This builds the event's `recurrence` array (an RRULE string) on create.

**Editing or deleting an existing recurring event's instance** offers Google Calendar's own three-way choice:
- **This event** — the clicked instance has its own distinct event ID (every occurrence returned by the read-only views' fetch, via `singleEvents=true`, already has one), so `patch`/`delete` on that ID touches only this occurrence. Google's API supports this natively, no special handling needed. The Repeat field is hidden/disabled in this mode — a single instance can't carry an independent recurrence rule, matching Google's own editor.
- **All events** — look up the series' master event via the instance's `recurringEventId` field, and `patch`/`delete` *that* instead. One extra lookup, otherwise ordinary. The Repeat field is fully live here — changing it rewrites the master's `recurrence` (including setting it to "Does not repeat," which collapses the series back to a single plain event).
- **This and following events** — the genuinely hard case: Google Calendar implements it by *splitting the series*. For a delete: truncate the master's RRULE with an `UNTIL` set to just before this instance's date (an update to the master event, not a delete). For an edit: truncate the master's RRULE the same way, *and* create a brand-new event starting at this instance's date/time with the changed fields. The Repeat field is live here too — left unchanged, the new continuation series carries the original pattern forward re-based from this date; changed, the continuation adopts the new pattern instead (matching Google's own behavior — this is a genuine edit point, not just a re-basing). **Write ordering matters for safety**: create the continuation event first, and only truncate the original series' `UNTIL` after that insert succeeds — if the truncate happened first and the insert then failed, the series would silently lose all future occurrences with nothing to replace them. Doing it insert-then-truncate means a failure just leaves the original series untouched and the edit can be retried. This requires real RRULE string manipulation (parsing the existing rule, computing/inserting `UNTIL`, re-emitting a rule for the new series) — the single most complex piece of this plan.

A click on a *non-recurring* event skips the three-way choice entirely and behaves as it always would (no `recurrence` field present, no `recurringEventId`).

### Events the user can't fully edit

An event the user didn't organize (invited as a guest, `guestsCanModify: false`) will reject a `patch`/`delete` call from the API. For a single-user personal app this is a minor, low-frequency case — the editor does not need to pre-detect and degrade to read-only; letting the write fail and surfacing Google's error is an acceptable default. Revisit if this app ever has multiple users regularly on each other's shared calendars.

### The full editor ("More options")

**Event**: everything in the quick popup, plus — an "All day" toggle, a "Repeat" dropdown (see Recurring events below), a "Notify" field defaulting to 30 minutes before (writes the event's native `reminders.overrides`, picked up automatically by this app's own push-notification system per the existing Notifications spec — nothing new to build there beyond setting the field), location (free-text, with Google Places autocomplete as the user types), a "Add Google Meet video conferencing" action (sets `conferenceData` to auto-generate a link), a description textarea, a guests section (chip list + add-by-email, triggering real Google invites), three guest-permission toggles (`guestsCanModify`, `guestsCanInviteOthers`, `guestsCanSeeOtherGuests`), and a 6-swatch color picker (our tokens, default `cal`/blue selected).

**Task**: quick-popup fields plus a description/notes textarea and the same 6-swatch color picker (local-only, same default). No location, guests, or Meet — Task itself has no concept of these on Google's side.

Icons throughout: the sidebar's own inline-SVG style (clock for When/Due, the existing calendar-nav icon for Calendar, a pin for Location, a video-camera outline for Meet, a document for Description, a two-person outline for Guests, a padlock outline for Guest permissions, a checkbox-tick for the Task list field, a three-dot ring for Color).

### Rendering a saved/completed task on the grid

A task renders as a small checkbox + title (+ time, if it has one), using its color (override or default blue) the same way an event uses its calendar's color. Checking it off (on the grid or in the editor) strikes through the title, dims it, and calls the Google Tasks complete endpoint instantly — same visual and sync behavior whether the task was created manually here or (later) imported from Canvas.

### Overlapping events (Day/Week)

Events that overlap in time render side-by-side in narrower columns instead of full-width stacked blocks, matching Google Calendar's own layout behavior — implementer's call on the exact column-assignment algorithm (the well-known approach: group mutually-overlapping events into a cluster, divide the cluster's width evenly among its members), described precisely in the implementation plan, not here.

## Data model

One new table, scoped as narrowly as the existing `canvas_sync` precedent — local metadata only, never the task's actual content:

- A new table (name left to the implementation plan) keyed by `user_id` + `google_task_id` + `google_task_list_id`, storing: `due_at` (**nullable** — the full timestamp when the task has a specific time; null means "date only, no time," displayed using Google's own date-only `due` field), `color_token` (one of the app's 6 tokens, nullable — null means "use default blue"), `created_at`/`updated_at`. No title, no notes, no completion state — those stay live-read from the Google Tasks API on every request, same principle as events. The row is created the moment a task is created through this app (even a dateless one, since it needs to exist to hold the color token), never conditionally — so "add a time to a previously-dateless task" is always an `UPDATE`, never an insert-or-update branch.
- This table is deliberately shaped so the future Canvas sync piece can reuse it directly (a Canvas-imported task is still just a Google Task with a row in this table) rather than needing its own, separate mechanism — though wiring Canvas itself up to it is out of scope here.
- No new table for event colors — `colorId` lives on the real Google Calendar event, read back on every fetch like any other event field.

## What's left to the builder

- The exact mapping from the app's 6 color tokens to Google's 11 `colorId` values (nearest-match by hue; document the chosen mapping once, reused everywhere).
- The exact default time Month/Agenda-view Event clicks prefill to.
- Whether the full editor is a modal overlay (recommended, consistent with the rest of this app's lack of full-page-navigation patterns) or a separate route, matching Google Calendar's own behavior.
- The overlapping-event column-layout algorithm's precise implementation.
- Exact Google Places Autocomplete integration details (which client library/approach, how the API key is scoped/restricted).
- The new task-metadata table's exact name and column types.
- The exact UI for the Custom repeat sub-picker, and the precise RRULE string construction/parsing logic (computing/formatting `UNTIL` per timed-vs-all-day, re-basing the continuation series' start date, preserving `BYDAY`/interval/etc. from the original rule when unchanged).
- Whether the three-way edit/delete choice is its own small confirmation dialog (Google's own pattern) or inline in the main editor — implementer's call, should match the main editor's modal-vs-route decision above.
- Degenerate "this and following" cases (clicking the series' very first or very last occurrence) — can fall through to the general `UNTIL`-truncation logic rather than needing special-cased handling.
