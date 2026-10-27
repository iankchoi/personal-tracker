import { expect, test } from "vitest";

import { allDayEndToExclusive, allDayEndToInclusive } from "../../lib/calendar-dates";

test("allDayEndToInclusive turns Google's exclusive all-day end.date into the inclusive last day", () => {
  // Google reports a one-day event on Oct 25 as start 10-25 / end 10-26.
  expect(allDayEndToInclusive("2026-10-26")).toBe("2026-10-25");
  // A three-day event, Oct 25-27.
  expect(allDayEndToInclusive("2026-10-28")).toBe("2026-10-27");
});

test("allDayEndToExclusive turns the inclusive last day back into Google's exclusive end.date", () => {
  expect(allDayEndToExclusive("2026-10-25")).toBe("2026-10-26");
  expect(allDayEndToExclusive("2026-10-27")).toBe("2026-10-28");
});

test("both directions roll over month and year boundaries", () => {
  expect(allDayEndToExclusive("2026-10-31")).toBe("2026-11-01");
  expect(allDayEndToInclusive("2026-11-01")).toBe("2026-10-31");
  expect(allDayEndToExclusive("2026-12-31")).toBe("2027-01-01");
  expect(allDayEndToInclusive("2027-01-01")).toBe("2026-12-31");
  // Leap day, both ways.
  expect(allDayEndToExclusive("2028-02-28")).toBe("2028-02-29");
  expect(allDayEndToInclusive("2028-03-01")).toBe("2028-02-29");
});

test("the two are exact inverses of each other", () => {
  for (const date of ["2026-01-01", "2026-02-28", "2026-06-15", "2026-12-31"]) {
    expect(allDayEndToInclusive(allDayEndToExclusive(date))).toBe(date);
    expect(allDayEndToExclusive(allDayEndToInclusive(date))).toBe(date);
  }
});

test("a value that isn't a YYYY-MM-DD date passes through unchanged instead of throwing", () => {
  // An `<input type="date">` reports "" while empty or mid-edit, and the save
  // path must not blow up before the editor's own validation can speak.
  expect(allDayEndToExclusive("")).toBe("");
  expect(allDayEndToInclusive("")).toBe("");
  expect(allDayEndToExclusive("2026-10")).toBe("2026-10");
});
