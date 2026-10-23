"use server";

import { auth } from "../../auth";
import type { CalendarColorToken } from "../calendar-colors";
import { colorIdForToken } from "../calendar-event-colors";
import { createEvent, deleteEvent, updateEvent, type GoogleCalendarEventWrite } from "../google-calendar";
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
 * Updates an existing event. `scope` is accepted for forward compatibility
 * with recurring events (a later plan branches on it to decide whether to
 * patch a single instance, the whole series, or this-and-following), but
 * this task's non-recurring-aware implementation ignores it and always acts
 * directly on the given `eventId`.
 *
 * Unlike `createEventAction`, this builds its payload with `forUpdate: true`
 * so an explicit `colorToken: null` / `notifyMinutesBefore: null` /
 * `addGoogleMeet: false` actually *removes* the color, reminder, or Meet link
 * instead of being dropped from the PATCH body and silently preserved — see
 * `buildEventPayload`.
 */
export async function updateEventAction(
  input: EventActionInput & { eventId: string; scope?: RecurrenceEditScope },
): Promise<{ id: string }> {
  const accessToken = await requireGoogleAccessToken();

  const updated = await updateEvent(
    accessToken,
    input.calendarId,
    input.eventId,
    buildEventPayload(input, { forUpdate: true }),
  );

  return { id: updated.id };
}

/**
 * Deletes an event. `scope` is accepted for forward compatibility (see
 * `updateEventAction`) but ignored in this task's implementation — it always
 * deletes exactly the given `eventId`.
 */
export async function deleteEventAction(
  input: { calendarId: string; eventId: string; scope?: RecurrenceEditScope },
): Promise<void> {
  const accessToken = await requireGoogleAccessToken();

  await deleteEvent(accessToken, input.calendarId, input.eventId);
}
