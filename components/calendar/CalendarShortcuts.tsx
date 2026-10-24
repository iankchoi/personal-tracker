"use client";

import { useEffect } from "react";

import type { ViewType } from "@/lib/calendar-ranges";

import { useCalendarInteraction } from "./CalendarInteractionProvider";

/** Maps each single-letter view shortcut to the view it switches to. */
const VIEW_FOR_KEY: Record<string, ViewType> = {
  d: "day",
  w: "week",
  m: "month",
  a: "agenda",
};

/**
 * True when `element` is a form control (or a contenteditable region) a
 * stray keystroke should be typed into rather than interpreted as a
 * single-letter Calendar shortcut.
 */
function isTypingTarget(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT") {
    return true;
  }

  return (element as HTMLElement).isContentEditable;
}

/**
 * Invisible client component mounted once inside `CalendarToolbar` (which
 * already holds `date` and `go` in scope, so they're passed down here
 * directly rather than plumbed through new props elsewhere). Attaches a
 * single page-wide `keydown` listener for the Calendar page's single-letter
 * shortcuts: `D`/`W`/`M`/`A` switch views via `go`, preserving the current
 * `date`; `N` opens the quick-create popup (always defaulting to "event",
 * matching the toolbar's own "+ New event" button) via
 * `useCalendarInteraction().openCreate`, seeded with `new Date()` rather than
 * the viewed `date` since a shortcut press has no specific day/slot in mind.
 *
 * Ignored entirely while focus sits inside a text input, textarea, select, or
 * contenteditable region (e.g. while typing a title in the quick-create
 * popup itself), so a stray "d"/"n" keystroke while typing doesn't hijack the
 * view or pop open a second create popup.
 */
export function CalendarShortcuts({
  date,
  go,
}: {
  view: ViewType;
  date: Date;
  go(view: ViewType, date: Date): void;
}) {
  const { openCreate } = useCalendarInteraction();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "n") {
        openCreate("event", new Date());
        return;
      }

      const nextView = VIEW_FOR_KEY[key];
      if (nextView) {
        go(nextView, date);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [date, go, openCreate]);

  return null;
}
