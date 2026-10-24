"use client";

import type { GoogleCalendarListEntry } from "@/lib/google-calendar";
import type { GoogleTaskList } from "@/lib/google-tasks";

import type { PopupState } from "./CalendarInteractionProvider";
import { QuickCreatePopup } from "./QuickCreatePopup";

/**
 * Renders whichever popup/editor `popup` currently calls for, or nothing
 * when it's `{ mode: "closed" }`. `CalendarInteractionProvider` renders this
 * once, after its children, so it's always the single surface controlled by
 * `useCalendarInteraction()`.
 *
 * Only the `"create"` branch is real in this task — it renders the
 * lightweight `QuickCreatePopup`. The two edit branches (`"edit-event"`,
 * `"edit-task"`) are filled in by later tasks in this plan with the full
 * editor; a bare `null` for them here is intentional, not a gap.
 */
export function EventTaskModal(props: {
  popup: PopupState;
  calendars: GoogleCalendarListEntry[];
  taskLists: GoogleTaskList[];
  onClose(): void;
}) {
  const { popup, calendars, taskLists, onClose } = props;

  if (popup.mode === "create") {
    return (
      <QuickCreatePopup
        calendars={calendars}
        taskLists={taskLists}
        initial={{ kind: popup.kind, date: popup.date, hour: popup.hour }}
        // "More options" is meant to expand this into the full editor, built
        // by later tasks (3/4) in this plan. Until then there's nothing to
        // expand into, so this is intentionally a no-op rather than closing
        // the popup out from under the user.
        onMoreOptions={() => {}}
        onSaved={onClose}
        onCancel={onClose}
      />
    );
  }

  return null;
}
