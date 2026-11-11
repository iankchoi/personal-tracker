import type { EventActionInput } from "./actions/calendar-events";
import type { TaskActionInput } from "./actions/calendar-tasks";
import { allDayEndToInclusive } from "./calendar-dates";
import { tokenForColorId } from "./calendar-event-colors";
import type { CalendarTaskItem } from "./calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "./google-calendar";

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
 *
 * It's also where all-day `end` crosses from Google's convention into the
 * editor's. Google's all-day `end.date` is **exclusive** — a one-day event on
 * Oct 25 is reported as `start.date: "2026-10-25", end.date: "2026-10-26"` —
 * whereas the editor's two date inputs show an inclusive last day. Without the
 * `-1` here, a one-day all-day event opened as if it spanned two, and turning
 * All-day off then produced a 25-hour timed event. `EventEditor`'s save path
 * applies the matching `+1` on the way back out.
 */
export function googleEventToEditorInitial(
  event: GoogleCalendarEvent,
): Partial<EventActionInput> & { eventId: string; calendarId: string; recurringEventId?: string } {
  const allDay = event.start.date != null;

  return {
    eventId: event.id,
    calendarId: event.calendarId,
    recurringEventId: event.recurringEventId,
    title: event.summary,
    start: allDay ? event.start.date : event.start.dateTime,
    end: allDay
      ? event.end.date
        ? allDayEndToInclusive(event.end.date)
        : event.start.date
      : event.end.dateTime,
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

/**
 * Maps a `CalendarTaskItem` (the Tasks analog of `GoogleCalendarEvent` —
 * already merged with its local `task_metadata` row by
 * `lib/calendar-tasks-for-grid.ts`) into the flattened shape `TaskEditor`'s
 * `initial` prop expects. Unlike `googleEventToEditorInitial`, there's no
 * date-shape unwrapping to do here — `CalendarTaskItem.dueDate`/`dueTime`
 * are already the bare `YYYY-MM-DD`/`HH:MM` strings `TaskEditor` needs, so
 * they're passed straight through.
 */
export function calendarTaskToEditorInitial(
  task: CalendarTaskItem,
): Partial<TaskActionInput> & { taskId: string; taskListId: string } {
  return {
    taskId: task.id,
    taskListId: task.taskListId,
    title: task.title,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    notes: task.notes,
    colorToken: task.colorToken,
  };
}
