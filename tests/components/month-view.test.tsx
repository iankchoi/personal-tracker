// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { CalendarInteractionProvider } from "../../components/calendar/CalendarInteractionProvider";
import { MonthView } from "../../components/calendar/MonthView";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#3b6ea5", accessRole: "owner" },
];
const colorByCalendar: Record<string, CalendarColorToken> = { primary: "cal" };
const REFERENCE_DATE = new Date(2026, 9, 22);

function timedEvent({
  id,
  summary,
  start,
}: {
  id: string;
  summary: string;
  start: string;
}): GoogleCalendarEvent {
  const startDate = new Date(start);
  const end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  return { id, calendarId: "primary", summary, start: { dateTime: start }, end: { dateTime: end } };
}

function allDayEvent({ id, summary }: { id: string; summary: string }): GoogleCalendarEvent {
  return { id, calendarId: "primary", summary, start: { date: "2026-10-20" }, end: { date: "2026-10-21" } };
}

function Harness({ events }: { events: GoogleCalendarEvent[] }) {
  return (
    <CalendarInteractionProvider calendars={calendars} taskLists={[]}>
      <MonthView
        referenceDate={REFERENCE_DATE}
        events={events}
        colorByCalendar={colorByCalendar}
        today={REFERENCE_DATE}
      />
    </CalendarInteractionProvider>
  );
}

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
});

test("a timed event's month chip shows its start time before the title", () => {
  render(<Harness events={[timedEvent({ id: "e1", summary: "Standup", start: "2026-10-20T09:00:00-04:00" })]} />);
  expect(screen.getByText("9:00 AM")).toBeInTheDocument();
  expect(screen.getByText("Standup")).toBeInTheDocument();
});

test("an all-day event's month chip has no time label", () => {
  render(<Harness events={[allDayEvent({ id: "e1", summary: "Holiday" })]} />);
  expect(screen.queryByText(/\d{1,2}:\d{2} (AM|PM)/)).not.toBeInTheDocument();
});
