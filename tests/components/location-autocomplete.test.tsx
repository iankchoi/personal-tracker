// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { mockImportLibrary, MockLoaderCtor } = vi.hoisted(() => {
  const mockImportLibrary = vi.fn();
  function MockLoaderCtor() {
    return { importLibrary: mockImportLibrary };
  }
  return { mockImportLibrary, MockLoaderCtor: vi.fn(MockLoaderCtor) };
});

vi.mock("@googlemaps/js-api-loader", () => ({
  Loader: MockLoaderCtor,
}));

import { LocationAutocomplete } from "../../components/calendar/LocationAutocomplete";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  mockImportLibrary.mockReset();
  MockLoaderCtor.mockClear();
});

test("renders a plain text input immediately, independent of the Places script load", () => {
  render(<LocationAutocomplete value="" onChange={vi.fn()} />);
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});

test("typing updates the value via onChange even before Places has loaded (plain-text fallback)", async () => {
  const onChange = vi.fn();
  render(<LocationAutocomplete value="" onChange={onChange} />);
  await userEvent.type(screen.getByRole("textbox"), "Golden Gate Park");
  expect(onChange).toHaveBeenLastCalledWith("Golden Gate Park");
});

test("the input still works if the Places script fails to load (e.g. loader.importLibrary rejects)", async () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_PLACES_API_KEY", "test-key");
  mockImportLibrary.mockRejectedValueOnce(new Error("network blocked"));

  const onChange = vi.fn();
  render(<LocationAutocomplete value="" onChange={onChange} />);

  // Let the rejected promise settle (caught internally) before asserting
  // nothing broke.
  await waitFor(() => expect(mockImportLibrary).toHaveBeenCalled());
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.getByRole("textbox")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).not.toBeDisabled();

  await userEvent.type(screen.getByRole("textbox"), "123 Main St");
  expect(onChange).toHaveBeenLastCalledWith("123 Main St");
});

/**
 * Mounts `LocationAutocomplete` with the Places library resolving to a
 * single mocked `PlaceAutocompleteElement`, and returns that created DOM
 * element (once it exists) so a test can dispatch a `gmp-select` event on
 * it directly.
 */
async function renderWithMockedPlacesWidget(onChange: (address: string) => void) {
  let createdElement: HTMLElement | undefined;
  function MockPlaceAutocompleteElement() {
    const element = document.createElement("div");
    createdElement = element;
    return element;
  }

  mockImportLibrary.mockResolvedValueOnce({
    PlaceAutocompleteElement: MockPlaceAutocompleteElement,
  });

  render(<LocationAutocomplete value="" onChange={onChange} />);

  await waitFor(() => expect(createdElement).toBeDefined());
  return createdElement!;
}

/**
 * Builds a `gmp-select` event carrying a `placePrediction.toPlace()` whose
 * `fetchFields()` resolves/rejects per `place.fetchFields` — matching
 * Google's current Places (New) contract: the event itself only carries a
 * lightweight prediction, and resolving it to a real `formattedAddress` is
 * a second, separately-awaited `fetchFields()` call.
 */
function gmpSelectEvent(place: { formattedAddress?: string; fetchFields(): Promise<unknown> }) {
  const event = new Event("gmp-select") as Event & {
    placePrediction?: { toPlace(): typeof place };
  };
  event.placePrediction = { toPlace: () => place };
  return event;
}

test("selecting a Places autocomplete suggestion calls onChange with the resolved formatted address", async () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_PLACES_API_KEY", "test-key");

  const onChange = vi.fn();
  const createdElement = await renderWithMockedPlacesWidget(onChange);

  const place = {
    formattedAddress: "1 Infinite Loop, Cupertino, CA",
    fetchFields: vi.fn().mockResolvedValue(undefined),
  };
  createdElement.dispatchEvent(gmpSelectEvent(place));

  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("1 Infinite Loop, Cupertino, CA"));
  expect(place.fetchFields).toHaveBeenCalledWith({ fields: ["formattedAddress"] });
});

test("the input still works if fetchFields() rejects after selecting a suggestion", async () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_PLACES_API_KEY", "test-key");

  const onChange = vi.fn();
  const createdElement = await renderWithMockedPlacesWidget(onChange);

  const place = {
    formattedAddress: "1 Infinite Loop, Cupertino, CA",
    fetchFields: vi.fn().mockRejectedValue(new Error("network blocked")),
  };
  createdElement.dispatchEvent(gmpSelectEvent(place));

  // Let the rejected promise settle (caught internally) before asserting
  // nothing broke.
  await waitFor(() => expect(place.fetchFields).toHaveBeenCalled());
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.getByRole("textbox")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).not.toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();

  await userEvent.type(screen.getByRole("textbox"), "456 Side St");
  expect(onChange).toHaveBeenLastCalledWith("456 Side St");
});
