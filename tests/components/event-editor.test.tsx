// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateEventAction, mockUpdateEventAction, mockDeleteEventAction } = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockUpdateEventAction: vi.fn(),
  mockDeleteEventAction: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({
  createEventAction: mockCreateEventAction,
  updateEventAction: mockUpdateEventAction,
  deleteEventAction: mockDeleteEventAction,
}));

import { EventEditor } from "../../components/calendar/EventEditor";
import type { GoogleCalendarListEntry } from "../../lib/google-calendar";

const cals: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "iankangchoi@gmail.com", backgroundColor: "#3b6ea5", primary: true, accessRole: "owner" },
  { id: "shared", summary: "Shared", backgroundColor: "#2f7a6b", accessRole: "writer" },
];

afterEach(() => {
  cleanup();
  mockCreateEventAction.mockReset().mockResolvedValue({ id: "e1", calendarId: "primary" });
  mockUpdateEventAction.mockReset().mockResolvedValue({ id: "e1" });
  mockDeleteEventAction.mockReset().mockResolvedValue(undefined);
});

test("All-day toggle swaps the time pickers for a single date field", async () => {
  render(
    <EventEditor
      mode="create"
      initial={{ calendarId: "primary" }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByLabelText(/start time/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("checkbox", { name: /all.?day/i }));

  expect(screen.queryByLabelText(/start time/i)).not.toBeInTheDocument();
});

test("editing an existing all-day event reads its start.date, not start.dateTime, without crashing", () => {
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Birthday",
        start: "2026-10-25",
        end: "2026-10-26",
        allDay: true,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("checkbox", { name: /all.?day/i })).toBeChecked();
  expect(screen.getByLabelText(/^title$/i)).toHaveValue("Birthday");
  expect(screen.getByLabelText(/start date/i)).toHaveValue("2026-10-25");
});

test("Save on create calls createEventAction with the entered title, location, description, guests, and color", async () => {
  render(
    <EventEditor
      mode="create"
      initial={{ calendarId: "primary" }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText(/^title$/i), "Trip planning");
  await userEvent.type(screen.getByLabelText(/location/i), "Golden Gate Park");
  await userEvent.type(screen.getByLabelText(/description/i), "Plan the itinerary");
  await userEvent.type(screen.getByLabelText(/add guest/i), "friend@example.com");
  await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await userEvent.click(screen.getByRole("radio", { name: /red/i }));

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({
      calendarId: "primary",
      title: "Trip planning",
      location: "Golden Gate Park",
      description: "Plan the itinerary",
      guestEmails: ["friend@example.com"],
      colorToken: "cv",
      allDay: false,
    }),
  );
});

test("Save on edit calls updateEventAction with the eventId", async () => {
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: "e1", calendarId: "primary", title: "Standup" }),
  );
  expect(mockCreateEventAction).not.toHaveBeenCalled();
});

test("Delete calls deleteEventAction with the eventId and then onDeleted", async () => {
  const onDeleted = vi.fn();
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={onDeleted}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

  await vi.waitFor(() => expect(mockDeleteEventAction).toHaveBeenCalled());
  expect(mockDeleteEventAction).toHaveBeenCalledWith({ calendarId: "primary", eventId: "e1" });
  expect(onDeleted).toHaveBeenCalled();
});

test("adding a guest email appends it to the guest chip list, and Save includes it in guestEmails", async () => {
  render(
    <EventEditor
      mode="create"
      initial={{ calendarId: "primary" }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText(/^title$/i), "Dinner");
  await userEvent.type(screen.getByLabelText(/add guest/i), "guest@example.com{Enter}");

  expect(screen.getByText("guest@example.com")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ guestEmails: ["guest@example.com"] }),
  );
});

test("a failed Save (e.g. non-organizer event rejected by Google) surfaces the error inline instead of throwing", async () => {
  mockUpdateEventAction.mockReset().mockRejectedValue(new Error("403"));
  const onSaved = vi.fn();

  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
      }}
      calendars={cals}
      onSaved={onSaved}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("403");
  expect(onSaved).not.toHaveBeenCalled();
});

test("editing an event that already has Meet, changing only the title, sends addGoogleMeet: undefined (not true)", async () => {
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
        addGoogleMeet: true,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Standup (renamed)");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Standup (renamed)", addGoogleMeet: undefined }),
  );
});

test("editing an event with no popup reminder override, changing only the title, sends notifyMinutesBefore: undefined (not 30)", async () => {
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
        notifyMinutesBefore: null,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Standup (renamed)");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Standup (renamed)", notifyMinutesBefore: undefined }),
  );
});

test("actually toggling Meet and changing Notify during an edit sends the real explicit values, not undefined", async () => {
  render(
    <EventEditor
      mode="edit"
      initial={{
        eventId: "e1",
        calendarId: "primary",
        title: "Standup",
        start: "2026-10-20T13:00:00.000Z",
        end: "2026-10-20T14:00:00.000Z",
        allDay: false,
        addGoogleMeet: false,
        notifyMinutesBefore: null,
      }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /add google meet/i }));

  const notifyInput = screen.getByLabelText(/notify/i);
  await userEvent.clear(notifyInput);
  await userEvent.type(notifyInput, "15");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ addGoogleMeet: true, notifyMinutesBefore: 15 }),
  );
});

test("creating a new event always sends addGoogleMeet and notifyMinutesBefore with their current displayed values, regardless of touched state", async () => {
  render(
    <EventEditor
      mode="create"
      initial={{ calendarId: "primary" }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText(/^title$/i), "New event");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ addGoogleMeet: false, notifyMinutesBefore: 30 }),
  );
});
