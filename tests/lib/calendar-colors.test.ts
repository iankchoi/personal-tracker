import { describe, test, expect } from "vitest";
import { assignCalendarColors } from "../../lib/calendar-colors";

describe("calendar-colors", () => {
  test("assignCalendarColors cycles through the six tokens in input order", () => {
    const result = assignCalendarColors(["primary", "work@group.calendar.google.com", "birthdays"]);

    expect(result).toEqual({
      primary: "cal",
      "work@group.calendar.google.com": "wk",
      birthdays: "rem",
    });
  });

  test("assignCalendarColors wraps around after six calendars", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];

    const result = assignCalendarColors(ids);

    expect(result.a).toBe("cal");
    expect(result.g).toBe("cal");
  });
});
