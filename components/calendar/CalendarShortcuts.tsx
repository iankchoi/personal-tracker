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
 * Ignored entirely in three cases:
 *
 * 1. **A modifier is held.** `⌘A`/`⌘D`/`⌘N` (and the Ctrl/Alt equivalents)
 *    are browser and OS shortcuts — Select All, Bookmark, New Window — and
 *    firing this app's single-letter handlers alongside them meant a `⌘A`
 *    both selected the page *and* navigated to Agenda view.
 * 2. **A popup/editor is open.** Checked via `popup.mode !== "closed"` rather
 *    than by inspecting focus: clicking any non-input control inside an
 *    editor (the Meet toggle, a color swatch, Save) leaves focus on a
 *    `<button>`, which `isTypingTarget` doesn't catch — so continuing to type
 *    could hijack the view mid-edit. Shortcuts firing *at all* while a modal
 *    is open is the actual problem, whatever happens to hold focus.
 * 3. **Focus sits in a text input, textarea, select, or contenteditable
 *    region**, so a stray "d"/"n" typed into any field elsewhere on the page
 *    doesn't hijack the view either.
 */
export function CalendarShortcuts({
  date,
  go,
}: {
  view: ViewType;
  date: Date;
  go(view: ViewType, date: Date): void;
}) {
  const { popup, openCreate } = useCalendarInteraction();
  const popupIsOpen = popup.mode !== "closed";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (popupIsOpen) {
        return;
      }

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
  }, [date, go, openCreate, popupIsOpen]);

  return null;
}
