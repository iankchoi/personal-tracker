"use client";

import { useState } from "react";

import type { EventActionInput } from "../../lib/actions/calendar-events";
import { tokenForColorId } from "../../lib/calendar-event-colors";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import type { PopupState } from "./CalendarInteractionProvider";
import { EventEditor } from "./EventEditor";
import { QuickCreatePopup } from "./QuickCreatePopup";

/**
 * Maps a raw `GoogleCalendarEvent` (as read back from the API — see
 * `lib/google-calendar.ts`) into the flattened, already-unwrapped shape
 * `EventEditor`'s `initial` prop expects. This is the one place that has to
 * know about `start.date` vs. `start.dateTime` — an all-day event carries
 * the former, a timed event the latter (never both) — so `EventEditor`
 * itself never has to guess which shape it was handed; it only ever sees a
 * plain date string (all-day) or a plain ISO date-time string (timed),
 * tagged by the sibling `allDay` boolean. This is the fix for this plan's
 * Review Focus item: without this unwrap, clicking an all-day event to edit
 * it would hand `EventEditor` a `start` that's `undefined` (reading
 * `start.dateTime` off an all-day event) rather than crashing outright, but
 * it would silently lose the event's actual date — this mapping is what
 * makes "read `start.date`, not `start.dateTime`" happen before the editor
 * ever runs.
 */
function googleEventToEditorInitial(
  event: GoogleCalendarEvent,
): Partial<EventActionInput> & { eventId: string; calendarId: string } {
  const allDay = event.start.date != null;

  return {
    eventId: event.id,
    calendarId: event.calendarId,
    title: event.summary,
    start: allDay ? event.start.date : event.start.dateTime,
    end: allDay ? event.end.date : event.end.dateTime,
    allDay,
    description: event.description,
    location: event.location,
    colorToken: tokenForColorId(event.colorId),
    notifyMinutesBefore: event.reminders?.overrides?.[0]?.minutes ?? null,
    addGoogleMeet: Boolean(event.conferenceData?.entryPoints?.length),
    guestEmails: event.attendees?.map((attendee) => attendee.email) ?? [],
    guestsCanModify: event.guestsCanModify,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests,
  };
}

/** Formats a `Date` as the `YYYY-MM-DD` shape `<input type="date">` expects, in local time — the same convention `QuickCreatePopup.tsx` uses. */
function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Combines a `YYYY-MM-DD` date and an `HH:MM` time into the ISO date-time string `EventActionInput.start`/`end` expect — mirrors `QuickCreatePopup.tsx`'s `combineDateTime`. */
function combineDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

/**
 * Carries a "create" popup session's clicked date/hour (and, now that "More
 * options" has been clicked, the calendar) forward into `EventEditor`'s
 * `initial` shape, instead of losing the clicked slot and falling back to
 * `EventEditor`'s own "today at 9" default. Mirrors `QuickCreatePopup`'s own
 * defaulting rule: a specific hour (Day/Week slot click) seeds a 1-hour
 * timed event there; no hour (a Month/Agenda day-box click, or the toolbar's
 * "+ New event") still seeds a sensible 9-10 AM timed default — Events,
 * unlike Tasks, always get a time even with no hour to infer from.
 */
function createPopupToEditorInitial(
  popup: { date: Date; hour?: number },
  calendarId: string,
): Partial<EventActionInput> & { calendarId: string } {
  const dateStr = formatDateInput(popup.date);
  const startHour = popup.hour ?? 9;
  const endHour = (startHour + 1) % 24;
  const startTime = `${String(startHour).padStart(2, "0")}:00`;
  const endTime = `${String(endHour).padStart(2, "0")}:00`;

  return {
    calendarId,
    start: combineDateTime(dateStr, startTime),
    end: combineDateTime(dateStr, endTime),
    allDay: false,
  };
}

/**
 * Renders whichever popup/editor `popup` currently calls for, or nothing
 * when it's `{ mode: "closed" }`. `CalendarInteractionProvider` renders this
 * once, after its children, so it's always the single surface controlled by
 * `useCalendarInteraction()`.
 *
 * `expanded` tracks whether the quick-create popup's "More options" link has
 * been clicked for the *current* `"create"` session — it resets to `false`
 * every time `popup` itself changes (a fresh create/edit session always
 * starts back at the quick popup, never stuck mid-expansion from a previous
 * one). `"edit-event"` always renders the full `EventEditor` directly, no
 * quick-popup step, per the design doc ("Clicking an existing event or task
 * opens the identical popup/editor").
 *
 * `"edit-task"` is still a bare `null` — Task 4 of this plan fills in the
 * Task editor.
 */
export function EventTaskModal(props: {
  popup: PopupState;
  calendars: GoogleCalendarListEntry[];
  taskLists: GoogleTaskList[];
  onClose(): void;
}) {
  const { popup, calendars, taskLists, onClose } = props;
  const [expanded, setExpanded] = useState(false);

  // Resets `expanded` to `false` whenever `popup` itself changes (a fresh
  // create/edit session always starts back at the quick popup, never stuck
  // mid-expansion from a previous one) — adjusting state during render
  // rather than in a `useEffect`, React's documented pattern for resetting
  // state in response to a prop change without an extra render pass.
  const [prevPopup, setPrevPopup] = useState(popup);
  if (popup !== prevPopup) {
    setPrevPopup(popup);
    setExpanded(false);
  }

  if (popup.mode === "create" && popup.kind === "event" && expanded) {
    const defaultCalendarId = calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "";
    return (
      <EventEditor
        mode="create"
        initial={createPopupToEditorInitial(popup, defaultCalendarId)}
        calendars={calendars}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  }

  if (popup.mode === "create") {
    return (
      <QuickCreatePopup
        calendars={calendars}
        taskLists={taskLists}
        initial={{ kind: popup.kind, date: popup.date, hour: popup.hour }}
        onMoreOptions={() => setExpanded(true)}
        onSaved={onClose}
        onCancel={onClose}
      />
    );
  }

  if (popup.mode === "edit-event") {
    return (
      <EventEditor
        mode="edit"
        initial={googleEventToEditorInitial(popup.event)}
        calendars={calendars}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  }

  return null;
}
