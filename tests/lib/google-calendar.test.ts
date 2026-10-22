import { afterEach, expect, test, vi } from "vitest";

import { listCalendars, listEvents } from "../../lib/google-calendar";

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
