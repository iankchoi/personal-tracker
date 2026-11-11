// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { RecurrenceScopeDialog } from "../../components/calendar/RecurrenceScopeDialog";

afterEach(() => {
  cleanup();
});

test("shows all three choices when allowThisEvent is true", () => {
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("button", { name: /this event/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /all events/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /this and following/i })).toBeInTheDocument();
});

test("omits 'This event' when allowThisEvent is false", () => {
  render(<RecurrenceScopeDialog allowThisEvent={false} onChoose={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /this event/i })).not.toBeInTheDocument();
});

test("clicking a choice calls onChoose with that scope", async () => {
  const onChoose = vi.fn();
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={onChoose} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /all events/i }));
  expect(onChoose).toHaveBeenCalledWith("all");
});

test("Escape calls onCancel, via the shared ModalShell", async () => {
  const onCancel = vi.fn();
  render(<RecurrenceScopeDialog allowThisEvent={true} onChoose={vi.fn()} onCancel={onCancel} />);
  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalled();
});
