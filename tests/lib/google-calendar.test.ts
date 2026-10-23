import { afterEach, expect, test, vi } from "vitest";

import { createEvent, deleteEvent, listCalendars, listEvents, updateEvent } from "../../lib/google-calendar";

/** The stubbed global `fetch`'s recorded calls, as `[url, init]` pairs. */
function fetchCalls(): [string, { body: string }][] {
  return (fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("listCalendars returns the user's calendars from Google's calendarList endpoint", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ id: "primary", summary: "Ian Choi", backgroundColor: "#3b6ea5", primary: true }] }),
  }));

  const result = await listCalendars("test-token");

  expect(result).toEqual([{ id: "primary", summary: "Ian Choi", backgroundColor: "#3b6ea5", primary: true }]);
  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
  );
});

test("listEvents stamps calendarId onto every returned event, since Google's response omits it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ id: "evt1", summary: "Team standup", start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T09:15:00-04:00" } }] }),
  }));

  const result = await listEvents("test-token", "primary", "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z");

  expect(result).toEqual([{
    id: "evt1", calendarId: "primary", summary: "Team standup",
    start: { dateTime: "2026-10-22T09:00:00-04:00" }, end: { dateTime: "2026-10-22T09:15:00-04:00" },
  }]);
});

test("listEvents throws a descriptive error on a non-ok response, rather than returning garbage", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

  await expect(listEvents("bad-token", "primary", "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z")).rejects.toThrow();
});

test("createEvent POSTs to the calendar's events endpoint and returns the created event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "new1",
      summary: "Standup",
      start: { dateTime: "2026-10-22T09:00:00-04:00" },
      end: { dateTime: "2026-10-22T10:00:00-04:00" },
    }),
  }));

  const result = await createEvent("tok", "primary", {
    summary: "Standup",
    start: { dateTime: "2026-10-22T09:00:00-04:00" },
    end: { dateTime: "2026-10-22T10:00:00-04:00" },
  });

  expect(result.calendarId).toBe("primary");
  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    expect.objectContaining({ method: "POST" }),
  );
});

test("createEvent requests conferenceDataVersion=1 when conferenceData.createRequest is set", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "new2",
      summary: "Video call",
      start: { dateTime: "2026-10-22T09:00:00-04:00" },
      end: { dateTime: "2026-10-22T10:00:00-04:00" },
      conferenceData: { createRequest: { requestId: "req1" } },
    }),
  }));

  await createEvent("tok", "primary", {
    summary: "Video call",
    start: { dateTime: "2026-10-22T09:00:00-04:00" },
    end: { dateTime: "2026-10-22T10:00:00-04:00" },
    conferenceData: { createRequest: { requestId: "req1" } },
  });

  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    expect.objectContaining({ method: "POST" }),
  );
});

test("updateEvent PATCHes the specific event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "evt1",
      summary: "Updated standup",
      start: { dateTime: "2026-10-22T09:30:00-04:00" },
      end: { dateTime: "2026-10-22T10:00:00-04:00" },
    }),
  }));

  const result = await updateEvent("tok", "primary", "evt1", {
    summary: "Updated standup",
    start: { dateTime: "2026-10-22T09:30:00-04:00" },
  });

  expect(result.calendarId).toBe("primary");
  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt1",
    expect.objectContaining({ method: "PATCH" }),
  );
});

test("updateEvent requests conferenceDataVersion=1 when clearing conferenceData with an explicit null", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "evt1", summary: "No more Meet" }),
  }));

  // Google requires conferenceDataVersion=1 for any conferenceData write,
  // including removing an existing Meet link.
  await updateEvent("tok", "primary", "evt1", { conferenceData: null });

  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt1?conferenceDataVersion=1",
    expect.objectContaining({ method: "PATCH" }),
  );
  expect(JSON.parse(fetchCalls()[0][1].body).conferenceData).toBeNull();
});

test("updateEvent requests conferenceDataVersion=1 when setting conferenceData.createRequest", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "evt1" }),
  }));

  await updateEvent("tok", "primary", "evt1", { conferenceData: { createRequest: { requestId: "req-1" } } });

  expect(fetchCalls()[0][0]).toContain("conferenceDataVersion=1");
});

test("updateEvent omits conferenceDataVersion when the patch doesn't mention conferenceData", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "evt1", summary: "Renamed" }),
  }));

  await updateEvent("tok", "primary", "evt1", { summary: "Renamed" });

  expect(fetchCalls()[0][0]).not.toContain("conferenceDataVersion");
});

test("deleteEvent DELETEs the specific event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

  await deleteEvent("tok", "primary", "evt1");

  expect(fetch).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt1",
    expect.objectContaining({ method: "DELETE" }),
  );
});

test("deleteEvent throws on a non-ok response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

  await expect(deleteEvent("tok", "primary", "evt1")).rejects.toThrow();
});
