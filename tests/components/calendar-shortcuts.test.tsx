// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockOpenCreate, popupState } = vi.hoisted(() => ({
  mockOpenCreate: vi.fn(),
  // Mutable so a single test can put the shared interaction state into
  // "an editor is open" without re-mocking the whole module.
  popupState: { current: { mode: "closed" } as { mode: string } },
}));

vi.mock("../../components/calendar/CalendarInteractionProvider", () => ({
  useCalendarInteraction: () => ({
    popup: popupState.current,
    sessionId: 0,
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
  popupState.current = { mode: "closed" };
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

// Fix 12.1 — ⌘A/⌘D/⌘N (and the Ctrl/Alt equivalents) are browser/OS
// shortcuts; firing this app's single-letter handlers alongside them meant a
// ⌘A both selected the page and navigated to Agenda view.
test("a shortcut key pressed with a modifier held is ignored", async () => {
  const go = vi.fn();
  render(<CalendarShortcuts view="week" date={new Date(2026, 9, 22)} go={go} />);

  await userEvent.keyboard("{Meta>}a{/Meta}");
  await userEvent.keyboard("{Control>}d{/Control}");
  await userEvent.keyboard("{Alt>}m{/Alt}");
  await userEvent.keyboard("{Meta>}n{/Meta}");

  expect(go).not.toHaveBeenCalled();
  expect(mockOpenCreate).not.toHaveBeenCalled();
});

// Fix 12.2 — clicking any non-input control inside an open editor (the Meet
// toggle, a color swatch, Save) leaves focus on a <button>, which the
// "focus is in a form field" check never caught.
test("every shortcut is ignored while a popup/editor is open, whatever holds focus", async () => {
  popupState.current = { mode: "edit-event" };
  const go = vi.fn();
  render(
    <>
      <button type="button">Add Google Meet video conferencing</button>
      <CalendarShortcuts view="week" date={new Date(2026, 9, 22)} go={go} />
    </>,
  );

  document.querySelector("button")?.focus();

  await userEvent.keyboard("d");
  await userEvent.keyboard("a");
  await userEvent.keyboard("n");

  expect(go).not.toHaveBeenCalled();
  expect(mockOpenCreate).not.toHaveBeenCalled();
});
