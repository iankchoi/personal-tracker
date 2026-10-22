// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { ThemeToggle } from "../../components/shell/ThemeToggle";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

test("clicking the toggle flips data-theme and persists to localStorage", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: /dark mode|light mode/i }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
});
