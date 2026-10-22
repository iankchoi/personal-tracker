import { describe, test, expect } from "vitest";
import { getViewRange, navigateDate } from "../../lib/calendar-ranges";

describe("calendar-ranges", () => {
  // NOTE: The task brief (task-5-brief.md) asserts 2026-10-22 is a Wednesday and
  // builds this test's expectations (and the original week-start test below) on
  // that premise. It is actually a Thursday (verified via `new Date(2026, 9, 22).getDay()`
  // === 4). The brief's own cross-month week test (below, referencing Oct 29) was
  // computed correctly against the real calendar and would be unsatisfiable by any
  // consistent date-math implementation if this test kept the brief's literal
  // "Wednesday"/Oct 19 values (Oct 22 and Oct 29 are 7 days apart and must share a
  // weekday). Corrected here to match the real calendar; see task-5-report.md.
  test("getViewRange('day', ...) spans exactly one day and labels it in full", () => {
    const range = getViewRange("day", new Date(2026, 9, 22));
    expect(range.start).toEqual(new Date(2026, 9, 22, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 9, 23, 0, 0, 0));
    expect(range.label).toBe("Thursday, October 22, 2026");
  });

  test("getViewRange('week', ...) starts on Sunday and spans 7 days", () => {
    const range = getViewRange("week", new Date(2026, 9, 22));
    expect(range.start).toEqual(new Date(2026, 9, 18, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 9, 25, 0, 0, 0));
    expect(range.label).toBe("October 18–24, 2026");
  });

  test("getViewRange('week', ...) labels a week that crosses a month boundary correctly", () => {
    const range = getViewRange("week", new Date(2026, 9, 29));
    expect(range.label).toBe("Oct 25 – Oct 31, 2026");
  });

  test("getViewRange('month', ...) spans the full calendar month", () => {
    const range = getViewRange("month", new Date(2026, 9, 22));
    expect(range.start).toEqual(new Date(2026, 9, 1, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 10, 1, 0, 0, 0));
    expect(range.label).toBe("October 2026");
  });

  test("getViewRange('agenda', ...) spans 14 days from the reference date", () => {
    const range = getViewRange("agenda", new Date(2026, 9, 22));
    expect(range.start).toEqual(new Date(2026, 9, 22, 0, 0, 0));
    expect(range.end).toEqual(new Date(2026, 10, 5, 0, 0, 0));
    expect(range.label).toBe("Oct 22 – Nov 4, 2026");
  });

  test("navigateDate('day', ..., 'next') moves forward exactly one day", () => {
    expect(navigateDate("day", new Date(2026, 9, 22), "next")).toEqual(new Date(2026, 9, 23));
  });

  test("navigateDate('month', ..., 'prev') moves to the same day one month earlier", () => {
    expect(navigateDate("month", new Date(2026, 9, 22), "prev")).toEqual(new Date(2026, 8, 22));
  });

  test("navigateDate('agenda', ..., 'next') moves forward 14 days", () => {
    expect(navigateDate("agenda", new Date(2026, 9, 22), "next")).toEqual(new Date(2026, 10, 5));
  });
});
