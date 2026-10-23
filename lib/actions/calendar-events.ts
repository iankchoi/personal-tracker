"use server";

import { auth } from "../../auth";
import type { CalendarColorToken } from "../calendar-colors";
import { colorIdForToken } from "../calendar-event-colors";
import { createEvent, deleteEvent, updateEvent, type GoogleCalendarEvent } from "../google-calendar";
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
 */
function buildEventPayload(input: EventActionInput): Partial<GoogleCalendarEvent> {
  return {
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
 */
export async function updateEventAction(
  input: EventActionInput & { eventId: string; scope?: RecurrenceEditScope },
): Promise<{ id: string }> {
  const accessToken = await requireGoogleAccessToken();

  const updated = await updateEvent(accessToken, input.calendarId, input.eventId, buildEventPayload(input));

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
