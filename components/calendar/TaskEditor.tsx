"use client";

import { useState } from "react";

import { createTaskAction, deleteTaskAction, updateTaskAction, type TaskActionInput } from "../../lib/actions/calendar-tasks";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { GoogleTaskList } from "../../lib/google-tasks";

import { ColorPicker } from "./ColorPicker";

/** Icons match `EventEditor`'s inline-SVG style: `viewBox="0 0 24 24"`, 16x16 via CSS, `stroke-width: 1.6`, `stroke: currentColor`, no fill. */
const ClockIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);
const ListIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M4 6h2M4 12h2M4 18h2" />
    <path d="M9 6h11M9 12h11M9 18h11" />
  </svg>
);
const DocumentIcon = (
  <svg viewBox="0 0 24 24">
    <path d="M4 4h12l4 4v12H4z" />
    <path d="M14 4v5h5" />
  </svg>
);
const ColorRingIcon = (
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="7" r="1.4" />
    <circle cx="16.3" cy="14.5" r="1.4" />
    <circle cx="7.7" cy="14.5" r="1.4" />
  </svg>
);

/** Formats a `Date` as the `YYYY-MM-DD` shape `<input type="date">` expects, in local time — same convention as `EventEditor`'s `dateInputValue`. */
function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The full Task editor ("More options" from the quick-create popup, and
 * always for editing an existing task). Builds a `TaskActionInput` on Save
 * and calls `createTaskAction`/`updateTaskAction`; calls `deleteTaskAction`
 * on Delete. Mirrors `EventEditor`'s Save/Delete/error pattern, but with no
 * location/guests/Meet/Repeat fields — Tasks never get those, per the design
 * doc.
 *
 * Unlike `EventEditor`'s `addGoogleMeet`/`notifyMinutesBefore`, none of this
 * editor's fields (`dueDate`, `dueTime`, `colorToken`) generate an external
 * side effect on re-send — `task_metadata` is just a local table upserted
 * wholesale on every save — so there's no touched-tracking here: `dueDate`/
 * `dueTime`/`colorToken` are seeded directly from `initial.dueDate`/
 * `initial.dueTime`/`initial.colorToken` (never coalesced to some other
 * default that would differ from the task's actual current value), and an
 * untouched field simply resends that same already-correct value on Save —
 * a harmless no-op rather than a silent change.
 */
export function TaskEditor(props: {
  mode: "create" | "edit";
  initial: Partial<TaskActionInput> & { taskId?: string; taskListId: string };
  taskLists: GoogleTaskList[];
  onSaved(): void;
  onDeleted(): void;
  onCancel(): void;
}) {
  const { mode, initial, taskLists, onSaved, onDeleted, onCancel } = props;

  // "Today" is only ever used as a brand-new create session's fallback (no
  // clicked date to seed from) — mirroring EventEditor's own defaultWhen().
  // In edit mode `initial.dueDate` always comes from the task's real
  // `CalendarTaskItem.dueDate` (a required field), so this fallback never
  // fires there and can never clobber a real due date.
  const [title, setTitle] = useState(initial.title ?? "");
  const [dueDate, setDueDate] = useState(initial.dueDate ?? dateInputValue(new Date()));
  const [dueTime, setDueTime] = useState(initial.dueTime ?? "");
  const [taskListId, setTaskListId] = useState(initial.taskListId);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [colorToken, setColorToken] = useState<CalendarColorToken | null>(initial.colorToken ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const input: TaskActionInput = {
        taskListId,
        title,
        dueDate,
        dueTime: dueTime || null,
        notes: notes || undefined,
        colorToken,
      };

      if (mode === "create") {
        await createTaskAction(input);
      } else {
        await updateTaskAction({ ...input, taskId: initial.taskId! });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial.taskId) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteTaskAction({ taskListId, taskId: initial.taskId });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="event-editor" role="dialog" aria-label={mode === "create" ? "Create task" : "Edit task"}>
      {error && (
        <p className="ee-error" role="alert">
          {error}
        </p>
      )}

      <input
        className="ee-title-input"
        type="text"
        placeholder="Add title"
        aria-label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="ee-row">
        <span className="ee-icon">{ClockIcon}</span>
        <input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <input
          type="time"
          aria-label="Due time"
          value={dueTime}
          onChange={(event) => setDueTime(event.target.value)}
        />
      </div>

      <div className="ee-row">
        <span className="ee-icon">{ListIcon}</span>
        <select aria-label="Task list" value={taskListId} onChange={(event) => setTaskListId(event.target.value)}>
          {taskLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.title}
            </option>
          ))}
        </select>
      </div>

      <div className="ee-row ee-description">
        <span className="ee-icon">{DocumentIcon}</span>
        <textarea
          placeholder="Add description"
          aria-label="Description"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="ee-row">
        <span className="ee-icon">{ColorRingIcon}</span>
        <ColorPicker value={colorToken} onChange={setColorToken} />
      </div>

      <div className="ee-actions">
        {mode === "edit" && initial.taskId && (
          <button type="button" className="ee-delete" onClick={handleDelete} disabled={deleting}>
            Delete
          </button>
        )}
        <span className="ee-spacer" />
        <button type="button" className="ee-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ee-save" onClick={handleSave} disabled={saving}>
          Save
        </button>
      </div>
    </div>
  );
}
