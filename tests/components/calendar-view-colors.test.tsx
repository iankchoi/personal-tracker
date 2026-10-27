// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { mockCompleteTaskAction, mockRefresh } = vi.hoisted(() => ({
  mockCompleteTaskAction: vi.fn(),
  mockRefresh: vi.fn(),
}));

// The views reach TaskCheckbox, which imports the Tasks server action.
vi.mock("../../lib/actions/calendar-tasks", () => ({ completeTaskAction: mockCompleteTaskAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { AgendaView } from "../../components/calendar/AgendaView";
import { CalendarInteractionProvider } from "../../components/calendar/CalendarInteractionProvider";
import { HourGrid } from "../../components/calendar/HourGrid";
import { MonthView } from "../../components/calendar/MonthView";
import type { CalendarColorToken } from "../../lib/calendar-colors";
import { colorIdForToken } from "../../lib/calendar-event-colors";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "../../lib/google-calendar";

afterEach(() => {
  cleanup();
});

/**
 * The calendar the fixtures live on is assigned `wk` (green), so an event with
 * a `cv` (red) override has a genuinely *different* token to render with —
 * that difference is the whole point of these tests. A naive
 * `colorByCalendar[event.calendarId]` lookup returns `wk` for both fixtures.
 */
const COLOR_BY_CALENDAR: Record<string, CalendarColorToken> = { primary: "wk" };
const CALENDAR_TOKEN: CalendarColorToken = "wk";
const OVERRIDE_TOKEN: CalendarColorToken = "cv";

const DAY = new Date(2026, 9, 22);

const calendars: GoogleCalendarListEntry[] = [
  { id: "primary", summary: "Primary", backgroundColor: "#2f7a6b", accessRole: "owner" },
];

/** A timed event inside the hour grid's fixed window, optionally color-overridden. */
function timedEvent(id: string, summary: string, colorId?: string): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary,
    start: { dateTime: "2026-10-22T10:00:00.000Z" },
    end: { dateTime: "2026-10-22T11:00:00.000Z" },
    colorId,
  };
}

/** An all-day event on the same day — a separate render path in HourGrid (`.wg-chip`). */
function allDayEvent(id: string, summary: string, colorId?: string): GoogleCalendarEvent {
  return {
    id,
    calendarId: "primary",
    summary,
    start: { date: "2026-10-22" },
    end: { date: "2026-10-23" },
    colorId,
  };
}

function withProvider(children: React.ReactNode) {
  return (
    <CalendarInteractionProvider calendars={calendars} taskLists={[]}>
      {children}
    </CalendarInteractionProvider>
  );
}

/** The rendered element carrying `summary` as its text, whichever view produced it. */
function chipFor(summary: string): HTMLElement {
  return screen.getByText(summary);
}

// ---------------------------------------------------------------------------
// Fix 1 — a per-event colorId override has to actually render
// ---------------------------------------------------------------------------
//
// All three views used to compute an event's display token purely from
// `colorByCalendar[event.calendarId]`, never looking at `event.colorId` — the
// real Google field the editor's color picker writes. So a color picked in the
// editor saved correctly to Google and then rendered as the calendar's default
// anyway.

test("HourGrid renders a timed event's colorId override, not its calendar's assigned color", () => {
  render(
    withProvider(
      <HourGrid
        days={[DAY]}
        events={[timedEvent("e1", "Overridden", colorIdForToken(OVERRIDE_TOKEN))]}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  const block = chipFor("Overridden").closest(".wg-event") as HTMLElement;
  expect(block).toHaveClass(OVERRIDE_TOKEN);
  expect(block).not.toHaveClass(CALENDAR_TOKEN);
});

test("HourGrid still falls back to the calendar's color for an event with no colorId", () => {
  render(
    withProvider(
      <HourGrid
        days={[DAY]}
        events={[timedEvent("e1", "Plain")]}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  expect(chipFor("Plain").closest(".wg-event")).toHaveClass(CALENDAR_TOKEN);
});

test("HourGrid's all-day chips honor a colorId override too", () => {
  render(
    withProvider(
      <HourGrid
        days={[DAY]}
        events={[
          allDayEvent("a1", "Overridden all-day", colorIdForToken(OVERRIDE_TOKEN)),
          allDayEvent("a2", "Plain all-day"),
        ]}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  expect(chipFor("Overridden all-day")).toHaveClass(OVERRIDE_TOKEN);
  expect(chipFor("Plain all-day")).toHaveClass(CALENDAR_TOKEN);
});

test("MonthView renders a chip with the event's colorId override, and the calendar's color without one", () => {
  render(
    withProvider(
      <MonthView
        referenceDate={DAY}
        events={[
          timedEvent("e1", "Overridden", colorIdForToken(OVERRIDE_TOKEN)),
          timedEvent("e2", "Plain"),
        ]}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  expect(chipFor("Overridden")).toHaveClass("mg-chip", OVERRIDE_TOKEN);
  expect(chipFor("Overridden")).not.toHaveClass(CALENDAR_TOKEN);
  expect(chipFor("Plain")).toHaveClass("mg-chip", CALENDAR_TOKEN);
});

test("AgendaView's source pill uses the event's colorId override, and the calendar's color without one", () => {
  render(
    withProvider(
      <AgendaView
        referenceDate={DAY}
        events={[
          timedEvent("e1", "Overridden", colorIdForToken(OVERRIDE_TOKEN)),
          timedEvent("e2", "Plain"),
        ]}
        calendars={calendars}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  const overridden = chipFor("Overridden").closest(".rowcard") as HTMLElement;
  expect(overridden.querySelector(".src")).toHaveClass(OVERRIDE_TOKEN);
  expect(overridden.querySelector(".src")).not.toHaveClass(CALENDAR_TOKEN);

  const plain = chipFor("Plain").closest(".rowcard") as HTMLElement;
  expect(plain.querySelector(".src")).toHaveClass(CALENDAR_TOKEN);
});

test("a colorId Google reports but this app never writes (e.g. Lavender) falls back to the calendar's color", () => {
  // `tokenForColorId` returns null for an unmapped id, so the override step
  // has to miss rather than render an undefined class name.
  render(
    withProvider(
      <MonthView
        referenceDate={DAY}
        events={[timedEvent("e1", "Lavender elsewhere", "1")]}
        colorByCalendar={COLOR_BY_CALENDAR}
        today={DAY}
      />,
    ),
  );

  expect(chipFor("Lavender elsewhere")).toHaveClass("mg-chip", CALENDAR_TOKEN);
  expect(chipFor("Lavender elsewhere").className).not.toContain("undefined");
});
