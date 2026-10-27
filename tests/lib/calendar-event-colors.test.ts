import {
  colorIdForToken,
  resolveEventColorToken,
  tokenForColorId,
} from "../../lib/calendar-event-colors";
import { describe, test, expect } from "vitest";

describe("Calendar event colors", () => {
  test("colorIdForToken maps each of the 6 app tokens to a distinct Google colorId", () => {
    const ids = (["cal", "wk", "rem", "note", "jour", "cv"] as const).map(
      colorIdForToken
    );
    expect(new Set(ids).size).toBe(6);
  });

  test("colorIdForToken maps cal to Google's Peacock (7)", () => {
    expect(colorIdForToken("cal")).toBe("7");
  });

  test("tokenForColorId is the inverse of colorIdForToken for every app token", () => {
    for (const token of ["cal", "wk", "rem", "note", "jour", "cv"] as const) {
      expect(tokenForColorId(colorIdForToken(token))).toBe(token);
    }
  });

  test("tokenForColorId returns null for a colorId the app never writes (e.g. Lavender) and for undefined", () => {
    expect(tokenForColorId("1")).toBeNull();
    expect(tokenForColorId(undefined)).toBeNull();
  });

  describe("resolveEventColorToken", () => {
    const colorByCalendar = { primary: "wk" } as const;

    test("prefers the event's own colorId over its calendar's assigned color", () => {
      expect(
        resolveEventColorToken({ calendarId: "primary", colorId: colorIdForToken("cv") }, colorByCalendar),
      ).toBe("cv");
    });

    test("falls back to the calendar's assigned color when the event carries no colorId", () => {
      expect(resolveEventColorToken({ calendarId: "primary" }, colorByCalendar)).toBe("wk");
    });

    test("falls back to the calendar's color for a colorId outside the app's own 6-token mapping", () => {
      // Google's Lavender ("1"), e.g. set from another Calendar client — not an
      // app-level override, so the calendar's color still wins.
      expect(resolveEventColorToken({ calendarId: "primary", colorId: "1" }, colorByCalendar)).toBe("wk");
    });

    test("falls back to the app's blue when the calendar has no assigned color either", () => {
      expect(resolveEventColorToken({ calendarId: "unknown" }, colorByCalendar)).toBe("cal");
    });
  });
});
