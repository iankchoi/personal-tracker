import { colorIdForToken, tokenForColorId } from "../../lib/calendar-event-colors";
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
});
