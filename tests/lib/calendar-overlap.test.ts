import { describe, test, expect } from "vitest";
import { layoutColumns, type PositionedGridItem } from "../../lib/calendar-overlap";
import type { CalendarTaskItem } from "../../lib/calendar-tasks-for-grid";
import type { GoogleCalendarEvent } from "../../lib/google-calendar";

/** Minimal `GoogleCalendarEvent` fixture; `layoutColumns` never reads into it, only carries it through. */
function mk(id: string, startMinute: number, durationMinute: number): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary: id,
    start: { dateTime: `2026-10-22T00:${String(startMinute).padStart(2, "0")}:00-04:00` },
    end: { dateTime: `2026-10-22T00:${String(startMinute + durationMinute).padStart(2, "0")}:00-04:00` },
  };
}

/** A positioned event block, in the tagged shape `layoutColumns` now takes. */
function ev(id: string, top: number, height: number): PositionedGridItem {
  return { kind: "event", item: mk(id, top, height), top, height };
}

/** A positioned task block — tasks go through the same `layoutColumns` call as events. */
function tk(id: string, top: number, height: number): PositionedGridItem {
  const task: CalendarTaskItem = {
    id,
    taskListId: "l1",
    title: id,
    completed: false,
    dueDate: "2026-10-22",
    dueTime: "09:00",
    colorToken: null,
  };
  return { kind: "task", item: task, top, height };
}

describe("calendar-overlap", () => {
  test("two non-overlapping events both get column 0 of a 1-column cluster", () => {
    const a = ev("a", 0, 60);
    const b = ev("b", 120, 60);
    expect(layoutColumns([a, b])).toEqual([
      { ...a, column: 0, columnCount: 1 },
      { ...b, column: 0, columnCount: 1 },
    ]);
  });

  test("two events overlapping in time split into 2 side-by-side columns", () => {
    const a = ev("a", 0, 60);
    const b = ev("b", 30, 60);
    const result = layoutColumns([a, b]);
    expect(result.map((r) => r.columnCount)).toEqual([2, 2]);
    expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1]));
  });

  test("three mutually overlapping events split into 3 columns", () => {
    // All three are active across the shared instant [60, 90).
    const a = ev("a", 0, 90);
    const b = ev("b", 30, 60);
    const c = ev("c", 60, 30);
    const result = layoutColumns([a, b, c]);
    expect(result.map((r) => r.columnCount)).toEqual([3, 3, 3]);
    expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1, 2]));
  });

  test("a 3rd event that overlaps only the 2nd of two already-overlapping events joins their cluster but reuses the freed column", () => {
    // a: [0,90), b: [60,150), c: [120,180) — a/b overlap, b/c overlap, a/c do not.
    //
    // CORRECTED after the final whole-branch review (controller ruling): this
    // case originally asserted `columnCount: 3`, which was a defect in the
    // plan's own test, not in the implementation. Hand-derivation of the peak
    // *simultaneous* occupancy across this fixture:
    //   - [60,90):  a and b are both open      -> 2 open
    //   - [90,120): only b is open             -> 1 open
    //   - [120,150): b and c are both open     -> 2 open
    // a, b and c are never all three open at the same instant, so the peak is
    // 2, not 3. Demanding 3 here would also mean any long chain of staggered
    // overlapping events (an ordinary busy day) grows `columnCount` without
    // bound while never being more than 2 deep — defeating the point of
    // side-by-side columns. `columnCount` is therefore the cluster's peak
    // simultaneous occupancy, and `c` reuses the column `a` vacated.
    const a = ev("a", 0, 90);
    const b = ev("b", 60, 90);
    const c = ev("c", 120, 60);
    const result = layoutColumns([a, b, c]);
    expect(result).toEqual([
      { ...a, column: 0, columnCount: 2 },
      { ...b, column: 1, columnCount: 2 },
      { ...c, column: 0, columnCount: 2 },
    ]);
    // Whatever the column numbers, no two blocks open at the same instant may
    // share one: a/b overlap and c/b overlap, so each pair must differ.
    expect(result[0].column).not.toBe(result[1].column);
    expect(result[2].column).not.toBe(result[1].column);
  });

  test("an event that starts exactly when an overlapping one ends does not count as overlapping (half-open interval)", () => {
    // a: [0,60), b: [60,120) -> both columnCount 1
    const a = ev("a", 0, 60);
    const b = ev("b", 60, 60);
    expect(layoutColumns([a, b])).toEqual([
      { ...a, column: 0, columnCount: 1 },
      { ...b, column: 0, columnCount: 1 },
    ]);
  });

  test("sorts by top ascending, breaking ties by longer height first", () => {
    // Same start; the shorter one is processed second but still overlaps,
    // so the longer one (which sorts first) should claim column 0.
    const short = ev("short", 0, 30);
    const long = ev("long", 0, 60);
    const result = layoutColumns([short, long]);
    const longResult = result.find((r) => r.item.id === "long");
    expect(longResult?.column).toBe(0);
  });

  test("a task overlapping an event shares the cluster instead of covering it full-width", () => {
    const event = ev("evt", 0, 60);
    const task = tk("task", 30, 28);
    const result = layoutColumns([event, task]);

    expect(result.map((r) => r.columnCount)).toEqual([2, 2]);
    expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1]));
    expect(result.map((r) => r.kind)).toEqual(["event", "task"]);
  });

  test("a task that overlaps nothing stays full-width in a 1-column cluster", () => {
    const event = ev("evt", 0, 60);
    const task = tk("task", 120, 28);
    const result = layoutColumns([event, task]);

    expect(result.map((r) => r.columnCount)).toEqual([1, 1]);
    expect(result.map((r) => r.column)).toEqual([0, 0]);
  });
});
