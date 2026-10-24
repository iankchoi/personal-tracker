"use client";

import { useState, type ReactNode } from "react";

import type { EventActionInput } from "../../lib/actions/calendar-events";
import type { TaskActionInput } from "../../lib/actions/calendar-tasks";
import { allDayEndToInclusive } from "../../lib/calendar-dates";
import { tokenForColorId } from "../../lib/calendar-event-colors";
import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import type { PopupState } from "./CalendarInteractionProvider";
import { EventEditor } from "./EventEditor";
import { ModalShell } from "./ModalShell";
import { QuickCreatePopup, type QuickCreateDraft } from "./QuickCreatePopup";
import { TaskEditor } from "./TaskEditor";

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
function googleEventToEditorInitial(
  event: GoogleCalendarEvent,
): Partial<EventActionInput> & { eventId: string; calendarId: string } {
  const allDay = event.start.date != null;

  return {
    eventId: event.id,
    calendarId: event.calendarId,
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
function calendarTaskToEditorInitial(
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

/** Combines a `YYYY-MM-DD` date and an `HH:MM` time into the ISO date-time string `EventActionInput.start`/`end` expect — mirrors `QuickCreatePopup.tsx`'s `combineDateTime`. */
function combineDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

/**
 * Carries everything the user already typed into the quick popup forward into
 * `EventEditor`'s `initial` shape. The draft comes from `onMoreOptions` rather
 * than being re-derived from the original `popup` click, which is the whole
 * point: re-deriving gave back the clicked date/hour and the primary calendar
 * and dropped the title, the adjusted times, and any non-default calendar the
 * user had picked — losing work at exactly the moment they asked for *more*
 * fields, not fewer.
 */
function draftToEventEditorInitial(
  draft: QuickCreateDraft,
): Partial<EventActionInput> & { calendarId: string } {
  return {
    calendarId: draft.calendarId,
    title: draft.title,
    start: combineDateTime(draft.date, draft.startTime),
    end: combineDateTime(draft.date, draft.endTime),
    allDay: false,
  };
}

/**
 * The Task-side counterpart of `draftToEventEditorInitial`. An empty
 * `draft.dueTime` stays "no time set" (`null`) rather than becoming `""` —
 * the shape `TaskActionInput` documents and `TaskEditor` seeds its blank time
 * input from.
 */
function draftToTaskEditorInitial(
  draft: QuickCreateDraft,
): Partial<TaskActionInput> & { taskListId: string } {
  return {
    taskListId: draft.taskListId,
    title: draft.title,
    dueDate: draft.date,
    dueTime: draft.dueTime || null,
  };
}

/**
 * Renders whichever popup/editor `popup` currently calls for, or nothing
 * when it's `{ mode: "closed" }`. `CalendarInteractionProvider` renders this
 * once, after its children, so it's always the single surface controlled by
 * `useCalendarInteraction()`.
 *
 * Everything it renders goes inside a `ModalShell` — a fixed, centered card
 * over a backdrop, with Escape/backdrop-click dismissal and focus moved into
 * the card. None of the three surfaces positions itself; they're all plain
 * in-flow cards that the shell lifts out of the document flow.
 *
 * `draft` holds the quick-create popup's in-progress form state once "More
 * options" has been clicked for the *current* `"create"` session, which both
 * selects the full editor and pre-fills it (see `draftToEventEditorInitial`).
 * `null` means "still on the quick popup". It resets every time `popup`
 * itself changes, so a fresh session always starts back at the quick popup
 * rather than stuck mid-expansion with a previous session's draft.
 *
 * `"edit-event"`/`"edit-task"` always render the full editor directly, no
 * quick-popup step, per the design doc ("Clicking an existing event or task
 * opens the identical popup/editor").
 *
 * ## Why `key={...sessionId}` and not another render-time reset
 *
 * Every editor seeds its fields with `useState(initial.x ?? ...)`, which only
 * runs on mount. When `popup` goes directly from one open session to another
 * — clicking event A's chip, then event B's, with no close in between —
 * React would otherwise reuse the *same* component instance at the same
 * render position: the form keeps showing A's values while `initial.eventId`
 * is already B's, and saving PATCHes A's displayed data onto B's real Google
 * event. The `prevPopup` render-time reset below can fix a local boolean like
 * `draft`, but it can't reach inside a child's own `useState` seeds — only
 * unmounting and remounting the child does that, which is what a changing
 * `key` forces.
 *
 * The key has to carry `sessionId` rather than anything derived from `popup`,
 * because two indistinguishable opens are still two sessions (two `N`
 * presses; reopening the same event after typing into it and closing).
 */
export function EventTaskModal(props: {
  popup: PopupState;
  sessionId: number;
  calendars: GoogleCalendarListEntry[];
  taskLists: GoogleTaskList[];
  onClose(): void;
}) {
  const { popup, sessionId, calendars, taskLists, onClose } = props;
  const [draft, setDraft] = useState<QuickCreateDraft | null>(null);

  // Resets `draft` whenever `popup` itself changes (a fresh create/edit
  // session always starts back at the quick popup) — adjusting state during
  // render rather than in a `useEffect`, React's documented pattern for
  // resetting state in response to a prop change without an extra render pass.
  const [prevPopup, setPrevPopup] = useState(popup);
  if (popup !== prevPopup) {
    setPrevPopup(popup);
    setDraft(null);
  }

  if (popup.mode === "closed") {
    return null;
  }

  const sessionKey = `${popup.mode}-${sessionId}`;

  let body: ReactNode = null;

  if (popup.mode === "create" && draft?.kind === "event") {
    body = (
      <EventEditor
        key={`${sessionKey}-event-editor`}
        mode="create"
        initial={draftToEventEditorInitial(draft)}
        calendars={calendars}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  } else if (popup.mode === "create" && draft?.kind === "task") {
    body = (
      <TaskEditor
        key={`${sessionKey}-task-editor`}
        mode="create"
        initial={draftToTaskEditorInitial(draft)}
        taskLists={taskLists}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  } else if (popup.mode === "create") {
    body = (
      <QuickCreatePopup
        key={`${sessionKey}-quick`}
        calendars={calendars}
        taskLists={taskLists}
        initial={{ kind: popup.kind, date: popup.date, hour: popup.hour }}
        onMoreOptions={setDraft}
        onSaved={onClose}
        onCancel={onClose}
      />
    );
  } else if (popup.mode === "edit-event") {
    body = (
      <EventEditor
        key={sessionKey}
        mode="edit"
        initial={googleEventToEditorInitial(popup.event)}
        calendars={calendars}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  } else if (popup.mode === "edit-task") {
    body = (
      <TaskEditor
        key={sessionKey}
        mode="edit"
        initial={calendarTaskToEditorInitial(popup.task)}
        taskLists={taskLists}
        onSaved={onClose}
        onDeleted={onClose}
        onCancel={onClose}
      />
    );
  }

  return <ModalShell onClose={onClose}>{body}</ModalShell>;
}
