import type { CalendarColorToken } from "./calendar-colors";
import { localParts } from "./calendar-dates";
import type { GoogleTask } from "./google-tasks";
import type { TaskMetadataRow } from "./task-metadata";

/**
 * A Google Task merged with its local `task_metadata` row, shaped for the
 * Calendar grid/popup/editor components to render directly — the Tasks
 * analog of `GoogleCalendarEvent` (events don't need this merge step since
 * all their renderable state already lives on the Google object itself).
 */
export type CalendarTaskItem = {
  id: string;
  taskListId: string;
  title: string;
  notes?: string;
  completed: boolean;
  dueDate: string;
  dueTime: string | null;
  colorToken: CalendarColorToken | null;
};

/**
 * Formats a `TaskMetadataRow.dueAt` as a 24-hour `HH:MM` string (e.g.
 * `"14:30"`), matching the shape `TaskActionInput.dueTime` round-trips
 * through. Uses `localParts` (not `parseZonedDateTime`) because `dueAt` is a
 * real `Date` instant built from wall-clock input with no explicit offset
 * (see `lib/actions/calendar-tasks.ts`'s `parseDueAt`), not an
 * offset-carrying ISO string — the runtime's local accessors are the correct
 * frame to read it back through, same as `localParts`'s other use on plain
 * calendar dates / "now".
 */
function formatDueTime(dueAt: Date): string {
  const { hour, minute } = localParts(dueAt);
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/**
 * Merges a single task list's raw Google tasks with their local metadata
 * rows into render-ready `CalendarTaskItem`s.
 *
 * Tasks with no Google `due` date are excluded entirely — the plan's grid
 * has no "someday" bucket to put them in, so they'd have nowhere to render.
 * `dueDate` is derived from the first 10 characters of `due` (Google always
 * returns a date-only RFC3339 timestamp at midnight UTC, e.g.
 * `"2026-10-25T00:00:00.000Z"`), so no timezone math is needed. `dueTime`
 * and `colorToken` come from the matching metadata row (looked up by the
 * task's own `id`, i.e. the Google `googleTaskId`) when present, or `null`
 * when the row is absent or its `dueAt` is null.
 *
 * An empty `tasks` array (e.g. a task list with zero tasks, or iterating
 * over zero task lists) flows straight through to an empty result — no
 * special-casing needed, since `.filter`/`.map` on `[]` already yield `[]`.
 */
export function buildCalendarTaskItems(
  tasks: GoogleTask[],
  taskListId: string,
  metadataByTaskId: Map<string, TaskMetadataRow>,
): CalendarTaskItem[] {
  return tasks
    .filter((task) => Boolean(task.due))
    .map((task) => {
      const metadata = metadataByTaskId.get(task.id);

      return {
        id: task.id,
        taskListId,
        title: task.title,
        notes: task.notes,
        completed: task.status === "completed",
        dueDate: task.due!.slice(0, 10),
        dueTime: metadata?.dueAt ? formatDueTime(metadata.dueAt) : null,
        colorToken: metadata?.colorToken ?? null,
      };
    });
}
