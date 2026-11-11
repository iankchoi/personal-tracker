"use client";

import type { RecurrenceEditScope } from "../../lib/actions/calendar-events";
import { ModalShell } from "./ModalShell";

/**
 * A dialog presenting three choices for the scope of a recurring event edit:
 * "This event" (this), "All events" (all), or "This and following events"
 * (following). When allowThisEvent is false, "This event" is omitted.
 *
 * Rendered inside ModalShell to inherit Escape-closes-modal behavior.
 */
export function RecurrenceScopeDialog({
  allowThisEvent,
  onChoose,
  onCancel,
}: {
  allowThisEvent: boolean;
  onChoose(scope: RecurrenceEditScope): void;
  onCancel(): void;
}) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="recurrence-scope-dialog">
        <h2>Edit which events?</h2>
        <div className="rsd-buttons">
          {allowThisEvent && (
            <button
              type="button"
              className="rsd-choice"
              onClick={() => onChoose("this")}
            >
              This event
            </button>
          )}
          <button
            type="button"
            className="rsd-choice"
            onClick={() => onChoose("all")}
          >
            All events
          </button>
          <button
            type="button"
            className="rsd-choice"
            onClick={() => onChoose("following")}
          >
            This and following events
          </button>
        </div>
        <div className="rsd-actions">
          <button
            type="button"
            className="rsd-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
