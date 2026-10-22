export type CalendarColorToken = "cal" | "wk" | "rem" | "note" | "jour" | "cv";

const COLOR_TOKENS: CalendarColorToken[] = ["cal", "wk", "rem", "note", "jour", "cv"];

export function assignCalendarColors(
  calendarIds: string[]
): Record<string, CalendarColorToken> {
  const result: Record<string, CalendarColorToken> = {};

  calendarIds.forEach((id, index) => {
    const tokenIndex = index % COLOR_TOKENS.length;
    result[id] = COLOR_TOKENS[tokenIndex];
  });

  return result;
}
