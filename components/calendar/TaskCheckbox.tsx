"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeTaskAction } from "../../lib/actions/calendar-tasks";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { usePointerDrag } from "./usePointerDrag";

/** Fallback color token for a task with no metadata row yet, matching the `FALLBACK_COLOR_TOKEN` convention events use elsewhere in this codebase. */
const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

/**
 * Formats a `CalendarTaskItem.dueTime` (`"HH:MM"`, 24-hour) as a 12-hour
 * wall-clock label, e.g. `"14:30"` -> `"2:30 PM"` — the same AM/PM
 * convention `formatTimeLabel`/`formatHourLabel` use for events in
 * `lib/calendar-dates.ts`/`HourGrid.tsx`, just applied to a bare `HH:MM`
 * string rather than a full offset-carrying ISO `dateTime` (tasks have no
 * such offset to read; `dueTime` is already wall-clock-local, see
 * `lib/calendar-tasks-for-grid.ts`).
 */
function formatTaskTime(dueTime: string): string {
  const [hourStr, minuteStr] = dueTime.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
}

/**
 * A single Google Task rendered on the calendar grid: a checkbox (toggling
 * `completed` via `completeTaskAction`) plus its title and, if it has one, a
 * formatted due time. Used by all four calendar views — directly by
 * `MonthView`/`AgendaView`, and by `HourGrid` (itself used by `DayView`/
 * `WeekView`) for both the all-day row and the positioned timed-block path.
 *
 * Completion state lives solely on the Google task — never duplicated into
 * local optimistic state, per the plan's Global Constraints — so after
 * `completeTaskAction` resolves this just calls `router.refresh()` to
 * re-pull the now-updated task list from the server. That's the simplest
 * correct option for a single-user app where the round trip is fast; it
 * avoids hand-rolling optimistic UI that would otherwise need to be
 * reconciled against the server's eventual response.
 *
 * Because the checkbox is controlled purely by `task.completed`, a failed
 * toggle would otherwise snap it silently back to its old state with no
 * explanation — so a rejected action is caught and surfaced as a short inline
 * message (the compact analog of the Calendar page's own `.error-block`;
 * there's no room for a dot-plus-retry row inside a grid chip). The checkbox
 * is also disabled while the action is in flight, so a double-click can't
 * fire two overlapping toggles that race each other.
 *
 * `onTitleClick`, when given, fires when the title text (not the checkbox
 * itself) is clicked — Part 2's calendar views pass `openEditTask` so clicking
 * a task's title opens the editor, while clicking its checkbox always stays a
 * pure complete-toggle. The title's native `onClick` calls `preventDefault` so
 * the browser's native "clicking inside a `<label>` activates its control"
 * behavior doesn't also flip the checkbox, and `stopPropagation` so the click
 * doesn't bubble into an ancestor cell's own click-to-create handler.
 *
 * When `dragHandlers` is supplied (Month view, Week/Day view), `onTitleClick`
 * is instead invoked from the caller's `usePointerDrag({ onClick: ... })`
 * option, exactly like the event chip's own click-vs-drag handling — never
 * from this native `onClick`. That split matters: `usePointerDrag`'s
 * `onPointerDown` calls `setPointerCapture`, and a captured element is where
 * browsers retarget the *trailing* compatibility `click` event even after a
 * real drag ends somewhere else on the page. If this native `onClick` also
 * called `onTitleClick` unconditionally, a real drag-to-reschedule would
 * reopen the task editor right after the drop, since that trailing `click`
 * still lands here. The `preventDefault`/`stopPropagation` pair still has to
 * run unconditionally, drag or not — nothing else suppresses that trailing
 * click from flipping the checkbox or bubbling up.
 */
export function TaskCheckbox({
  task,
  onTitleClick,
  dragHandlers,
}: {
  task: CalendarTaskItem;
  onTitleClick?(task: CalendarTaskItem): void;
  /**
   * Opt-in pointer-drag source for callers that support drag-to-reschedule
   * (Month view's day cells, the Week/Day hour grid's columns) — the four
   * handlers `usePointerDrag` returns, computed by the caller (which owns
   * the per-gesture "what's being dragged" state) and spread onto this same
   * title `<span>` that used to carry `draggable`/`onDragStart`/`onDragEnd`.
   * Applied to the title rather than the outer `<label>` — the title is a
   * direct sibling of the checkbox `<input>`, never its ancestor, so a
   * caller that doesn't pass this prop (e.g. `AgendaView`) gets no drag
   * handling at all, and one that does never makes the checkbox itself a
   * drag handle. Excludes `isDragging` — `usePointerDrag`'s other field,
   * not a DOM handler — so a caller that builds this via `{...drag, ...}`
   * can't accidentally let it ride along into the `{...dragHandlers}` spread
   * below and land on the title `<span>` as a stray DOM attribute.
   */
  dragHandlers?: Omit<ReturnType<typeof usePointerDrag>, "isDragging">;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const colorToken = task.colorToken ?? FALLBACK_COLOR_TOKEN;

  async function handleChange() {
    if (isPending) {
      return;
    }

    setIsPending(true);
    setFailed(false);

    try {
      await completeTaskAction({ taskListId: task.taskListId, taskId: task.id, completed: !task.completed });
      router.refresh();
    } catch (error) {
      console.error("Failed to update task completion:", error);
      setFailed(true);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <label className={`task-chip ${colorToken}`}>
      <input
        className="task-check"
        type="checkbox"
        checked={task.completed}
        disabled={isPending}
        onChange={handleChange}
      />
      <span
        className={task.completed ? "task-title task-done" : "task-title"}
        {...dragHandlers}
        onClick={
          onTitleClick || dragHandlers
            ? (event) => {
                // Must run unconditionally — drag or not, clicked or
                // dropped — see the doc comment above for why.
                event.preventDefault();
                event.stopPropagation();
                // Drag-aware callers drive `onTitleClick` through
                // `usePointerDrag`'s own `onClick` option instead; calling it
                // here too would double-fire it after a real drag, since
                // this native click trails behind that drag's `pointerup`.
                if (!dragHandlers) {
                  onTitleClick?.(task);
                }
              }
            : undefined
        }
      >
        {task.title}
      </span>
      {failed ? (
        <span className="task-error" role="alert">
          Couldn&apos;t update
        </span>
      ) : (
        task.dueTime && <span className="task-time">{formatTaskTime(task.dueTime)}</span>
      )}
    </label>
  );
}
