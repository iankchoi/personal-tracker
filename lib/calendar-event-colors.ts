import type { CalendarColorToken } from "./calendar-colors";

export const TOKEN_TO_COLOR_ID: Record<CalendarColorToken, string> = {
  cal: "7", // Peacock
  wk: "2", // Sage
  rem: "5", // Banana
  note: "10", // Basil
  jour: "3", // Grape
  cv: "11", // Tomato
};

/**
 * `TOKEN_TO_COLOR_ID` inverted — built once here at module load rather than
 * re-scanned on every `tokenForColorId` call. The table is a fixed, immutable
 * 6-entry mapping, so one eager inversion is all that's ever needed.
 *
 * Only the `colorId`s this app actually writes appear as keys; Google's other
 * enum values (e.g. "1" Lavender, set by another Calendar client) simply miss,
 * which is how `tokenForColorId` reports "no app-level override".
 */
const COLOR_ID_TO_TOKEN: Record<string, CalendarColorToken> = Object.fromEntries(
  Object.entries(TOKEN_TO_COLOR_ID).map(([token, colorId]) => [colorId, token as CalendarColorToken]),
);

export function colorIdForToken(token: CalendarColorToken): string {
  return TOKEN_TO_COLOR_ID[token];
}

/**
 * Maps a Google `colorId` back to the app color token that wrote it, or
 * `null` for an absent `colorId` or one outside the app's own mapping —
 * meaning "no per-event override, use the calendar's assigned color".
 */
export function tokenForColorId(colorId: string | undefined): CalendarColorToken | null {
  if (colorId === undefined) {
    return null;
  }

  return COLOR_ID_TO_TOKEN[colorId] ?? null;
}
