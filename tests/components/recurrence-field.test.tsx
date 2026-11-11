// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { RecurrenceField } from "../../components/calendar/RecurrenceField";

afterEach(() => {
  cleanup();
});

test("defaults to 'Does not repeat' when value is null", () => {
  render(<RecurrenceField value={null} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Repeat")).toHaveValue("none");
});

test("picking 'Daily' calls onChange with a daily, never-ending rule", async () => {
  const onChange = vi.fn();
  render(<RecurrenceField value={null} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "daily");
  expect(onChange).toHaveBeenCalledWith({ freq: "DAILY", interval: 1, end: { type: "never" } });
});

test("picking 'Custom...' reveals interval, unit, and end-condition controls", async () => {
  render(<RecurrenceField value={null} onChange={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "custom");
  expect(screen.getByLabelText(/every/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/ends/i)).toBeInTheDocument();
});

test("the custom builder's interval+unit produces the matching RecurrenceRule", async () => {
  const onChange = vi.fn();
  render(<RecurrenceField value={null} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Repeat"), "custom");
  await userEvent.clear(screen.getByLabelText(/every/i));
  await userEvent.type(screen.getByLabelText(/every/i), "2");
  await userEvent.selectOptions(screen.getByLabelText(/unit/i), "weeks");
  expect(onChange).toHaveBeenLastCalledWith({ freq: "WEEKLY", interval: 2, end: { type: "never" } });
});

test("a non-null value populates the field as 'Custom...' with its own interval/unit/end pre-filled", () => {
  render(<RecurrenceField value={{ freq: "WEEKLY", interval: 2, end: { type: "never" } }} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Repeat")).toHaveValue("custom");
  expect(screen.getByLabelText(/every/i)).toHaveValue(2);
});
