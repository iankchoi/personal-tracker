export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  backgroundColor: string;
  primary?: boolean;
};

export type GoogleCalendarEvent = {
  id: string;
  calendarId: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
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
