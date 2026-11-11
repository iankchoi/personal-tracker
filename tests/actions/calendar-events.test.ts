import { beforeEach, expect, test, vi } from "vitest";

const { mockAuth, mockGetGoogleAccessToken, mockCreateEvent, mockUpdateEvent, mockDeleteEvent, mockGetEvent } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockGetGoogleAccessToken: vi.fn(),
    mockCreateEvent: vi.fn(),
    mockUpdateEvent: vi.fn(),
    mockDeleteEvent: vi.fn(),
    mockGetEvent: vi.fn(),
  }));

vi.mock("../../auth", () => ({ auth: mockAuth }));
vi.mock("../../lib/google-token", () => ({ getGoogleAccessToken: mockGetGoogleAccessToken }));
vi.mock("../../lib/google-calendar", () => ({
  createEvent: mockCreateEvent,
  updateEvent: mockUpdateEvent,
  deleteEvent: mockDeleteEvent,
  getEvent: mockGetEvent,
}));

import { colorIdForToken } from "../../lib/calendar-event-colors";
import { truncateRRuleBefore } from "../../lib/calendar-recurrence";
import {
  createEventAction,
  deleteEventAction,
  updateEventAction,
  type EventActionInput,
} from "../../lib/actions/calendar-events";

function baseInput(overrides: Partial<EventActionInput> = {}): EventActionInput {
  return {
    calendarId: "primary",
    title: "Standup",
    start: "2026-10-22T09:00:00-04:00",
    end: "2026-10-22T09:30:00-04:00",
    allDay: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue({ user: { id: "user-1", needsGoogleReconnect: false } });
  mockGetGoogleAccessToken.mockReset().mockResolvedValue({ accessToken: "test-token", needsGoogleReconnect: false });
  mockCreateEvent.mockReset();
  mockUpdateEvent.mockReset();
  mockDeleteEvent.mockReset();
  mockGetEvent.mockReset();
});

test("createEventAction builds the Google event payload from the input and returns its id", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  const input = baseInput();
  const result = await createEventAction(input);

  expect(result).toEqual({ id: "evt1", calendarId: "primary" });
  expect(mockGetGoogleAccessToken).toHaveBeenCalledWith("user-1");
  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token",
    "primary",
    expect.objectContaining({
      summary: "Standup",
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    }),
  );
});

test("createEventAction uses date-only start/end when allDay is true", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt2", calendarId: "primary" });

  await createEventAction(baseInput({ allDay: true, start: "2026-10-22", end: "2026-10-23" }));

  const payload = mockCreateEvent.mock.calls[0][2];
  expect(payload.start).toEqual({ date: "2026-10-22" });
  expect(payload.end).toEqual({ date: "2026-10-23" });
  expect(payload.start.dateTime).toBeUndefined();
  expect(payload.end.dateTime).toBeUndefined();
});

test("createEventAction maps colorToken to colorId and omits colorId when colorToken is absent", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt3", calendarId: "primary" });
  await createEventAction(baseInput({ colorToken: "cv" }));
  expect(mockCreateEvent.mock.calls[0][2].colorId).toBe(colorIdForToken("cv"));

  mockCreateEvent.mockClear();
  mockCreateEvent.mockResolvedValue({ id: "evt4", calendarId: "primary" });
  await createEventAction(baseInput());
  expect(mockCreateEvent.mock.calls[0][2].colorId).toBeUndefined();
});

test("createEventAction sets reminders.overrides from notifyMinutesBefore, and useDefault:false", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt5", calendarId: "primary" });

  await createEventAction(baseInput({ notifyMinutesBefore: 10 }));

  expect(mockCreateEvent.mock.calls[0][2].reminders).toEqual({
    useDefault: false,
    overrides: [{ method: "popup", minutes: 10 }],
  });
});

test("createEventAction omits reminders when notifyMinutesBefore is null", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt6", calendarId: "primary" });

  await createEventAction(baseInput({ notifyMinutesBefore: null }));

  expect(mockCreateEvent.mock.calls[0][2].reminders).toBeUndefined();
});

test("createEventAction sets attendees from guestEmails and the three guest-permission flags", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt7", calendarId: "primary" });

  await createEventAction(
    baseInput({
      guestEmails: ["a@example.com", "b@example.com"],
      guestsCanModify: true,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: true,
    }),
  );

  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token",
    "primary",
    expect.objectContaining({
      attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
      guestsCanModify: true,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: true,
    }),
  );
});

test("createEventAction requests a Google Meet link when addGoogleMeet is true", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt8", calendarId: "primary" });

  await createEventAction(baseInput({ addGoogleMeet: true }));

  const payload = mockCreateEvent.mock.calls[0][2];
  expect(typeof payload.conferenceData.createRequest.requestId).toBe("string");
  expect(payload.conferenceData.createRequest.requestId.length).toBeGreaterThan(0);
});

test("createEventAction omits conferenceData when addGoogleMeet is false or absent", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt8b", calendarId: "primary" });

  await createEventAction(baseInput());

  expect(mockCreateEvent.mock.calls[0][2].conferenceData).toBeUndefined();
});

test("createEventAction passes recurrence through unmodified", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt9", calendarId: "primary" });
  const recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];

  await createEventAction(baseInput({ recurrence }));

  expect(mockCreateEvent.mock.calls[0][2].recurrence).toBe(recurrence);
});

test("createEventAction passes description and location through", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evt10", calendarId: "primary" });

  await createEventAction(baseInput({ description: "Weekly sync", location: "Room 2" }));

  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token",
    "primary",
    expect.objectContaining({ description: "Weekly sync", location: "Room 2" }),
  );
});

test("updateEventAction calls updateEvent with the given eventId when scope is absent", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  const result = await updateEventAction({ ...baseInput(), eventId: "evt1" });

  expect(result).toEqual({ id: "evt1" });
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token",
    "primary",
    "evt1",
    expect.objectContaining({ summary: "Standup" }),
  );
});

test("updateEventAction sends colorId: null when colorToken is explicitly null, so the override is cleared", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput({ colorToken: null }), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].colorId).toBeNull();
});

test("updateEventAction omits colorId when colorToken is absent, leaving the existing color untouched", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput(), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].colorId).toBeUndefined();
});

test("updateEventAction sends reminders: { useDefault: true } when notifyMinutesBefore is explicitly null", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput({ notifyMinutesBefore: null }), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].reminders).toEqual({ useDefault: true });
});

test("updateEventAction omits reminders when notifyMinutesBefore is absent", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput(), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].reminders).toBeUndefined();
});

test("updateEventAction sends conferenceData: null when addGoogleMeet is explicitly false", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput({ addGoogleMeet: false }), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].conferenceData).toBeNull();
});

test("updateEventAction omits conferenceData when addGoogleMeet is absent, keeping any existing Meet link", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  await updateEventAction({ ...baseInput(), eventId: "evt1" });

  expect(mockUpdateEvent.mock.calls[0][3].conferenceData).toBeUndefined();
});

test("deleteEventAction calls deleteEvent with the given calendarId and eventId when scope is absent", async () => {
  mockDeleteEvent.mockResolvedValue(undefined);

  await deleteEventAction({ calendarId: "primary", eventId: "evt1" });

  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "evt1");
});

test("updateEventAction with scope 'this' patches exactly the given eventId, same as no scope at all", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "occ1", calendarId: "primary" });
  await updateEventAction({ ...baseInput(), eventId: "occ1", scope: "this" });
  expect(mockUpdateEvent).toHaveBeenCalledWith("test-token", "primary", "occ1", expect.anything());
});

test("deleteEventAction with scope 'this' deletes exactly the given eventId", async () => {
  await deleteEventAction({ calendarId: "primary", eventId: "occ1", scope: "this" });
  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "occ1");
});

test("updateEventAction with scope 'all' resolves the master via recurringEventId and PATCHes it instead", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockGetEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
  // Master is stored at -05:00 (09:00/09:30 local = 14:00/14:30 UTC); the
  // drag's delta is +1 hour (09:00 -> 10:00 local on the occurrence);
  // applying that same +1h delta to the master's absolute instant gives
  // 15:00/15:30 UTC.
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({
      start: { dateTime: "2026-11-11T15:00:00.000Z" },
      end: { dateTime: "2026-11-11T15:30:00.000Z" },
    }),
  );
});

test("updateEventAction with scope 'all' on an all-day event shifts the master's date fields by the same day delta", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { date: "2026-11-11" }, end: { date: "2026-11-12" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ allDay: true, start: "2026-11-26", end: "2026-11-27" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25", occurrenceOriginalEnd: "2026-11-26",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ start: { date: "2026-11-12" }, end: { date: "2026-11-13" } }),
  );
});

test("updateEventAction with scope 'all' and no recurringEventId treats the given eventId as the master itself", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-11T09:00:00-05:00", end: "2026-11-11T09:30:00-05:00" }),
    eventId: "master1", scope: "all",
    occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
  });

  expect(mockGetEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
});

test("deleteEventAction with scope 'all' resolves the master via recurringEventId and deletes it instead", async () => {
  await deleteEventAction({
    calendarId: "primary", eventId: "occ3", scope: "all", recurringEventId: "master1",
  });

  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
});

test("deleteEventAction with scope 'following' truncates the master's RRULE instead of deleting anything", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });

  await deleteEventAction({
    calendarId: "primary", eventId: "occ3", scope: "following",
    recurringEventId: "master1", occurrenceOriginalStart: "2026-11-25T09:00:00-05:00",
  });

  expect(mockDeleteEvent).not.toHaveBeenCalled();
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date("2026-11-25T09:00:00-05:00"))] }),
  );
});

test("deleteEventAction with scope 'following' on the series' first occurrence deletes the whole master instead", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });

  await deleteEventAction({
    calendarId: "primary", eventId: "occ1", scope: "following",
    recurringEventId: "master1", occurrenceOriginalStart: "2026-11-11T09:00:00-05:00",
  });

  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "master1");
  expect(mockUpdateEvent).not.toHaveBeenCalled();
});

test("updateEventAction with scope 'following' truncates the old series and creates a new one from this occurrence", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", summary: "Standup",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  const result = await updateEventAction({
    ...baseInput({ title: "Standup (longer)", start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date("2026-11-25T09:00:00-05:00"))] }),
  );
  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({
      summary: "Standup (longer)",
      start: { dateTime: "2026-11-25T10:00:00-05:00" },
      end: { dateTime: "2026-11-25T10:30:00-05:00" },
      // The master's rule had no BYDAY at all, which `correctWeeklyByDay`
      // treats as round-trippable — it now gets an explicit BYDAY matching
      // this occurrence's own weekday (Wednesday), rather than being copied
      // verbatim with no weekday pinned down at all.
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    }),
  );
  expect(result).toEqual({ id: "newseries1" });
});

test("updateEventAction with scope 'following' on the series' first occurrence behaves exactly like scope 'all'", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-11T10:00:00-05:00", end: "2026-11-11T10:30:00-05:00" }),
    eventId: "occ1", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
  });

  expect(mockCreateEvent).not.toHaveBeenCalled();
  expect(mockUpdateEvent).toHaveBeenCalledWith("test-token", "primary", "master1", expect.anything());
});

test("updateEventAction with scope 'following' mints a fresh Meet request for the new series rather than copying the master's resolved conferenceData", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/old-link" }] },
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ addGoogleMeet: true, start: "2026-11-25T09:00:00-05:00", end: "2026-11-25T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.conferenceData).toEqual({ createRequest: { requestId: expect.any(String) } });
});

test("updateEventAction with scope 'following' and recurrence explicitly cleared creates a plain one-off with no recurrence field, not a new series", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "oneoff1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ recurrence: [], start: "2026-11-25T09:00:00-05:00", end: "2026-11-25T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.recurrence).toBeUndefined();
});

// --- Review fix round: Critical 1 — independent start/end deltas on scope "all" ---

test("updateEventAction with scope 'all' shifts the master's end independently when only the end moves (a pure resize)", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  // start unchanged (delta 0), end moved by +30 minutes.
  await updateEventAction({
    ...baseInput({ start: "2026-11-25T09:00:00-05:00", end: "2026-11-25T10:00:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({
      start: { dateTime: "2026-11-11T14:00:00.000Z" }, // unchanged
      end: { dateTime: "2026-11-11T15:00:00.000Z" }, // +30 minutes
    }),
  );
});

// --- Review fix round: Critical 2 — backfill color/reminders/Meet/guests on the "following" split's new series ---

test("updateEventAction with scope 'following' backfills color/reminders/Meet/guests from the master when the (drag-shaped) input leaves them undefined", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", summary: "Standup",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
    colorId: colorIdForToken("wk"),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/old-link" }] },
    attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  // baseInput() already leaves colorToken/notifyMinutesBefore/addGoogleMeet/guestEmails
  // undefined — the same shape `withoutEventClobberFields` sends from a real drag.
  await updateEventAction({
    ...baseInput({ start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.colorId).toBe(colorIdForToken("wk"));
  expect(createdPayload.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 15 }] });
  expect(createdPayload.conferenceData).toEqual({ createRequest: { requestId: expect.any(String) } });
  expect(createdPayload.attendees).toEqual([{ email: "a@example.com" }, { email: "b@example.com" }]);
});

// --- Review fix round: Important 3 — presence guard for occurrenceOriginalStart ---

test("updateEventAction with scope 'all' and no occurrenceOriginalStart throws clearly instead of computing a NaN-laced shift", async () => {
  await expect(
    updateEventAction({ ...baseInput(), eventId: "occ3", scope: "all", recurringEventId: "master1" }),
  ).rejects.toThrow(/occurrenceOriginalStart/);

  expect(mockGetEvent).not.toHaveBeenCalled();
  expect(mockUpdateEvent).not.toHaveBeenCalled();
});

// --- Review fix round: Important 4 — truncate preserves non-RRULE recurrence lines ---

test("deleteEventAction with scope 'following' preserves a non-RRULE line (e.g. EXDATE) when truncating the RRULE line", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary", start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["EXDATE:20261118T140000Z", "RRULE:FREQ=WEEKLY"],
  });

  await deleteEventAction({
    calendarId: "primary", eventId: "occ3", scope: "following",
    recurringEventId: "master1", occurrenceOriginalStart: "2026-11-25T09:00:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({
      recurrence: ["EXDATE:20261118T140000Z", truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date("2026-11-25T09:00:00-05:00"))],
    }),
  );
});

// --- Review fix round: Important 5 — BYDAY follows a weekday-changing shift ---

test("updateEventAction with scope 'all' updates the RRULE's BYDAY when the shift moves the master onto a different weekday", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    // 2026-11-11 is a Wednesday.
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  // Shifted from Wednesday 2026-11-25 to Thursday 2026-11-26 — a day later.
  await updateEventAction({
    ...baseInput({ start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T09:30:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] }),
  );
});

// --- Review fix round: Important 7 — create the new series before truncating the old one ---

test("updateEventAction with scope 'following' creates the new series before truncating the old one", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-25T10:00:00-05:00", end: "2026-11-25T10:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockCreateEvent.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateEvent.mock.invocationCallOrder[0]);
});

// --- Final review fix round: Critical 1/2, Important I1 — shared BYDAY-correction helper ---

test("updateEventAction with scope 'following' corrects the new series' BYDAY when dragged onto a different weekday (not the first occurrence)", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    // 2026-11-11 is a Wednesday.
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  // 2026-11-25 (occurrence, Wednesday) is not the master's first occurrence
  // (2026-11-11); dragged one day later, onto Thursday 2026-11-26.
  await updateEventAction({
    ...baseInput({ start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] }),
  );
});

test("updateEventAction with scope 'all' leaves a multi-weekday BYDAY rule completely unchanged when dragged to a different weekday", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T09:30:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token", "primary", "master1",
    expect.objectContaining({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"] }),
  );
});

test("updateEventAction with scope 'following' leaves a multi-weekday BYDAY rule unchanged in the new series (not collapsed to one day)", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({ start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"] }),
  );
});

test("updateEventAction with scope 'following' finds the RRULE line correctly even when it's not at index 0 (an EXDATE precedes it)", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["EXDATE:20261118T140000Z", "RRULE:FREQ=WEEKLY;BYDAY=WE"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  // Not the first occurrence; dragged onto Thursday. Before the fix, this
  // path naively took `master.recurrence[0]` as "the RRULE line" — which
  // here is actually the EXDATE line.
  await updateEventAction({
    ...baseInput({ start: "2026-11-26T09:00:00-05:00", end: "2026-11-26T09:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({
      recurrence: ["EXDATE:20261118T140000Z", "RRULE:FREQ=WEEKLY;BYDAY=TH"],
    }),
  );
});

// --- Final review fix round: Important I2 — recurring writes carry a timeZone ---

test("createEventAction sets start.timeZone/end.timeZone when recurrence is non-empty, and omits the key entirely when there's no recurrence", async () => {
  mockCreateEvent.mockResolvedValue({ id: "evtTz1", calendarId: "primary" });
  await createEventAction(
    baseInput({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"], timeZone: "America/New_York" }),
  );
  const recurringPayload = mockCreateEvent.mock.calls[0][2];
  expect(typeof recurringPayload.start.timeZone).toBe("string");
  expect(recurringPayload.start.timeZone.length).toBeGreaterThan(0);
  expect(recurringPayload.end.timeZone).toBe(recurringPayload.start.timeZone);

  mockCreateEvent.mockClear();
  mockCreateEvent.mockResolvedValue({ id: "evtTz2", calendarId: "primary" });
  await createEventAction(baseInput({ timeZone: "America/New_York" }));
  const oneOffPayload = mockCreateEvent.mock.calls[0][2];
  expect("timeZone" in oneOffPayload.start).toBe(false);
  expect("timeZone" in oneOffPayload.end).toBe(false);
});

test("updateEventAction sets start.timeZone/end.timeZone when recurrence is non-empty (scope absent)", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });
  await updateEventAction({
    ...baseInput({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"], timeZone: "America/New_York" }),
    eventId: "evt1",
  });
  const payload = mockUpdateEvent.mock.calls[0][3];
  expect(typeof payload.start.timeZone).toBe("string");
  expect(payload.start.timeZone.length).toBeGreaterThan(0);
});

test("updateEventAction with scope 'following' sets a timeZone on the new series when the master's own (continued) recurrence carries it forward", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({
      start: "2026-11-25T10:00:00-05:00",
      end: "2026-11-25T10:30:00-05:00",
      timeZone: "America/New_York",
    }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(createdPayload.start.timeZone).toBe("America/New_York");
  expect(createdPayload.end.timeZone).toBe("America/New_York");
});

// --- Follow-up fix round: Fix 1 — patchWholeSeries must carry timeZone through shiftMasterTimes ---

test("updateEventAction with scope 'all' sets start.timeZone/end.timeZone on the shifted master PATCH", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({
      start: "2026-11-25T10:00:00-05:00",
      end: "2026-11-25T10:30:00-05:00",
      timeZone: "America/New_York",
    }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T09:30:00-05:00",
  });

  const payload = mockUpdateEvent.mock.calls[0][3];
  expect(typeof payload.start.timeZone).toBe("string");
  expect(payload.start.timeZone.length).toBeGreaterThan(0);
  expect(typeof payload.end.timeZone).toBe("string");
  expect(payload.end.timeZone.length).toBeGreaterThan(0);
});

test("updateEventAction with scope 'following' on the series' first occurrence (collapsing onto 'all') sets start.timeZone/end.timeZone", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T09:00:00-05:00" }, end: { dateTime: "2026-11-11T09:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  await updateEventAction({
    ...baseInput({
      start: "2026-11-11T10:00:00-05:00",
      end: "2026-11-11T10:30:00-05:00",
      timeZone: "America/New_York",
    }),
    eventId: "occ1", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-11T09:00:00-05:00", occurrenceOriginalEnd: "2026-11-11T09:30:00-05:00",
  });

  const payload = mockUpdateEvent.mock.calls[0][3];
  expect(typeof payload.start.timeZone).toBe("string");
  expect(payload.start.timeZone.length).toBeGreaterThan(0);
  expect(typeof payload.end.timeZone).toBe("string");
  expect(payload.end.timeZone.length).toBeGreaterThan(0);
});

// --- Follow-up fix round: Fix 2 — correctWeeklyByDay must use a real offset, not buildRRule's buggy "Z" default ---

/** Parses a Google `YYYYMMDDTHHMMSSZ` UNTIL value back to an epoch-ms instant, the same shape `calendar-recurrence.test.ts` uses. */
function untilToEpochMs(rruleLine: string): number {
  const match = rruleLine.match(/UNTIL=(\d{8}T\d{6}Z)/);
  if (!match) throw new Error(`no UNTIL in ${rruleLine}`);
  const iso = match[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z");
  return new Date(iso).getTime();
}

test("updateEventAction with scope 'all' corrects an onDate-ending WEEKLY RRULE's BYDAY using the master's own offset, not bare UTC", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    // 2026-11-11 is a Wednesday, at 20:00 in -05:00 — late enough in the day
    // that a bare-UTC UNTIL would land before the -05:00 end-of-day instant.
    start: { dateTime: "2026-11-11T20:00:00-05:00" }, end: { dateTime: "2026-11-11T20:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });

  // Shifted from Wednesday 2026-11-25 to Thursday 2026-11-26 — a day later — forces the BYDAY correction path.
  await updateEventAction({
    ...baseInput({ start: "2026-11-26T20:00:00-05:00", end: "2026-11-26T20:30:00-05:00" }),
    eventId: "occ3", scope: "all", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T20:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T20:30:00-05:00",
  });

  const payload = mockUpdateEvent.mock.calls[0][3];
  // 23:59:59 on 2026-12-31 *in the master's own -05:00 offset*, i.e.
  // 2027-01-01T04:59:59Z — not the bare-UTC 2026-12-31T23:59:59Z the buggy
  // default would produce.
  expect(untilToEpochMs(payload.recurrence[0])).toBe(new Date("2027-01-01T04:59:59Z").getTime());
});

test("updateEventAction with scope 'following' (a drag, not the first occurrence) corrects the new series' onDate-ending RRULE using the occurrence's own offset from input.start, not bare UTC", async () => {
  mockGetEvent.mockResolvedValue({
    id: "master1", calendarId: "primary",
    start: { dateTime: "2026-11-11T20:00:00-05:00" }, end: { dateTime: "2026-11-11T20:30:00-05:00" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z"],
  });
  mockUpdateEvent.mockResolvedValue({ id: "master1", calendarId: "primary" });
  mockCreateEvent.mockResolvedValue({ id: "newseries1", calendarId: "primary" });

  // Not the first occurrence (2026-11-25 != master's 2026-11-11); dragged
  // onto Thursday 2026-11-26, still at 20:00 -05:00 — a drag's own
  // `moveEventToSlot` preserves the event's real offset on `input.start`,
  // unlike an `EventEditor` save (which always normalizes to "Z").
  await updateEventAction({
    ...baseInput({ start: "2026-11-26T20:00:00-05:00", end: "2026-11-26T20:30:00-05:00" }),
    eventId: "occ3", scope: "following", recurringEventId: "master1",
    occurrenceOriginalStart: "2026-11-25T20:00:00-05:00", occurrenceOriginalEnd: "2026-11-25T20:30:00-05:00",
  });

  const createdPayload = mockCreateEvent.mock.calls[0][2];
  expect(untilToEpochMs(createdPayload.recurrence[0])).toBe(new Date("2027-01-01T04:59:59Z").getTime());
});
