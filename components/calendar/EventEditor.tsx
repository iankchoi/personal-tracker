"use client";

import { useState } from "react";

import { createEventAction, deleteEventAction, updateEventAction, type EventActionInput } from "../../lib/actions/calendar-events";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { GoogleCalendarListEntry } from "../../lib/google-calendar";

import { ColorPicker } from "./ColorPicker";

/** Icons match the sidebar's inline-SVG style exactly: `viewBox="0 0 24 24"`, 16x16 via CSS, `stroke-width: 1.6`, `stroke: currentColor`, no fill. */
const ClockIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);
const CalendarIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18M8 2v4M16 2v4" />
  </svg>
);
const RepeatIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const PinIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);
const VideoIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="3" y="7" width="12" height="10" rx="2" />
    <path d="M15 10l6-3v10l-6-3z" />
  </svg>
);
const DocumentIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M4 4h12l4 4v12H4z" />
    <path d="M14 4v5h5" />
  </svg>
);
const GuestsIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="8" cy="8" r="3" />
    <path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M14.5 14.2c2.6.5 4.5 2.8 4.5 5.8" />
  </svg>
);
const LockIcon = (
  <svg viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
const ColorRingIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="7" r="1.4" />
    <circle cx="16.3" cy="14.5" r="1.4" />
    <circle cx="7.7" cy="14.5" r="1.4" />
  </svg>
);

/** Formats a `Date` as the `YYYY-MM-DD` shape `<input type="date">` expects, in local time (which `vitest.config.ts` and this app's production runtime both pin to UTC — see that file's comment). */
function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats a `Date` as the `HH:MM` shape `<input type="time">` expects, in local time. */
function timeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Combines a `YYYY-MM-DD` date and a `HH:MM` time — both wall-clock, with no
 * timezone of their own — into the ISO date-time string `EventActionInput.start`/
 * `end` expect, the same convention `QuickCreatePopup.tsx`'s `combineDateTime`
 * already relies on.
 */
function combineDateTime(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

/**
 * Splits an existing event's `start`/`end` value into the `{ date, time }`
 * pair the date/time inputs need. This is the one place the all-day Review
 * Focus item lives: an all-day event's `start`/`end` is already a bare
 * `YYYY-MM-DD` string (Google's `start.date`/`end.date`, already unwrapped by
 * `EventTaskModal` before this component ever sees it) — passed straight
 * through with **no** `new Date(...)` parsing. A timed event's value is a
 * full ISO date-time (`start.dateTime`/`end.dateTime`), which *does* need
 * `new Date(...)` to split into local date/time parts. Mixing these up (e.g.
 * calling `new Date()` on a bare date-only all-day string and reading
 * `.getHours()`) is exactly the crash this function exists to avoid.
 */
function splitDateTime(
  value: string | undefined,
  allDay: boolean,
  fallback: { date: string; time: string },
): { date: string; time: string } {
  if (!value) {
    return fallback;
  }
  if (allDay) {
    return { date: value, time: fallback.time };
  }
  const parsed = new Date(value);
  return { date: dateInputValue(parsed), time: timeInputValue(parsed) };
}

/** Default when/time for a brand-new event with no clicked slot to seed from: today, 9:00-10:00 — matching `QuickCreatePopup`'s own 9 AM / 1-hour-default convention. */
function defaultWhen() {
  const dateStr = dateInputValue(new Date());
  return { date: dateStr, startTime: "09:00", endTime: "10:00" };
}

/**
 * The full Event editor ("More options" from the quick-create popup, and
 * always for editing an existing event). Builds an `EventActionInput` on
 * Save and calls `createEventAction`/`updateEventAction`; calls
 * `deleteEventAction` on Delete. A rejected Save/Delete promise (e.g. a
 * non-organizer's `patch` rejected by Google because `guestsCanModify:
 * false`) is caught and rendered inline as an error message — never an
 * unhandled rejection, never a silent no-op, per this plan's Review Focus.
 */
export function EventEditor(props: {
  mode: "create" | "edit";
  initial: Partial<EventActionInput> & { eventId?: string; calendarId: string };
  calendars: GoogleCalendarListEntry[];
  onSaved(): void;
  onDeleted(): void;
  onCancel(): void;
}) {
  const { mode, initial, calendars, onSaved, onDeleted, onCancel } = props;

  const fallback = defaultWhen();
  const start = splitDateTime(initial.start, initial.allDay ?? false, {
    date: fallback.date,
    time: fallback.startTime,
  });
  const end = splitDateTime(initial.end, initial.allDay ?? false, {
    date: fallback.date,
    time: fallback.endTime,
  });

  const [title, setTitle] = useState(initial.title ?? "");
  const [allDay, setAllDay] = useState(initial.allDay ?? false);
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endDate, setEndDate] = useState(end.date);
  const [endTime, setEndTime] = useState(end.time);
  const [calendarId, setCalendarId] = useState(initial.calendarId);
  const [notifyMinutesBefore, setNotifyMinutesBefore] = useState(initial.notifyMinutesBefore ?? 30);
  const [location, setLocation] = useState(initial.location ?? "");
  const [addGoogleMeet, setAddGoogleMeet] = useState(initial.addGoogleMeet ?? false);
  const [description, setDescription] = useState(initial.description ?? "");
  const [guestEmails, setGuestEmails] = useState<string[]>(initial.guestEmails ?? []);
  const [guestInput, setGuestInput] = useState("");
  const [guestsCanModify, setGuestsCanModify] = useState(initial.guestsCanModify ?? false);
  const [guestsCanInviteOthers, setGuestsCanInviteOthers] = useState(initial.guestsCanInviteOthers ?? true);
  const [guestsCanSeeOtherGuests, setGuestsCanSeeOtherGuests] = useState(initial.guestsCanSeeOtherGuests ?? true);
  const [colorToken, setColorToken] = useState<CalendarColorToken | null>(initial.colorToken ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addGuest() {
    const email = guestInput.trim();
    if (email && !guestEmails.includes(email)) {
      setGuestEmails([...guestEmails, email]);
    }
    setGuestInput("");
  }

  function removeGuest(email: string) {
    setGuestEmails(guestEmails.filter((existing) => existing !== email));
  }

  function handleGuestKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addGuest();
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const input: EventActionInput = {
        calendarId,
        title,
        start: allDay ? startDate : combineDateTime(startDate, startTime),
        end: allDay ? endDate : combineDateTime(endDate, endTime),
        allDay,
        description: description || undefined,
        location: location || undefined,
        colorToken,
        notifyMinutesBefore,
        addGoogleMeet,
        guestEmails,
        guestsCanModify,
        guestsCanInviteOthers,
        guestsCanSeeOtherGuests,
      };

      if (mode === "create") {
        await createEventAction(input);
      } else {
        await updateEventAction({ ...input, eventId: initial.eventId! });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.eventId) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteEventAction({ calendarId, eventId: initial.eventId });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="event-editor" role="dialog" aria-label={mode === "create" ? "Create event" : "Edit event"}>
      {error && (
        <p className="ee-error" role="alert">
          {error}
        </p>
      )}

      <input
        className="ee-title-input"
        type="text"
        placeholder="Add title"
        aria-label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="ee-row">
        <span className="ee-icon">{ClockIcon}</span>
        <label className="ee-allday">
          <input
            type="checkbox"
            aria-label="All day"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
          />
          All day
        </label>
      </div>

      <div className="ee-row">
        <span className="ee-icon">{ClockIcon}</span>
        <input type="date" aria-label="Start date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        {!allDay && (
          <input
            type="time"
            aria-label="Start time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        )}
        <span className="ee-dash">–</span>
        <input type="date" aria-label="End date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        {!allDay && (
          <input
            type="time"
            aria-label="End time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        )}
      </div>

      <div className="ee-row">
        <span className="ee-icon">{CalendarIcon}</span>
        <select aria-label="Calendar" value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.summary}
            </option>
          ))}
        </select>
      </div>

      <div className="ee-row">
        <span className="ee-icon">{RepeatIcon}</span>
        {/* Does not repeat only, for this task — Part 3 of this feature makes this field live. */}
        <select aria-label="Repeat" value="none" disabled>
          <option value="none">Does not repeat</option>
        </select>
      </div>

      <div className="ee-row">
        <span className="ee-icon">{ClockIcon}</span>
        <label htmlFor="ee-notify">Notify</label>
        <input
          id="ee-notify"
          type="number"
          min={0}
          value={notifyMinutesBefore}
          onChange={(event) => setNotifyMinutesBefore(Number(event.target.value))}
        />
        <span>minutes before</span>
      </div>

      <div className="ee-row">
        <span className="ee-icon">{PinIcon}</span>
        <input
          type="text"
          placeholder="Add location"
          aria-label="Location"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>

      <div className="ee-row">
        <span className="ee-icon">{VideoIcon}</span>
        <button
          type="button"
          className="ee-meet-toggle"
          aria-pressed={addGoogleMeet}
          onClick={() => setAddGoogleMeet((current) => !current)}
        >
          {addGoogleMeet ? "Google Meet video conferencing added" : "Add Google Meet video conferencing"}
        </button>
      </div>

      <div className="ee-row ee-description">
        <span className="ee-icon">{DocumentIcon}</span>
        <textarea
          placeholder="Add description"
          aria-label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="ee-row ee-guests">
        <span className="ee-icon">{GuestsIcon}</span>
        <div className="ee-guests-body">
          <ul className="guest-chips">
            {guestEmails.map((email) => (
              <li key={email} className="guest-chip">
                {email}
                <button type="button" aria-label={`Remove ${email}`} onClick={() => removeGuest(email)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="guest-add">
            <input
              type="email"
              placeholder="Add guests"
              aria-label="Add guest"
              value={guestInput}
              onChange={(event) => setGuestInput(event.target.value)}
              onKeyDown={handleGuestKeyDown}
            />
            <button type="button" onClick={addGuest}>
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="ee-row ee-permissions">
        <span className="ee-icon">{LockIcon}</span>
        <div className="ee-permissions-body">
          <label>
            <input
              type="checkbox"
              checked={guestsCanModify}
              onChange={(event) => setGuestsCanModify(event.target.checked)}
            />
            Guests can modify event
          </label>
          <label>
            <input
              type="checkbox"
              checked={guestsCanInviteOthers}
              onChange={(event) => setGuestsCanInviteOthers(event.target.checked)}
            />
            Guests can invite others
          </label>
          <label>
            <input
              type="checkbox"
              checked={guestsCanSeeOtherGuests}
              onChange={(event) => setGuestsCanSeeOtherGuests(event.target.checked)}
            />
            Guests can see guest list
          </label>
        </div>
      </div>

      <div className="ee-row">
        <span className="ee-icon">{ColorRingIcon}</span>
        <ColorPicker value={colorToken} onChange={setColorToken} />
      </div>

      <div className="ee-actions">
        {mode === "edit" && initial.eventId && (
          <button type="button" className="ee-delete" onClick={handleDelete} disabled={deleting}>
            Delete
          </button>
        )}
        <span className="ee-spacer" />
        <button type="button" className="ee-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ee-save" onClick={handleSave} disabled={saving}>
          Save
        </button>
      </div>
    </div>
  );
}
