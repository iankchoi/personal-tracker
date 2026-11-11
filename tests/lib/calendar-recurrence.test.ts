import { describe, test, expect } from "vitest";
import { buildRRule, parseRRule, truncateRRuleBefore, isFirstOccurrence, type RecurrenceRule } from "../../lib/calendar-recurrence";

describe("buildRRule", () => {
  test("buildRRule builds a daily rule with no end condition", () => {
    expect(buildRRule({ freq: "DAILY", interval: 1, end: { type: "never" } }, new Date(2026, 10, 11)))
      .toBe("RRULE:FREQ=DAILY");
  });

  test("buildRRule builds an every-2-weeks rule on the event's own start weekday", () => {
    // 2026-11-11 is a Wednesday
    expect(buildRRule({ freq: "WEEKLY", interval: 2, end: { type: "never" } }, new Date(2026, 10, 11)))
      .toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
  });

  test("buildRRule includes INTERVAL only when it's greater than 1", () => {
    expect(buildRRule({ freq: "MONTHLY", interval: 1, end: { type: "never" } }, new Date(2026, 10, 11)))
      .toBe("RRULE:FREQ=MONTHLY");
  });

  test("buildRRule renders an onDate end as UNTIL in Google's all-day UTC form", () => {
    expect(
      buildRRule({ freq: "WEEKLY", interval: 1, end: { type: "onDate", date: "2026-12-31" } }, new Date(2026, 10, 11)),
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z");
  });

  test("buildRRule renders an afterCount end as COUNT", () => {
    expect(buildRRule({ freq: "DAILY", interval: 1, end: { type: "afterCount", count: 5 } }, new Date(2026, 10, 11)))
      .toBe("RRULE:FREQ=DAILY;COUNT=5");
  });
});

describe("parseRRule", () => {
  test("parseRRule is buildRRule's inverse for a never-ending every-2-weeks rule", () => {
    const rule: RecurrenceRule = { freq: "WEEKLY", interval: 2, end: { type: "never" } };
    expect(parseRRule(buildRRule(rule, new Date(2026, 10, 11)))).toEqual(rule);
  });

  test("parseRRule reads an UNTIL date back as an onDate end", () => {
    expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T235959Z")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      end: { type: "onDate", date: "2026-12-31" },
    });
  });

  test("parseRRule reads a COUNT back as an afterCount end", () => {
    expect(parseRRule("RRULE:FREQ=DAILY;COUNT=5")).toEqual({
      freq: "DAILY",
      interval: 1,
      end: { type: "afterCount", count: 5 },
    });
  });

  test("parseRRule defaults interval to 1 when INTERVAL is absent", () => {
    expect(parseRRule("RRULE:FREQ=MONTHLY").interval).toBe(1);
  });
});

describe("truncateRRuleBefore and isFirstOccurrence", () => {
  test("truncateRRuleBefore sets UNTIL to end the day before the given occurrence", () => {
    expect(truncateRRuleBefore("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", new Date(2026, 11, 9)))
      .toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261208T235959Z");
  });

  test("truncateRRuleBefore replaces an existing UNTIL or COUNT rather than appending a second one", () => {
    const result = truncateRRuleBefore("RRULE:FREQ=DAILY;COUNT=20", new Date(2026, 11, 9));
    expect(result).toBe("RRULE:FREQ=DAILY;UNTIL=20261208T235959Z");
  });

  test("isFirstOccurrence is true when the occurrence's own start equals the master's start", () => {
    expect(isFirstOccurrence("2026-11-11T09:00:00-05:00", "2026-11-11T09:00:00-05:00")).toBe(true);
  });

  test("isFirstOccurrence is false for a later occurrence", () => {
    expect(isFirstOccurrence("2026-11-11T09:00:00-05:00", "2026-11-25T09:00:00-05:00")).toBe(false);
  });

  test("isFirstOccurrence compares date-only (all-day) start strings too", () => {
    expect(isFirstOccurrence("2026-11-11", "2026-11-11")).toBe(true);
    expect(isFirstOccurrence("2026-11-11", "2026-11-25")).toBe(false);
  });
});
