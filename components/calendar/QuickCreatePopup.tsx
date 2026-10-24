"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createEventAction, type EventActionInput } from "../../lib/actions/calendar-events";
import { createTaskAction, type TaskActionInput } from "../../lib/actions/calendar-tasks";
import type { GoogleCalendarListEntry } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

export type QuickCreateInitial = { kind: "event" | "task"; date: Date; hour?: number };

/**
 * Everything the user has entered in the quick popup so far, handed to
 * `onMoreOptions` so the full editor can open pre-filled with it. Without
 * this, "More options" re-derived the full editor's defaults from the
 * original click (date/hour/primary calendar) and silently threw away the
 * title typed, the times adjusted, and the calendar or task list chosen —
 * which is the worst possible moment to lose input, since "More options" is
 * exactly the click a user makes *after* finding the quick popup too small.
 *
 * `kind` is included because the Event/Task toggle lives in this popup too:
 * clicking Task and then "More options" has to open the Task editor, not the
 * Event editor the original click asked for.
 */
export type QuickCreateDraft = {
  kind: "event" | "task";
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` — the Event side's start/end range. */
  startTime: string;
  endTime: string;
  /** `HH:MM`, or `""` for the Task side's "no time set". */
  dueTime: string;
  calendarId: string;
  taskListId: string;
};

/** Formats a `Date` as the `YYYY-MM-DD` shape `<input type="date">` expects, in local time. */
function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats an hour (0-23) as the `HH:00` shape `<input type="time">` expects. */
function formatHourAsTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Adds one hour to a `HH:MM` time string, wrapping past midnight back to `00:00`. */
function addOneHour(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const totalMinutes = (Number(hourStr) * 60 + Number(minuteStr) + 60) % (24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Combines a `YYYY-MM-DD` date and a `HH:MM` time — both wall-clock, with no
 * timezone of their own — into the ISO date-time string `EventActionInput.start`/
 * `end` expect. `new Date(...)` on a date-time string with no offset is
 * interpreted as local time (the same convention
 * `lib/actions/calendar-tasks.ts`'s `parseDueAt` already relies on), and
 * `toISOString()` then converts that local instant to the UTC-offset ISO
 * string Google's `dateTime` field wants.
 */
function combineDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

/**
 * The lightweight "quick create" popup from the design doc's "The popup
 * (quick create)" section: a title, an Event/Task toggle (Event selected by
 * default), a when-section (start/end range for Event, a single
 * optional-time Due field for Task), and a calendar-or-task-list picker.
 * "More options" is meant to expand into the full editor (later tasks);
 * here it's just a callback out to the caller. Controlled/presentational —
 * owns only its own form state, and calls `createEventAction`/
 * `createTaskAction` directly on Save.
 *
 * Time defaults follow the design doc's click-to-create rules: Event always
 * gets a start time (seeded from `initial.hour` when the click came from a
 * specific slot, else 9:00 AM) with a 1-hour default duration. Task only
 * gets a seeded time when `initial.hour` is given (a Day/Week slot click);
 * a Month/Agenda day-box click has no hour to infer from, so Task's Due time
 * starts empty ("no time set") — still freely editable here.
 */
export function QuickCreatePopup(props: {
  calendars: GoogleCalendarListEntry[];
  taskLists: GoogleTaskList[];
  initial: QuickCreateInitial;
  onMoreOptions(draft: QuickCreateDraft): void;
  onSaved(): void;
  onCancel(): void;
}) {
  const { calendars, taskLists, initial, onMoreOptions, onSaved, onCancel } = props;
  const router = useRouter();

  const [kind, setKind] = useState<"event" | "task">(initial.kind);
  const [title, setTitle] = useState("");

  const dateStr = formatDateInput(initial.date);
  const defaultStart = formatHourAsTime(initial.hour ?? 9);
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(addOneHour(defaultStart));
  const [dueTime, setDueTime] = useState(initial.hour != null ? defaultStart : "");

  const defaultCalendarId = calendars.find((calendar) => calendar.primary)?.id ?? calendars[0]?.id ?? "";
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [taskListId, setTaskListId] = useState(taskLists[0]?.id ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (kind === "event") {
        const input: EventActionInput = {
          calendarId,
          title,
          start: combineDateTime(dateStr, startTime),
          end: combineDateTime(dateStr, endTime),
          allDay: false,
        };
        await createEventAction(input);
      } else {
        const input: TaskActionInput = {
          taskListId,
          title,
          dueDate: dateStr,
          dueTime: dueTime || null,
        };
        await createTaskAction(input);
      }
      // The grid is server-rendered from Google, so the newly created
      // event/task only appears once the page's server components re-run —
      // same pattern `TaskCheckbox` uses after `completeTaskAction`. Without
      // this the popup closes onto a calendar that still looks unchanged.
      router.refresh();
      onSaved();
    } catch (err) {
      // This is the most-travelled creation path in the app; an unhandled
      // rejection here left the popup sitting there looking like the Save
      // click simply hadn't registered. Mirrors `EventEditor`/`TaskEditor`:
      // the message renders inline, the popup stays open, `onSaved` is never
      // called on failure.
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="create-popup" role="dialog" aria-label={kind === "event" ? "Create event" : "Create task"}>
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}

      <input
        className="cp-title-input"
        type="text"
        placeholder="Add title"
        aria-label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="cp-type-toggle">
        <button type="button" aria-pressed={kind === "event"} onClick={() => setKind("event")}>
          Event
        </button>
        <button type="button" aria-pressed={kind === "task"} onClick={() => setKind("task")}>
          Task
        </button>
      </div>

      {kind === "event" ? (
        <div className="cp-row">
          <input type="date" aria-label="Date" value={dateStr} readOnly />
          <input
            type="time"
            aria-label="Start time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
          <span className="tilde">–</span>
          <input
            type="time"
            aria-label="End time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </div>
      ) : (
        <div className="cp-row">
          <label htmlFor="qc-due-date">Due</label>
          <input id="qc-due-date" type="date" aria-label="Date" value={dateStr} readOnly />
          <input
            type="time"
            aria-label="Due time"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
          />
        </div>
      )}

      {kind === "event" ? (
        <div className="cp-row">
          <select
            aria-label="Calendar"
            value={calendarId}
            onChange={(event) => setCalendarId(event.target.value)}
          >
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.summary}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="cp-row">
          <select
            aria-label="Task list"
            value={taskListId}
            onChange={(event) => setTaskListId(event.target.value)}
          >
            {taskLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        className="cp-more"
        onClick={() =>
          onMoreOptions({ kind, title, date: dateStr, startTime, endTime, dueTime, calendarId, taskListId })
        }
      >
        More options
      </button>

      <div className="cp-actions">
        <button type="button" className="cp-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="cp-save" onClick={handleSave} disabled={saving}>
          Save
        </button>
      </div>
    </div>
  );
}
