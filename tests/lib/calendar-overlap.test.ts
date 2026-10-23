import { describe, test, expect } from "vitest";
import { layoutColumns } from "../../lib/calendar-overlap";
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

describe("calendar-overlap", () => {
  test("two non-overlapping events both get column 0 of a 1-column cluster", () => {
    const a = { event: mk("a", 0, 60), top: 0, height: 60 };
    const b = { event: mk("b", 120, 60), top: 120, height: 60 };
    expect(layoutColumns([a, b])).toEqual([
      { ...a, column: 0, columnCount: 1 },
      { ...b, column: 0, columnCount: 1 },
    ]);
  });

  test("two events overlapping in time split into 2 side-by-side columns", () => {
    const a = { event: mk("a", 0, 60), top: 0, height: 60 };
    const b = { event: mk("b", 30, 60), top: 30, height: 60 };
    const result = layoutColumns([a, b]);
    expect(result.map((r) => r.columnCount)).toEqual([2, 2]);
    expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1]));
  });

  test("three mutually overlapping events split into 3 columns", () => {
    // All three are active across the shared instant [60, 90).
    const a = { event: mk("a", 0, 90), top: 0, height: 90 };
    const b = { event: mk("b", 30, 60), top: 30, height: 60 };
    const c = { event: mk("c", 60, 30), top: 60, height: 30 };
    const result = layoutColumns([a, b, c]);
    expect(result.map((r) => r.columnCount)).toEqual([3, 3, 3]);
    expect(new Set(result.map((r) => r.column))).toEqual(new Set([0, 1, 2]));
  });

  test("a 3rd event that overlaps only the 1st of two already-overlapping events still joins their cluster (transitively) and gets its own column", () => {
    // a: [0,90), b: [60,150), c: [120,180) — a/b overlap, b/c overlap, a/c do not — all three still form one cluster of width 3.
    const a = { event: mk("a", 0, 90), top: 0, height: 90 };
    const b = { event: mk("b", 60, 90), top: 60, height: 90 };
    const c = { event: mk("c", 120, 60), top: 120, height: 60 };
    const result = layoutColumns([a, b, c]);
    expect(result).toEqual([
      { ...a, column: 0, columnCount: 3 },
      { ...b, column: 1, columnCount: 3 },
      { ...c, column: 2, columnCount: 3 },
    ]);
  });

  test("an event that starts exactly when an overlapping one ends does not count as overlapping (half-open interval)", () => {
    // a: [0,60), b: [60,120) -> both columnCount 1
    const a = { event: mk("a", 0, 60), top: 0, height: 60 };
    const b = { event: mk("b", 60, 60), top: 60, height: 60 };
    expect(layoutColumns([a, b])).toEqual([
      { ...a, column: 0, columnCount: 1 },
      { ...b, column: 0, columnCount: 1 },
    ]);
  });

  test("sorts by top ascending, breaking ties by longer height first", () => {
    // Same start; the shorter one is processed second but still overlaps,
    // so the longer one (which sorts first) should claim column 0.
    const short = { event: mk("short", 0, 30), top: 0, height: 30 };
    const long = { event: mk("long", 0, 60), top: 0, height: 60 };
    const result = layoutColumns([short, long]);
    const longResult = result.find((r) => r.event.id === "long");
    expect(longResult?.column).toBe(0);
  });
});
