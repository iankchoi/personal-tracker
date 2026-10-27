// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockCreateEventAction, mockUpdateEventAction, mockDeleteEventAction, mockRefresh } = vi.hoisted(() => ({
  mockCreateEventAction: vi.fn(),
  mockUpdateEventAction: vi.fn(),
  mockDeleteEventAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("../../lib/actions/calendar-events", () => ({
  createEventAction: mockCreateEventAction,
  updateEventAction: mockUpdateEventAction,
  deleteEventAction: mockDeleteEventAction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

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
  mockRefresh.mockReset();
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

const existingTimedEvent = {
  eventId: "e1",
  calendarId: "primary",
  title: "Standup",
  start: "2026-10-20T13:00:00.000Z",
  end: "2026-10-20T14:00:00.000Z",
  allDay: false,
} as const;

function renderEditing(extra: Record<string, unknown> = {}, handlers: Record<string, () => void> = {}) {
  return render(
    <EventEditor
      mode="edit"
      initial={{ ...existingTimedEvent, ...extra }}
      calendars={cals}
      onSaved={handlers.onSaved ?? vi.fn()}
      onDeleted={handlers.onDeleted ?? vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

// Fix 1 — nothing refreshed the grid after a write, so the popup closed onto
// visibly stale data until a manual reload.
test("a successful save refreshes the route so the calendar grid re-renders", async () => {
  renderEditing();

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockRefresh).toHaveBeenCalled();
});

test("a successful delete refreshes the route so the deleted event disappears from the grid", async () => {
  renderEditing();

  await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

  await vi.waitFor(() => expect(mockDeleteEventAction).toHaveBeenCalled());
  expect(mockRefresh).toHaveBeenCalled();
});

test("a failed save does not refresh the route", async () => {
  mockUpdateEventAction.mockReset().mockRejectedValue(new Error("403"));
  renderEditing();

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("403");
  expect(mockRefresh).not.toHaveBeenCalled();
});

// Fix 4 — `tokenForColorId` returns null for the 5 Google colorIds this app's
// palette doesn't map, and `colorToken: null` on an update means "clear it".
test("editing only the title of an event whose Google color this app can't map sends colorToken: undefined, not null", async () => {
  renderEditing({ colorToken: null });

  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Standup (renamed)");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Standup (renamed)", colorToken: undefined }),
  );
});

test("actually picking a color during an edit sends that explicit token", async () => {
  renderEditing({ colorToken: null });

  await userEvent.click(screen.getByRole("radio", { name: /red/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(expect.objectContaining({ colorToken: "cv" }));
});

// Fix 5 — resending the attendee list resets accepted guests to needsAction
// and makes Google re-send its real invite email to everyone.
test("editing only the title of an event with guests sends guestEmails: undefined, not the reconstructed list", async () => {
  renderEditing({ guestEmails: ["a@example.com", "b@example.com"] });

  await userEvent.clear(screen.getByLabelText(/^title$/i));
  await userEvent.type(screen.getByLabelText(/^title$/i), "Standup (renamed)");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Standup (renamed)", guestEmails: undefined }),
  );
});

test("adding a guest during an edit sends the full explicit list", async () => {
  renderEditing({ guestEmails: ["a@example.com"] });

  await userEvent.type(screen.getByLabelText(/add guest/i), "c@example.com{Enter}");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ guestEmails: ["a@example.com", "c@example.com"] }),
  );
});

test("removing a guest during an edit sends the remaining list", async () => {
  renderEditing({ guestEmails: ["a@example.com", "b@example.com"] });

  await userEvent.click(screen.getByRole("button", { name: /remove b@example\.com/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ guestEmails: ["a@example.com"] }),
  );
});

// Fix 6 — `field || undefined` drops the key from the JSON body, which on a
// PATCH means "leave it alone", so clearing never stuck.
test("clearing an existing event's description and location sends empty strings, not undefined", async () => {
  renderEditing({ description: "Old notes", location: "Old place" });

  await userEvent.clear(screen.getByLabelText(/description/i));
  await userEvent.clear(screen.getByLabelText(/location/i));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ description: "", location: "" }),
  );
});

test("creating an event with no description or location still omits both fields", async () => {
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
    expect.objectContaining({ description: undefined, location: undefined }),
  );
});

// Fix 7 — the save half of the inclusive/exclusive all-day end-date boundary.
// (The full Google -> editor -> Google round trip lives in
// tests/components/event-task-modal.test.tsx.)
test("saving an all-day event converts the displayed inclusive end date back to Google's exclusive end.date", async () => {
  renderEditing({ start: "2026-10-25", end: "2026-10-25", allDay: true });

  expect(screen.getByLabelText(/end date/i)).toHaveValue("2026-10-25");

  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockUpdateEventAction).toHaveBeenCalled());
  expect(mockUpdateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ allDay: true, start: "2026-10-25", end: "2026-10-26" }),
  );
});

test("checking All day on a create produces a one-day range Google accepts, not a zero-length one", async () => {
  render(
    <EventEditor
      mode="create"
      initial={{ calendarId: "primary", start: "2026-10-25T09:00:00.000Z", end: "2026-10-25T10:00:00.000Z" }}
      calendars={cals}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await userEvent.type(screen.getByLabelText(/^title$/i), "Birthday");
  await userEvent.click(screen.getByRole("checkbox", { name: /all.?day/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await vi.waitFor(() => expect(mockCreateEventAction).toHaveBeenCalled());
  expect(mockCreateEventAction).toHaveBeenCalledWith(
    expect.objectContaining({ allDay: true, start: "2026-10-25", end: "2026-10-26" }),
  );
});

// Fix 8 — an empty title saved over a real event blanks its name in Google.
test("Save is disabled while the title is empty or whitespace-only", async () => {
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

  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/^title$/i), "   ");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/^title$/i), "Standup");
  expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
});

// Fix 11 — updateEventAction PATCHes calendarId/events/eventId, so a changed
// calendar would send the old event's id to the new calendar and 404.
test("the calendar picker is disabled while editing an existing event, and live while creating one", () => {
  const { unmount } = renderEditing();
  expect(screen.getByLabelText(/calendar/i)).toBeDisabled();
  unmount();

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
  expect(screen.getByLabelText(/calendar/i)).toBeEnabled();
});
