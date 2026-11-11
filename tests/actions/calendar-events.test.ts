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
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date(2026, 10, 25))] }),
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
    expect.objectContaining({ recurrence: [truncateRRuleBefore("RRULE:FREQ=WEEKLY", new Date(2026, 10, 25))] }),
  );
  expect(mockCreateEvent).toHaveBeenCalledWith(
    "test-token", "primary",
    expect.objectContaining({
      summary: "Standup (longer)",
      start: { dateTime: "2026-11-25T10:00:00-05:00" },
      end: { dateTime: "2026-11-25T10:30:00-05:00" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
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
