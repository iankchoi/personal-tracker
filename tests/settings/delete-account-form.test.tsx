// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { DeleteAccountForm } from "../../components/settings/DeleteAccountForm";

afterEach(() => {
  cleanup();
});

test("Delete account stays disabled until the typed email exactly matches", () => {
  render(<DeleteAccountForm email="iankangchoi@gmail.com" />);
  const button = screen.getByRole("button", { name: /delete account/i });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/type your email to confirm/i), { target: { value: "iankangchoi@gmail.com" } });
  expect(button).toBeEnabled();
});
