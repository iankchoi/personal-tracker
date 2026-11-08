"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The shared overlay chrome every create/edit surface renders inside: a
 * semi-transparent full-viewport backdrop plus a centered, `position: fixed`
 * card that scrolls internally when its contents are taller than the
 * viewport.
 *
 * This exists because `QuickCreatePopup`, `EventEditor` and `TaskEditor` are
 * all plain in-flow `<div>`s — rendered as-is they land *below* the
 * full-height calendar grid, so "click a slot" produced no visible change
 * anywhere near the fold. Rather than teaching each of the three its own
 * `position: fixed`/backdrop/z-index/dismissal behavior (three chances to
 * drift apart), `EventTaskModal` wraps whichever one it renders in this single
 * shell, so all three are overlays with identical dismissal semantics:
 *
 * - **Escape closes.** A single document-level `keydown` listener, so it works
 *   no matter which control inside the card has focus.
 * - **Backdrop click closes.** Only a click whose target *is* the backdrop
 *   itself — a click on any control inside the card bubbles up here but is
 *   ignored, and a click that merely ends on the backdrop after starting
 *   inside the card (a text-selection drag) is ignored too, because the
 *   mousedown/mouseup pair has to agree.
 * - **Focus moves into the card on open**, via `tabIndex={-1}` plus a mount
 *   `.focus()`, so the keyboard isn't left stranded on whatever grid cell was
 *   clicked and Escape/Tab both land somewhere sensible.
 */
export function ModalShell({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    // The backdrop is a presentational scrim, not an interactive control —
    // Escape (above) is the keyboard-accessible equivalent of clicking it, and
    // every real action (Cancel/Save/Delete) is a focusable button inside the
    // card, so there's nothing here a keyboard user can't reach.
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) {
          onClose();
        }
        pressedBackdrop.current = false;
      }}
    >
      <div className="modal-card" ref={cardRef} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
