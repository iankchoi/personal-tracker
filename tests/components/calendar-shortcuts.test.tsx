// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockOpenCreate } = vi.hoisted(() => ({
  mockOpenCreate: vi.fn(),
}));

vi.mock("../../components/calendar/CalendarInteractionProvider", () => ({
  useCalendarInteraction: () => ({
    popup: { mode: "closed" },
    openCreate: mockOpenCreate,
    openEditEvent: vi.fn(),
    openEditTask: vi.fn(),
    close: vi.fn(),
  }),
}));

import { CalendarShortcuts } from "../../components/calendar/CalendarShortcuts";

afterEach(() => {
  cleanup();
  mockOpenCreate.mockReset();
});

test("pressing N opens the create popup via the interaction context", async () => {
  render(<CalendarShortcuts view="week" date={new Date(2026, 9, 22)} go={vi.fn()} />);

  await userEvent.keyboard("n");

  expect(mockOpenCreate).toHaveBeenCalledWith("event", expect.any(Date));
});

test("pressing D/W/M/A navigates via go() to the matching view, preserving the current date", async () => {
  const go = vi.fn();
  const date = new Date(2026, 9, 22);
  render(<CalendarShortcuts view="week" date={date} go={go} />);

  await userEvent.keyboard("d");
  expect(go).toHaveBeenCalledWith("day", date);

  await userEvent.keyboard("w");
  expect(go).toHaveBeenCalledWith("week", date);

  await userEvent.keyboard("m");
  expect(go).toHaveBeenCalledWith("month", date);

  await userEvent.keyboard("a");
  expect(go).toHaveBeenCalledWith("agenda", date);

  expect(go).toHaveBeenCalledTimes(4);
});

test("a shortcut key typed while focus is inside a text input is ignored", async () => {
  function Harness() {
    return (
      <>
        <input aria-label="some field" />
        <CalendarShortcuts view="week" date={new Date(2026, 9, 22)} go={vi.fn()} />
      </>
    );
  }

  const { getByLabelText } = render(<Harness />);
  getByLabelText("some field").focus();

  await userEvent.keyboard("n");

  expect(mockOpenCreate).not.toHaveBeenCalled();
});
