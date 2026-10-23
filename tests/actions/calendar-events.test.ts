import { beforeEach, expect, test, vi } from "vitest";

const { mockAuth, mockGetGoogleAccessToken, mockCreateEvent, mockUpdateEvent, mockDeleteEvent } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetGoogleAccessToken: vi.fn(),
  mockCreateEvent: vi.fn(),
  mockUpdateEvent: vi.fn(),
  mockDeleteEvent: vi.fn(),
}));

vi.mock("../../auth", () => ({ auth: mockAuth }));
vi.mock("../../lib/google-token", () => ({ getGoogleAccessToken: mockGetGoogleAccessToken }));
vi.mock("../../lib/google-calendar", () => ({
  createEvent: mockCreateEvent,
  updateEvent: mockUpdateEvent,
  deleteEvent: mockDeleteEvent,
}));

import { colorIdForToken } from "../../lib/calendar-event-colors";
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

test("updateEventAction calls updateEvent with the given eventId regardless of scope", async () => {
  mockUpdateEvent.mockResolvedValue({ id: "evt1", calendarId: "primary" });

  const result = await updateEventAction({ ...baseInput(), eventId: "evt1", scope: "all" });

  expect(result).toEqual({ id: "evt1" });
  expect(mockUpdateEvent).toHaveBeenCalledWith(
    "test-token",
    "primary",
    "evt1",
    expect.objectContaining({ summary: "Standup" }),
  );
});

test("deleteEventAction calls deleteEvent with the given calendarId and eventId", async () => {
  mockDeleteEvent.mockResolvedValue(undefined);

  await deleteEventAction({ calendarId: "primary", eventId: "evt1", scope: "following" });

  expect(mockDeleteEvent).toHaveBeenCalledWith("test-token", "primary", "evt1");
});
