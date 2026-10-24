"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { CalendarTaskItem } from "@/lib/calendar-tasks-for-grid";
import {
  filterWritableCalendars,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import { EventTaskModal } from "./EventTaskModal";

/**
 * The single piece of "what popup/editor is open, with what data" state for
 * the whole Calendar page. A later task's grid-cell clicks, the toolbar's
 * "+ New event" button, and a keyboard shortcut all drive the exact same
 * state through `useCalendarInteraction()`, so only one popup/editor can ever
 * be open at a time and none of those callers need to prop-drill it down
 * through the view components.
 */
export type PopupState =
  | { mode: "closed" }
  | { mode: "create"; kind: "event" | "task"; date: Date; hour?: number }
  | { mode: "edit-event"; event: GoogleCalendarEvent }
  | { mode: "edit-task"; task: CalendarTaskItem };

type CalendarInteractionContextValue = {
  popup: PopupState;
  /**
   * A monotonic counter bumped by every `openCreate`/`openEditEvent`/
   * `openEditTask` call — one "session" of the popup being open, from that
   * call until the next one. `EventTaskModal` keys its child on this, which is
   * what forces a genuinely fresh component instance per session.
   *
   * It has to be a counter rather than something derived from `popup` itself,
   * because two *indistinguishable* opens are still two sessions: pressing
   * `N` twice in a row, or clicking the same event's edit twice, produces
   * `PopupState` values that compare equal field-for-field, yet the second one
   * must still reset the form. Deriving a key from the event/task id would
   * also reuse the mounted instance when reopening the *same* event after
   * typing into it and closing without saving.
   */
  sessionId: number;
  openCreate(kind: "event" | "task", date: Date, hour?: number): void;
  openEditEvent(event: GoogleCalendarEvent): void;
  openEditTask(task: CalendarTaskItem): void;
  close(): void;
};

const CalendarInteractionContext = createContext<CalendarInteractionContextValue | null>(null);

/**
 * Reads the shared popup state and its mutators. Throws when used outside a
 * `CalendarInteractionProvider` rather than silently returning a no-op
 * value, so a caller that forgets to render inside the provider fails loudly
 * instead of clicking around a calendar that quietly does nothing.
 */
export function useCalendarInteraction(): CalendarInteractionContextValue {
  const context = useContext(CalendarInteractionContext);
  if (!context) {
    throw new Error("useCalendarInteraction must be used within a CalendarInteractionProvider");
  }
  return context;
}

/**
 * Wraps the Calendar page. Holds the single `PopupState` for the whole page
 * and renders `EventTaskModal` once, after `children`, so any click/shortcut
 * handler anywhere in the tree can open the same popup/editor via
 * `useCalendarInteraction()` without prop-drilling.
 *
 * Filters `calendars` down to ones the user can actually write to
 * (`filterWritableCalendars`) once here, rather than in every place a
 * calendar picker might render — this is the "calendar/list picker scope"
 * design requirement: a quick-create Save against a read-only subscribed
 * calendar (e.g. Holidays) would otherwise fail with an unhelpful 403 from
 * Google.
 */
export function CalendarInteractionProvider(props: {
  calendars: GoogleCalendarListEntry[];
  taskLists: GoogleTaskList[];
  children: ReactNode;
}) {
  // `popup` and `sessionId` live in one state object so they can never be
  // observed out of step — a render that already shows event B's `popup` but
  // still carries session A's id would hand `EventTaskModal` the stale key
  // that Fix 2 exists to prevent.
  const [{ popup, sessionId }, setSession] = useState<{ popup: PopupState; sessionId: number }>({
    popup: { mode: "closed" },
    sessionId: 0,
  });

  const writableCalendars = useMemo(
    () => filterWritableCalendars(props.calendars),
    [props.calendars],
  );

  const openCreate = useCallback((kind: "event" | "task", date: Date, hour?: number) => {
    setSession((current) => ({
      popup: { mode: "create", kind, date, hour },
      sessionId: current.sessionId + 1,
    }));
  }, []);

  const openEditEvent = useCallback((event: GoogleCalendarEvent) => {
    setSession((current) => ({
      popup: { mode: "edit-event", event },
      sessionId: current.sessionId + 1,
    }));
  }, []);

  const openEditTask = useCallback((task: CalendarTaskItem) => {
    setSession((current) => ({
      popup: { mode: "edit-task", task },
      sessionId: current.sessionId + 1,
    }));
  }, []);

  // Closing ends the current session without starting a new one, so the
  // counter deliberately stays put here — the *next* open bumps it.
  const close = useCallback(() => {
    setSession((current) => ({ popup: { mode: "closed" }, sessionId: current.sessionId }));
  }, []);

  const value = useMemo(
    () => ({ popup, sessionId, openCreate, openEditEvent, openEditTask, close }),
    [popup, sessionId, openCreate, openEditEvent, openEditTask, close],
  );

  return (
    <CalendarInteractionContext.Provider value={value}>
      {props.children}
      <EventTaskModal
        popup={popup}
        sessionId={sessionId}
        calendars={writableCalendars}
        taskLists={props.taskLists}
        onClose={close}
      />
    </CalendarInteractionContext.Provider>
  );
}
