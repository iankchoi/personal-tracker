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
  const [popup, setPopup] = useState<PopupState>({ mode: "closed" });

  const writableCalendars = useMemo(
    () => filterWritableCalendars(props.calendars),
    [props.calendars],
  );

  const openCreate = useCallback((kind: "event" | "task", date: Date, hour?: number) => {
    setPopup({ mode: "create", kind, date, hour });
  }, []);

  const openEditEvent = useCallback((event: GoogleCalendarEvent) => {
    setPopup({ mode: "edit-event", event });
  }, []);

  const openEditTask = useCallback((task: CalendarTaskItem) => {
    setPopup({ mode: "edit-task", task });
  }, []);

  const close = useCallback(() => {
    setPopup({ mode: "closed" });
  }, []);

  const value = useMemo(
    () => ({ popup, openCreate, openEditEvent, openEditTask, close }),
    [popup, openCreate, openEditEvent, openEditTask, close],
  );

  return (
    <CalendarInteractionContext.Provider value={value}>
      {props.children}
      <EventTaskModal
        popup={popup}
        calendars={writableCalendars}
        taskLists={props.taskLists}
        onClose={close}
      />
    </CalendarInteractionContext.Provider>
  );
}
