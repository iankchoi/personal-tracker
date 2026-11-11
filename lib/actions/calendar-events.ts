"use server";

import { auth } from "../../auth";
import type { CalendarColorToken } from "../calendar-colors";
import { dayDelta, shiftDateString } from "../calendar-drag";
import { buildRRule, isFirstOccurrence, parseRRule, truncateRRuleBefore } from "../calendar-recurrence";
import { colorIdForToken, tokenForColorId } from "../calendar-event-colors";
import {
  createEvent,
  deleteEvent,
  getEvent,
  updateEvent,
  type GoogleCalendarEvent,
  type GoogleCalendarEventWrite,
} from "../google-calendar";
import { getGoogleAccessToken } from "../google-token";

export type RecurrenceEditScope = "this" | "all" | "following";

export type EventActionInput = {
  calendarId: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD when allDay
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  colorToken?: CalendarColorToken | null; // null/absent = no override
  notifyMinutesBefore?: number | null; // null = no reminder
  addGoogleMeet?: boolean;
  guestEmails?: string[];
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  recurrence?: string[]; // RRULE lines; absent = one-off
};

/**
 * Builds the Google Calendar event payload shared by create and update, per
 * the exact field-mapping rules in this plan's brief:
 * - `start`/`end` carry `date` for all-day events, `dateTime` otherwise.
 * - `colorId` is derived from `colorToken` via `colorIdForToken`, omitted when
 *   no token is given.
 * - `reminders` is a single popup override at `notifyMinutesBefore` minutes
 *   with `useDefault: false`, omitted entirely when there's no reminder.
 * - `attendees` is the plain `{ email }` shape Google expects.
 * - `conferenceData.createRequest` is only present when a Meet link is
 *   requested, keyed by a fresh random request id (Google uses this to
 *   dedupe retries of the same conference request).
 * - `recurrence` passes straight through untouched (this task's actions are
 *   deliberately recurrence-unaware; a later plan adds scope-aware editing).
 *
 * `forUpdate` switches on the one place create and update genuinely differ:
 * **clearing**. On a create, an absent optional field just means "this event
 * doesn't have one", and leaving it `undefined` (so `JSON.stringify` drops it)
 * is exactly right. On an update, `JSON.stringify` dropping the field makes
 * Google keep whatever was there before — so a caller explicitly passing
 * `colorToken: null` / `notifyMinutesBefore: null` / `addGoogleMeet: false`
 * would silently fail to remove anything. Under `forUpdate`, those three
 * explicit "none" values are therefore translated into values Google reads as
 * a removal:
 * - `colorToken === null` -> `colorId: null` (drop the per-event color
 *   override, falling back to the calendar's own color).
 * - `notifyMinutesBefore === null` -> `reminders: { useDefault: true }`.
 *   `EventActionInput` documents `null` as "no reminder", and reverting to the
 *   calendar's default reminder is the closest thing Google's API offers —
 *   there is no distinct "no reminder at all" state to patch to here.
 * - `addGoogleMeet === false` -> `conferenceData: null` (remove the Meet
 *   link). `updateEvent` appends `conferenceDataVersion=1` for this.
 *
 * An *absent* (`undefined`) field still means "don't mention it" on an update,
 * so a partial edit never clobbers fields the caller didn't supply.
 */
function buildEventPayload(
  input: EventActionInput,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): GoogleCalendarEventWrite {
  const payload: GoogleCalendarEventWrite = {
    summary: input.title,
    start: input.allDay ? { date: input.start } : { dateTime: input.start },
    end: input.allDay ? { date: input.end } : { dateTime: input.end },
    description: input.description,
    location: input.location,
    colorId: input.colorToken ? colorIdForToken(input.colorToken) : undefined,
    reminders:
      input.notifyMinutesBefore != null
        ? { useDefault: false, overrides: [{ method: "popup", minutes: input.notifyMinutesBefore }] }
        : undefined,
    attendees: input.guestEmails?.map((email) => ({ email })),
    conferenceData: input.addGoogleMeet ? { createRequest: { requestId: crypto.randomUUID() } } : undefined,
    guestsCanModify: input.guestsCanModify,
    guestsCanInviteOthers: input.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: input.guestsCanSeeOtherGuests,
    recurrence: input.recurrence,
  };

  if (!forUpdate) {
    return payload;
  }

  if (input.colorToken === null) {
    payload.colorId = null;
  }
  if (input.notifyMinutesBefore === null) {
    payload.reminders = { useDefault: true };
  }
  if (input.addGoogleMeet === false) {
    payload.conferenceData = null;
  }

  return payload;
}

/**
 * Resolves the signed-in user's Google access token, the same chokepoint
 * `app/(app)/calendar/page.tsx` already uses. Throws if the user isn't
 * signed in or Google access needs reconnecting — server actions have no
 * request/response to attach a reconnect banner to, so callers are expected
 * to surface the thrown error instead.
 */
async function requireGoogleAccessToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Not signed in");
  }

  const tokenResult = await getGoogleAccessToken(session.user.id);
  if (tokenResult.needsGoogleReconnect) {
    throw new Error("Google access needs to be reconnected");
  }

  return tokenResult.accessToken;
}

export async function createEventAction(input: EventActionInput): Promise<{ id: string; calendarId: string }> {
  const accessToken = await requireGoogleAccessToken();

  const created = await createEvent(accessToken, input.calendarId, buildEventPayload(input));

  return { id: created.id, calendarId: created.calendarId };
}

/**
 * The widened input shared by `updateEventAction`/`deleteEventAction` once
 * `scope` actually does something: `recurringEventId` is the series' master
 * id (when the caller already knows it — e.g. the occurrence came straight
 * off a `GoogleCalendarEvent` with its own `recurringEventId`), and
 * `occurrenceOriginalStart`/`occurrenceOriginalEnd` are the *pre-edit*
 * start/end of the specific occurrence being acted on — needed to compute the
 * "all" scope's shift delta and to tell, via `isFirstOccurrence`, whether a
 * "following" edit actually covers the whole series.
 */
type ScopedActionFields = {
  scope?: RecurrenceEditScope;
  recurringEventId?: string;
  occurrenceOriginalStart?: string;
  occurrenceOriginalEnd?: string;
};

/** Parses a bare `YYYY-MM-DD` string the same way `shiftDateString` does, for `dayDelta`. */
function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The recurring series' master id: the caller's own id when it's already the master (no `recurringEventId` given), otherwise the given master id. */
function resolveMasterId(input: { eventId: string; recurringEventId?: string }): string {
  return input.recurringEventId ?? input.eventId;
}

/** Throws a clear error instead of letting a missing `occurrenceOriginalStart` silently produce a `NaN`-laced write. */
function requireOccurrenceOriginalStart(input: { occurrenceOriginalStart?: string }, scope: RecurrenceEditScope): string {
  if (!input.occurrenceOriginalStart) {
    throw new Error(`occurrenceOriginalStart is required for scope "${scope}"`);
  }
  return input.occurrenceOriginalStart;
}

/** Throws a clear error instead of letting a missing `occurrenceOriginalEnd` silently produce a `NaN`-laced write. */
function requireOccurrenceOriginalEnd(input: { occurrenceOriginalEnd?: string }, scope: RecurrenceEditScope): string {
  if (!input.occurrenceOriginalEnd) {
    throw new Error(`occurrenceOriginalEnd is required for scope "${scope}"`);
  }
  return input.occurrenceOriginalEnd;
}

/**
 * Computes the master's shifted `start`/`end` for a "whole series" edit.
 * `start` and `end` each shift by their *own* independent delta (occurrence's
 * original start -> new start, and separately original end -> new end), not
 * a single delta applied to both — a pure resize (only the end moves) must
 * still shift the master's end, even though its start delta is zero.
 *
 * Timed events shift by an absolute-instant millisecond delta (so the
 * master's own UTC offset is honored correctly); all-day events shift by a
 * whole-day delta via `dayDelta`/`shiftDateString` (the same helpers Month
 * view's day-chip drag uses), since a `date`-only field has no time-of-day to
 * do instant math against.
 */
function shiftMasterTimes(
  master: GoogleCalendarEvent,
  input: { allDay: boolean; start: string; end: string; occurrenceOriginalStart: string; occurrenceOriginalEnd: string },
): { start: GoogleCalendarEventWrite["start"]; end: GoogleCalendarEventWrite["end"] } {
  if (input.allDay) {
    const startDelta = dayDelta(parseDateOnly(input.occurrenceOriginalStart), parseDateOnly(input.start));
    const endDelta = dayDelta(parseDateOnly(input.occurrenceOriginalEnd), parseDateOnly(input.end));
    return {
      start: { date: shiftDateString(master.start.date as string, startDelta) },
      end: { date: shiftDateString(master.end.date as string, endDelta) },
    };
  }

  const startDelta = new Date(input.start).getTime() - new Date(input.occurrenceOriginalStart).getTime();
  const endDelta = new Date(input.end).getTime() - new Date(input.occurrenceOriginalEnd).getTime();
  return {
    start: { dateTime: new Date(new Date(master.start.dateTime as string).getTime() + startDelta).toISOString() },
    end: { dateTime: new Date(new Date(master.end.dateTime as string).getTime() + endDelta).toISOString() },
  };
}

/** Applies `transform` to the one entry of a Google `recurrence` array that is the RRULE line, leaving every other line (EXDATE, RDATE, EXRULE, ...) unchanged and in its original position. */
function mapRRuleLine(recurrence: string[], transform: (rruleLine: string) => string): string[] {
  return recurrence.map((line) => (line.startsWith("RRULE:") ? transform(line) : line));
}

/**
 * When a whole-series edit (`"all"`, or `"following"` collapsing onto it)
 * shifts the master onto a different day of the week, a `WEEKLY` rule's
 * `BYDAY` has to follow — otherwise Google keeps generating occurrences on
 * the old weekday forever. Returns the master's `recurrence` with its RRULE
 * line's `BYDAY` corrected via a `parseRRule`/`buildRRule` round-trip against
 * the new start day, or `undefined` when there's nothing to correct (the
 * caller explicitly supplied its own `recurrence`, the master has none, or
 * the weekday didn't actually change) — `undefined` here means "don't
 * override `buildEventPayload`'s own `recurrence` handling", not "clear it".
 */
function wholeSeriesRecurrenceOverride(
  master: GoogleCalendarEvent,
  input: { allDay: boolean; recurrence?: string[] },
  shiftedStart: GoogleCalendarEventWrite["start"],
): string[] | undefined {
  if (input.recurrence !== undefined || !master.recurrence) {
    return undefined;
  }

  const oldStartDay = input.allDay
    ? parseDateOnly(master.start.date as string)
    : new Date(master.start.dateTime as string);
  const newStartDay = input.allDay
    ? parseDateOnly(shiftedStart?.date as string)
    : new Date(shiftedStart?.dateTime as string);

  if (oldStartDay.getDay() === newStartDay.getDay()) {
    return undefined;
  }

  return mapRRuleLine(master.recurrence, (line) => {
    const rule = parseRRule(line);
    return rule.freq === "WEEKLY" ? buildRRule(rule, newStartDay) : line;
  });
}

/** PATCHes the master with the given input's other fields plus its shifted start/end (and corrected `BYDAY`, if the weekday moved) — the "all" scope's whole-series edit, also used by "following" when it collapses onto the series' first occurrence. */
async function patchWholeSeries(
  accessToken: string,
  input: EventActionInput & { calendarId: string; occurrenceOriginalStart: string; occurrenceOriginalEnd: string },
  masterId: string,
  master: GoogleCalendarEvent,
): Promise<{ id: string }> {
  const shifted = shiftMasterTimes(master, input);
  const recurrenceOverride = wholeSeriesRecurrenceOverride(master, input, shifted.start);
  const updated = await updateEvent(accessToken, input.calendarId, masterId, {
    ...buildEventPayload(input, { forUpdate: true }),
    start: shifted.start,
    end: shifted.end,
    ...(recurrenceOverride !== undefined ? { recurrence: recurrenceOverride } : {}),
  });
  return { id: updated.id };
}

/**
 * Backfills the four fields `EventEditor`/drag call sites document as
 * destructive to resend untouched (see `withoutEventClobberFields` in
 * `lib/calendar-drag.ts`): `colorToken`/`notifyMinutesBefore`/`addGoogleMeet`/
 * `guestEmails` left `undefined` on `input` mean "don't touch this" on a
 * PATCH, but mean "this event doesn't have one" on a CREATE. The "following"
 * split's new series is a CREATE, so any of those four left `undefined` is
 * read from the master's own *current* value instead, so a dragged recurring
 * event doesn't drop its color, reminder, Meet link, or guests the moment it
 * splits onto a new series.
 */
function backfillFromMasterForCreate(input: EventActionInput, master: GoogleCalendarEvent): EventActionInput {
  return {
    ...input,
    colorToken: input.colorToken === undefined ? tokenForColorId(master.colorId) : input.colorToken,
    notifyMinutesBefore:
      input.notifyMinutesBefore === undefined
        ? master.reminders?.overrides?.[0]?.minutes ?? null
        : input.notifyMinutesBefore,
    addGoogleMeet:
      input.addGoogleMeet === undefined
        ? Boolean(master.conferenceData?.entryPoints?.length)
        : input.addGoogleMeet,
    guestEmails:
      input.guestEmails === undefined ? master.attendees?.map((attendee) => attendee.email) ?? [] : input.guestEmails,
  };
}

/**
 * Updates an existing event, scope-aware:
 * - `"this"` (or no scope at all) patches exactly `input.eventId`, as before.
 * - `"all"` resolves the series' master (`recurringEventId` if given,
 *   otherwise `eventId` itself is already the master) and PATCHes *it*,
 *   shifting its start/end by `start`'s and `end`'s own independent deltas
 *   (so a pure resize moves only the end) — every occurrence in the series
 *   moves together. If the shift lands the master on a different weekday, a
 *   `WEEKLY` rule's `BYDAY` is corrected to match (`wholeSeriesRecurrenceOverride`).
 * - `"following"` resolves the master the same way. If this occurrence is the
 *   series' very first (`isFirstOccurrence`), there's nothing "before" it to
 *   keep on the old pattern, so it collapses onto exactly the `"all"` logic
 *   above. Otherwise it splits the series: a brand new series is *created*
 *   first, starting from this occurrence's new start/end, and only once that
 *   succeeds is the old master's `recurrence` truncated to end the day before
 *   this occurrence (preserving every non-RRULE line — `EXDATE`, `RDATE`,
 *   `EXRULE` — untouched via `mapRRuleLine`). Create-then-truncate, not the
 *   other way around, so a failure between the two steps leaves a harmless
 *   duplicate (the old series still running through its original end) rather
 *   than a permanently truncated series with nothing to replace it. The new
 *   series' `recurrence` depends on whether `input.recurrence` was touched:
 *   left `undefined` (Repeat untouched) continues the master's own original,
 *   untruncated rule; a non-empty array (a new rule was picked) is used as
 *   given; `[]` (Repeat explicitly cleared) means the new series has no
 *   `recurrence` field at all — a plain one-off, not an empty array. Building
 *   the new series via `buildEventPayload(input)` (not copying
 *   `master.conferenceData`) is what gives it a fresh Meet link rather than
 *   the old series' resolved one, whenever `addGoogleMeet` is set — and
 *   `backfillFromMasterForCreate` fills in color/reminder/Meet/guests from the
 *   master's current values for any of those four left `undefined` on
 *   `input` (the drag call sites' "don't touch this" convention, which would
 *   otherwise read as "this event doesn't have one" on this CREATE).
 *
 * Unlike `createEventAction`, every PATCH here builds its payload with
 * `forUpdate: true` so an explicit `colorToken: null` /
 * `notifyMinutesBefore: null` / `addGoogleMeet: false` actually *removes* the
 * color, reminder, or Meet link instead of being dropped from the PATCH body
 * and silently preserved — see `buildEventPayload`.
 */
export async function updateEventAction(
  input: EventActionInput & { eventId: string } & ScopedActionFields,
): Promise<{ id: string }> {
  const accessToken = await requireGoogleAccessToken();

  if (input.scope === "all") {
    const occurrenceOriginalStart = requireOccurrenceOriginalStart(input, "all");
    const occurrenceOriginalEnd = requireOccurrenceOriginalEnd(input, "all");
    const masterId = resolveMasterId(input);
    const master = await getEvent(accessToken, input.calendarId, masterId);
    return patchWholeSeries(accessToken, { ...input, occurrenceOriginalStart, occurrenceOriginalEnd }, masterId, master);
  }

  if (input.scope === "following") {
    const occurrenceOriginalStart = requireOccurrenceOriginalStart(input, "following");
    const occurrenceOriginalEnd = requireOccurrenceOriginalEnd(input, "following");
    const masterId = resolveMasterId(input);
    const master = await getEvent(accessToken, input.calendarId, masterId);

    if (isFirstOccurrence(master.start.dateTime ?? (master.start.date as string), occurrenceOriginalStart)) {
      return patchWholeSeries(accessToken, { ...input, occurrenceOriginalStart, occurrenceOriginalEnd }, masterId, master);
    }

    const newSeriesRecurrence =
      input.recurrence === undefined
        ? [master.recurrence![0]]
        : input.recurrence.length > 0
          ? input.recurrence
          : undefined;

    // Create the new series first: if a failure happens after this, the old
    // series is still intact (a harmless duplicate running through its
    // original end) rather than permanently truncated with nothing to
    // replace it.
    const created = await createEvent(
      accessToken,
      input.calendarId,
      buildEventPayload(backfillFromMasterForCreate({ ...input, recurrence: newSeriesRecurrence }, master)),
    );

    await updateEvent(accessToken, input.calendarId, masterId, {
      recurrence: mapRRuleLine(master.recurrence ?? [], (line) =>
        truncateRRuleBefore(line, new Date(occurrenceOriginalStart)),
      ),
    });

    return { id: created.id };
  }

  const updated = await updateEvent(
    accessToken,
    input.calendarId,
    input.eventId,
    buildEventPayload(input, { forUpdate: true }),
  );

  return { id: updated.id };
}

/**
 * Deletes an event, scope-aware:
 * - `"this"` (or no scope at all) deletes exactly `input.eventId`, as before.
 * - `"all"` resolves the series' master the same way `updateEventAction` does
 *   and deletes *it* instead, removing the whole series.
 * - `"following"` resolves the master and reads its current `recurrence[0]`.
 *   If this occurrence is the series' first (`isFirstOccurrence`), there's
 *   nothing "before" it to keep, so it deletes the whole master exactly like
 *   `"all"`. Otherwise it truncates the master's `recurrence` to end the day
 *   before this occurrence, leaving everything else about the master
 *   untouched — no series or occurrence is actually deleted in that case.
 */
export async function deleteEventAction(
  input: { calendarId: string; eventId: string } & Omit<ScopedActionFields, "occurrenceOriginalEnd">,
): Promise<void> {
  const accessToken = await requireGoogleAccessToken();

  if (input.scope === "all") {
    const masterId = resolveMasterId(input);
    await deleteEvent(accessToken, input.calendarId, masterId);
    return;
  }

  if (input.scope === "following") {
    const occurrenceOriginalStart = requireOccurrenceOriginalStart(input, "following");
    const masterId = resolveMasterId(input);
    const master = await getEvent(accessToken, input.calendarId, masterId);

    if (isFirstOccurrence(master.start.dateTime ?? (master.start.date as string), occurrenceOriginalStart)) {
      await deleteEvent(accessToken, input.calendarId, masterId);
      return;
    }

    await updateEvent(accessToken, input.calendarId, masterId, {
      recurrence: mapRRuleLine(master.recurrence ?? [], (line) =>
        truncateRRuleBefore(line, new Date(occurrenceOriginalStart)),
      ),
    });
    return;
  }

  await deleteEvent(accessToken, input.calendarId, input.eventId);
}
