import type { CalendarColorToken } from "./calendar-colors";
import type { GoogleCalendarEvent } from "./google-calendar";

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

/**
 * Fallback color token for an event whose `calendarId` is somehow missing from
 * `colorByCalendar` — the app's blue, matching the editor's own default swatch.
 */
export const FALLBACK_COLOR_TOKEN: CalendarColorToken = "cal";

/**
 * The color token an event should actually *render* with, resolving the design
 * spec's stated precedence in the one place every view calls:
 *
 * 1. the event's own `colorId` (the per-item override the color picker writes
 *    through `buildEventPayload`), mapped back through `tokenForColorId`;
 * 2. otherwise its calendar's assigned token (the per-*calendar* color
 *    assignment from the read-only-views work, unchanged);
 * 3. otherwise `FALLBACK_COLOR_TOKEN`.
 *
 * This exists because all four rendering surfaces (`HourGrid`, `MonthView`,
 * `AgendaView`, `DayDetailView`) used to compute the token straight from
 * `colorByCalendar` and never look at `colorId` at all — so picking a color in
 * the editor wrote the right `colorId` to Google but the grid kept painting the
 * calendar's default. Keeping the precedence here rather than inline in each
 * view is what stops the four from drifting apart again.
 *
 * Tasks deliberately don't go through this: a `CalendarTaskItem` carries its own
 * local `colorToken` (Google Tasks has no color field), which `TaskCheckbox`
 * resolves itself.
 */
export function resolveEventColorToken(
  event: Pick<GoogleCalendarEvent, "calendarId" | "colorId">,
  colorByCalendar: Record<string, CalendarColorToken>,
): CalendarColorToken {
  return tokenForColorId(event.colorId) ?? colorByCalendar[event.calendarId] ?? FALLBACK_COLOR_TOKEN;
}
