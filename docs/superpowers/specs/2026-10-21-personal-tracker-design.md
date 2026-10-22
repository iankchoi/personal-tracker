# Personal Tracker — Design Spec

Date: 2026-10-21

## Purpose

A self-hostable, open-source personal productivity hub that unifies, in one
place:

- **Calendar** — a live client of the user's real Google Calendar (not a
  rebuild).
- **Canvas** — read-only pull of assignment due dates, surfaced as Google
  Tasks and inside the app with full due-date-and-time precision.
- **Reminders** — rebuilt natively (Apple Reminders has no public web API).
- **Notes** — rebuilt natively (Apple Notes has no public web API).
- **Journal** — new feature: one plain-text entry per calendar day, reachable
  either from a dedicated Journal section or by clicking a date on the
  calendar and pressing a "Journal" button.

Primary user: the author, used roughly equally on phone and desktop. The
project is also intended to be open-sourced, so it is built **multi-user
ready from day one** even though the only real user initially is the author.

## Non-goals (explicitly out of scope)

- Canvas assignment *submission* — due dates only, read-only.
- A shared public multi-tenant SaaS deployment — this is a self-hosted app;
  anyone who wants it runs their own instance.
- Offline writes (offline *reads* of Reminders/Notes/Journal may be cached,
  but creating/editing while offline is not supported in v1).
- End-to-end browser test automation (e.g. Playwright) for v1.
- Mood tracking, prompts, or photo attachments in the Journal — plain text
  only, one entry per day.

## Architecture

- **Framework**: Next.js (App Router), single codebase, deployed on Vercel.
- **Database**: Postgres, provisioned via the Vercel Marketplace (e.g. Neon).
  Every table is scoped by `user_id`.
- **Auth**: Auth.js with the Google provider. Signing in with Google both
  creates/identifies the `users` row and requests Google Calendar + Google
  Tasks OAuth scopes in the same consent flow. No separate password/PIN
  system.
- **Google Calendar API**: live read/write integration — multiple calendars,
  colors, recurrence, all-day events, attendees (so adding an attendee's
  email sends a real Google Calendar invite via Google's own system), and
  per-event reminder overrides (reused as this app's push-notification lead
  time for that event — no separate config surface).
- **Google Tasks API**: separate API/OAuth scope from Calendar, used only for
  syncing Canvas assignments into a dedicated Google Tasks list.
- **Canvas REST API**: read-only. Each user supplies their own Canvas base
  URL and personal access token (pasted in during a one-time Settings step,
  stored encrypted). Polled by a periodic Vercel Cron job.
- **Reminders, Notes, Journal**: fully native, stored in this app's own
  Postgres tables — no external API involved.
- **Notifications**: Web Push (service worker + `web-push`), since the app
  is installable as a PWA on both phone and desktop.
- **Self-hosting**: repo ships with a "Deploy to Vercel" button and a setup
  doc. Each self-hoster brings their own Google OAuth client credentials and
  Postgres database (a free tier is sufficient for personal/family use).

## Data model (Postgres)

Google Calendar events are **not** duplicated in the database — Google
Calendar is the source of truth, queried live via the API on each request.

- **`users`** — id, email, name, encrypted Google access/refresh tokens,
  Canvas base URL, encrypted Canvas personal access token,
  `default_reminder_lead_minutes`, `default_canvas_lead_minutes`,
  created_at.
- **`reminder_lists`** — id, user_id, name, color.
- **`reminders`** — id, user_id, list_id, title, notes, due_at,
  priority (enum: `none` / `low` / `medium` / `high`),
  recurrence_rule (an RRULE string, RFC 5545 — the same format Google
  Calendar uses, so the recurrence-expansion logic can be shared between
  Reminders and Calendar event creation), `notify_lead_minutes` (nullable
  override; falls back to the user's default), completed_at, created_at,
  updated_at.
- **`subtasks`** — id, reminder_id, title, completed_at, position.
- **`note_folders`** — id, user_id, name.
- **`tags`** / **`note_tags`** — id/name per user; many-to-many join with
  notes.
- **`notes`** — id, user_id, folder_id, title, body (rich text, stored as
  structured JSON, e.g. a Tiptap/ProseMirror document, to support embedded
  checklists), pinned (bool), created_at, updated_at. Full-text search over
  title + body via Postgres `tsvector`.
- **`journal_entries`** — id, user_id, date, body (plain text), created_at,
  updated_at. Unique constraint on `(user_id, date)`.
- **`canvas_sync`** — id, user_id, canvas_assignment_id, google_task_id,
  google_task_list_id, due_at (full timestamp, as returned by Canvas —
  Google Tasks itself only stores the date), `notify_lead_minutes` (nullable
  override), submitted (bool, from Canvas submission status),
  notified_at (nullable, tracks whether the lead-time notification already
  fired, so a late submission doesn't retroactively need to cancel it),
  last_synced_at.
- **`push_subscriptions`** — id, user_id, endpoint, keys.

## Feature design

### Calendar

A thin client over the real Google Calendar API. Creating, editing, or
deleting an event in this app *is* creating/editing/deleting it in the
user's actual Google Calendar — visible in the native Google Calendar app,
other devices, and to anyone the event is shared with. Supports: multiple
calendars with color coding, recurring events, all-day events, Day/Week/
Month/Agenda views (same underlying query, different range/rendering), and
inviting other people (handled entirely by Google's own invite-email
system once an attendee is added).

### Canvas → Google Tasks sync

A periodic Vercel Cron job (every 30–60 minutes), per user with a saved
Canvas token:

1. Calls Canvas's `courses` and `assignments` endpoints for upcoming due
   dates.
2. For each assignment, looks up `canvas_sync` by `canvas_assignment_id`:
   - **No row** → create a Google Task in a dedicated "Canvas" task list
     (auto-created on first sync) with the assignment's due *date* (Google
     Tasks ignores time-of-day — this is a hard API limitation, not a design
     choice) and insert the mapping row, storing the full due timestamp
     locally.
   - **Row exists, due date changed** → update the Google Task and the
     stored `due_at`.
   - **Assignment removed/unpublished** → delete the Google Task and the
     mapping row.
3. Also reads each assignment's Canvas submission status
   (`workflow_state`). If submitted (on time or late):
   - Mark the Google Task `status: completed` (same call path as a manual
     checkbox in this app).
   - Set `submitted = true`; skip sending a lead-time notification if it
     hasn't already fired (`notified_at IS NULL`). A late submission does
     not retroactively cancel a notification that already went out.
4. This same job also polls the current `status` of previously-synced
   Google Tasks, so if the user checks one off directly in Google
   Tasks/Calendar instead of in this app, that completion state is picked up
   within the next run (there is no real-time webhook for Google Tasks,
   unlike Calendar, so this direction is poll-based, not instant).

Checking off an assignment **inside this app** calls the Google Tasks API
immediately (synchronous with the request) — that direction is instant.

In this app's own UI, Canvas assignments display with their real due
*time* (not just date), since the full timestamp is stored in
`canvas_sync.due_at` even though Google Tasks only ever shows the date.

### Reminders

List view grouped by `reminder_lists` (color-coded). Each reminder has a
due date/time, priority, optional recurrence rule, and subtasks (a
checklist within the reminder). Completing a reminder sets `completed_at`;
a recurring reminder generates its next occurrence on completion rather
than being deleted. Reminders due "today" surface on the Calendar's day
view alongside real Google events and Canvas tasks, giving one unified
daily view — only the Google-backed items are externally synced, Reminders
stay internal.

### Notes

Folder tree (`note_folders`) plus free-form tags. Rich text body stored as
structured JSON for consistent rendering and embedded checklist support.
Pinned notes float to the top. Full-text search across title + body.

### Journal

One `journal_entries` row per `(user_id, date)`, plain text. Reachable two
ways: (1) a dedicated Journal section listing past entries, most recent
first; (2) clicking a date in the Calendar's day-detail panel and pressing
a "Journal" button, which opens or creates that day's entry.

### Notifications

Web Push via a service worker; `push_subscriptions` holds one row per
device per user (phone and laptop each get their own subscription). A
scheduled job (every 5–15 minutes) checks for reminders, Canvas tasks, and
Google Calendar events whose lead time has arrived and pushes to all of
that user's subscribed devices. Lead time is configurable:

- **Reminders** and **Canvas tasks**: a per-item `notify_lead_minutes`
  override, falling back to a per-type default set in the user's Settings.
- **Calendar events**: no separate config — this app reuses the event's
  own Google Calendar reminder-override value as the push lead time, so
  there is a single place (the event itself) to manage it.

## Error handling & edge cases

- **Google token expiry/revocation**: a failed refresh shows a "reconnect
  Google" banner; Calendar-dependent features degrade, Reminders/Notes/
  Journal remain fully functional since they have no Google dependency.
- **Canvas token invalid/expired**: the sync job catches per-user failures
  without blocking other users' syncs; Settings shows a "reconnect Canvas"
  notice.
- **Canvas due date changes / assignment removed**: handled by the diffing
  logic in the sync job (update or delete the mapped Google Task).
- **Conflicting edits/recurrence changes made directly in Google Calendar**:
  no local conflict detection is attempted — Google Calendar is the source
  of truth, so this app simply reflects whatever Google returns.
- **Offline**: reads of Reminders/Notes/Journal may be cached by the
  service worker for offline viewing; writes while offline are
  unsupported in v1 to avoid sync-conflict complexity.

## Testing strategy

- **Unit tests**: recurrence rule expansion, notification lead-time
  calculation, Canvas sync diffing logic (create/update/delete decisions).
- **Integration tests**: API routes against a test database, with Google
  Calendar/Tasks and Canvas responses mocked — no real external calls or
  credentials required to run the suite.
- **Auth-boundary tests**: every data route must filter strictly by the
  session's `user_id`; given the multi-user design, this guards against
  any accidental cross-user data leak.
- **Manual verification**: real Google OAuth consent, real push
  notification delivery, and a real Canvas sync run against a live Canvas
  account — done during initial implementation and whenever those
  integrations change, since they can't be fully simulated.
- No automated end-to-end browser suite in v1 (YAGNI for a personal tool;
  revisit if the open-source project gains contributors).
