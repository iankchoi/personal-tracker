import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const DEFAULT_THRESHOLD = 4;

/**
 * Shared pointer-event mechanics for calendar drag-to-reschedule: tracks a
 * pointer from `pointerdown` through either a plain click (no movement past
 * `threshold`) or a drag (movement past it), replacing native HTML5
 * drag-and-drop whose visual feedback doesn't render reliably in Safari.
 * Month view and Week/Day view each spread the returned handlers onto their
 * draggable elements and supply their own `onMove`/`onDrop` to reposition
 * and commit a reschedule.
 */
export function usePointerDrag(options: {
  onClick(): void;
  onMove(clientX: number, clientY: number): void;
  onDrop(clientX: number, clientY: number): void;
  threshold?: number;
}) {
  const { onClick, onMove, onDrop, threshold = DEFAULT_THRESHOLD } = options;
  const [isDragging, setIsDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  function onPointerDown(event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY };
    isDraggingRef.current = false;
  }

  function onPointerMove(event: ReactPointerEvent) {
    const start = startRef.current;
    if (!start) {
      return;
    }

    if (!isDraggingRef.current) {
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance < threshold) {
        return;
      }
      isDraggingRef.current = true;
      setIsDragging(true);
    }

    onMove(event.clientX, event.clientY);
  }

  function onPointerUp(event: ReactPointerEvent) {
    if (!startRef.current) {
      return;
    }

    if (isDraggingRef.current) {
      onDrop(event.clientX, event.clientY);
    } else {
      onClick();
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    startRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
  }

  function onPointerCancel() {
    startRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
  }

  return { isDragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
