import { CalendarColorToken } from "./calendar-colors";

export const TOKEN_TO_COLOR_ID: Record<CalendarColorToken, string> = {
  cal: "7", // Peacock
  wk: "2", // Sage
  rem: "5", // Banana
  note: "10", // Basil
  jour: "3", // Grape
  cv: "11", // Tomato
};

export function colorIdForToken(token: CalendarColorToken): string {
  return TOKEN_TO_COLOR_ID[token];
}

export function tokenForColorId(
  colorId: string | undefined
): CalendarColorToken | null {
  if (colorId === undefined) {
    return null;
  }

  // Build reverse mapping
  for (const [token, id] of Object.entries(TOKEN_TO_COLOR_ID)) {
    if (id === colorId) {
      return token as CalendarColorToken;
    }
  }

  return null;
}
