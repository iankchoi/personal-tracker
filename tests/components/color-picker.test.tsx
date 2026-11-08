// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { ColorPicker } from "../../components/calendar/ColorPicker";

afterEach(() => {
  cleanup();
});

test("renders one swatch per app color token, with cal selected by default when value is null", () => {
  render(<ColorPicker value={null} onChange={vi.fn()} />);

  expect(screen.getAllByRole("radio")).toHaveLength(6);
  expect(screen.getByRole("radio", { name: /blue/i })).toBeChecked();
});

test("clicking a swatch calls onChange with that token", async () => {
  const onChange = vi.fn();
  render(<ColorPicker value={null} onChange={onChange} />);

  await userEvent.click(screen.getByRole("radio", { name: /red/i }));

  expect(onChange).toHaveBeenCalledWith("cv");
});

test("a non-null value is reflected as the checked swatch instead of the cal default", () => {
  render(<ColorPicker value="jour" onChange={vi.fn()} />);

  expect(screen.getByRole("radio", { name: /mauve/i })).toBeChecked();
  expect(screen.getByRole("radio", { name: /blue/i })).not.toBeChecked();
});
