# Personal Tracker

A self-hostable, open-source personal productivity hub that unifies Google
Calendar, Canvas assignment due dates, Reminders, Notes, and a daily
Journal — all in one app.

## Status

🚧 In design/planning phase. See the
[design spec](docs/superpowers/specs/2026-10-21-personal-tracker-design.md)
for the full architecture and feature plan. Implementation hasn't started
yet.

## Features (planned)

- **Calendar** — a live client of your real Google Calendar (not a copy):
  multiple calendars, colors, recurring events, Day/Week/Month/Agenda
  views, and inviting others.
- **Canvas** — read-only sync of assignment due dates into Google Tasks,
  with the full due date *and time* shown in the app (Google Tasks itself
  only supports a date). Automatically marks a task complete once you
  submit the assignment on Canvas.
- **Reminders** — due dates/times with push notifications, lists/
  categories, recurring reminders, priority levels, and subtasks.
- **Notes** — folders, tags, rich text, embedded checklists, pinning, and
  full-text search.
- **Journal** — one plain-text entry per day, reachable from a dedicated
  section or from the calendar's day view.

## Tech stack

- Next.js (App Router), deployed on Vercel
- Postgres (e.g. via the Vercel Marketplace / Neon)
- Auth.js with Google OAuth (also grants Calendar + Tasks API access)
- Google Calendar API, Google Tasks API, Canvas REST API
- Web Push for notifications

## Self-hosting

This is a self-hosted app, not a shared multi-tenant SaaS — each person
deploys their own instance with their own Google OAuth client credentials
and database. Setup instructions will be added here once the initial
implementation lands.

## License

MIT — see [LICENSE](LICENSE).
