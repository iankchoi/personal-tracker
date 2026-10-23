"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeTaskAction } from "../../lib/actions/calendar-tasks";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";

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
 * In Part 2 this component also becomes clickable to open the task editor;
 * that interaction is out of this task's scope.
 */
export function TaskCheckbox({ task }: { task: CalendarTaskItem }) {
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
      <span className={task.completed ? "task-title task-done" : "task-title"}>{task.title}</span>
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
