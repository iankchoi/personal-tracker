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
 * Creates a new event in the specified calendar. If the event includes
 * `conferenceData.createRequest`, appends `conferenceDataVersion=1` to the
 * request URL as required by Google's API. Stamps `calendarId` onto the
 * returned object. Throws on a non-ok response.
 */
export async function createEvent(
  accessToken: string,
  calendarId: string,
  event: Partial<GoogleCalendarEvent>,
): Promise<GoogleCalendarEvent> {
  let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  if (event.conferenceData?.createRequest) {
    url += "?conferenceDataVersion=1";
  }

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
 */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Partial<GoogleCalendarEvent>,
): Promise<GoogleCalendarEvent> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

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
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

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
