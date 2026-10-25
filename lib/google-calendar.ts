export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  backgroundColor: string;
  primary?: boolean;
  accessRole?: "owner" | "writer" | "reader" | "freeBusyReader";
};

export type GoogleCalendarEvent = {
  id: string;
  calendarId: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  recurringEventId?: string;
  recurrence?: string[];
  colorId?: string;
  location?: string;
  description?: string;
  attendees?: { email: string }[];
  conferenceData?: {
    createRequest?: { requestId: string };
    entryPoints?: { entryPointType: string; uri: string }[];
  };
  reminders?: {
    useDefault: boolean;
    overrides?: { method: "popup"; minutes: number }[];
  };
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  organizer?: { self?: boolean };
};

/**
 * Fetches the current user's list of calendars from Google's calendarList
 * endpoint. Thin REST wrapper: no caching, no color assignment, no layout
 * logic — just the HTTP call shape. Throws on a non-ok response.
 */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google calendarList request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { items: GoogleCalendarListEntry[] };
  return data.items;
}

/**
 * Narrows a calendar list down to the ones the user can actually write to —
 * `owner` or `writer` `accessRole`, or no `accessRole` at all (an older/
 * legacy calendarList entry that predates Google annotating this field,
 * treated as writable rather than excluded by default). Drops `reader` and
 * `freeBusyReader` entries (e.g. a read-only subscribed Holidays calendar).
 *
 * Used to scope the quick-create popup's calendar picker: offering a
 * read-only calendar there would let the user pick it and hit Save only to
 * get an unhelpful 403 back from Google.
 */
export function filterWritableCalendars(calendars: GoogleCalendarListEntry[]): GoogleCalendarListEntry[] {
  return calendars.filter(
    (calendar) => !calendar.accessRole || calendar.accessRole === "owner" || calendar.accessRole === "writer",
  );
}

/**
 * Fetches events for a single calendar within a time range. `singleEvents=true`
 * expands recurring events into concrete instances, and `orderBy=startTime`
 * returns them in chronological order. Google's response omits `calendarId`
 * on each item, so it is stamped on here before returning. Throws on a
 * non-ok response.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(`Google events request failed with status ${response.status}`);
  }

  const data = (await response.json()) as { items: Omit<GoogleCalendarEvent, "calendarId">[] };
  return data.items.map((item) => ({ ...item, calendarId }));
}

/**
 * The write-side shape of an event: `Partial<GoogleCalendarEvent>`, but with
 * `colorId`/`conferenceData` additionally allowed to be `null`.
 *
 * `undefined` and `null` mean different things to Google on a PATCH:
 * `JSON.stringify` drops an `undefined` field entirely, which Google reads as
 * "leave this alone", whereas an explicit `null` is what *clears* the field.
 * `updateEvent` needs to be able to express the latter (removing an event's
 * color override or its Meet link), so the payload type has to permit it.
 */
export type GoogleCalendarEventWrite = Partial<Omit<GoogleCalendarEvent, "colorId" | "conferenceData">> & {
  colorId?: string | null;
  conferenceData?: GoogleCalendarEvent["conferenceData"] | null;
};

/**
 * The query string every event write carries.
 *
 * `sendUpdates=all` is the whole point: Google's default for
 * `events.insert`/`patch`/`delete` is `sendUpdates=none`, so an event written
 * with `attendees` set *did* add the guests (they show up in Google Calendar's
 * own UI) but Google never emailed them an invite — the design's "guest invites
 * use the real mechanism… nothing to build beyond passing the right field" was
 * one query param short of true.
 *
 * It's unconditional rather than gated on `attendees` being present, because
 * Google accepts the parameter on any write and it costs nothing when there are
 * no guests to notify — whereas gating it would mean every new notification
 * path (adding a guest on an *edit*, deleting an event that has guests) had to
 * remember to re-derive the condition correctly. For a personal app where every
 * write should notify whoever is actually on the event, "always notify" is the
 * right default.
 *
 * Returned as `URLSearchParams` so callers that also need
 * `conferenceDataVersion=1` can just `set` it on top and serialize once, rather
 * than hand-splicing a second `?`-vs-`&` into the string.
 */
function eventWriteParams(): URLSearchParams {
  return new URLSearchParams({ sendUpdates: "all" });
}

/**
 * Creates a new event in the specified calendar. Always sends
 * `sendUpdates=all` (see `eventWriteParams`), and adds
 * `conferenceDataVersion=1` when the event includes
 * `conferenceData.createRequest`, as required by Google's API. Stamps
 * `calendarId` onto the returned object. Throws on a non-ok response.
 */
export async function createEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleCalendarEventWrite,
): Promise<GoogleCalendarEvent> {
  const params = eventWriteParams();

  if (event.conferenceData?.createRequest) {
    params.set("conferenceDataVersion", "1");
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Google createEvent request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Omit<GoogleCalendarEvent, "calendarId">;
  return { ...data, calendarId };
}

/**
 * Updates an existing event in the specified calendar. Stamps `calendarId`
 * onto the returned object. Throws on a non-ok response.
 *
 * Always sends `sendUpdates=all` (see `eventWriteParams`) so a guest added —
 * or removed — on an *edit* gets notified, not just one present at creation.
 *
 * Adds `conferenceDataVersion=1` whenever the patch mentions `conferenceData`
 * at all — matching `createEvent`'s conditional, but widened to cover an
 * explicit `null` as well, since Google requires that query param for *any*
 * conferenceData write, clearing a Meet link included. A patch that omits the
 * field entirely leaves it off.
 */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: GoogleCalendarEventWrite,
): Promise<GoogleCalendarEvent> {
  const params = eventWriteParams();

  if (patch.conferenceData !== undefined) {
    params.set("conferenceDataVersion", "1");
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params.toString()}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Google updateEvent request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Omit<GoogleCalendarEvent, "calendarId">;
  return { ...data, calendarId };
}

/**
 * Deletes an event from the specified calendar. Throws on a non-ok response.
 *
 * Also sends `sendUpdates=all` (see `eventWriteParams`), so deleting an event
 * with guests mails them Google's own cancellation notice instead of silently
 * vanishing from their calendars.
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${eventWriteParams().toString()}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google deleteEvent request failed with status ${response.status}`);
  }
}
