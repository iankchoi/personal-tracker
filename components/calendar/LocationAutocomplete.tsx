"use client";

import { useEffect, useRef, useState } from "react";

import { Loader } from "@googlemaps/js-api-loader";

/**
 * Minimal, locally-declared shape of the pieces of the Places (New)
 * JavaScript API this component actually touches. Deliberately not using
 * `@types/google.maps` — it isn't installed in this project, and pulling in
 * the full `google.maps.*` ambient namespace just to describe a few fields
 * would be scope creep for what this component needs.
 *
 * Per Google's current Places (New) docs, selecting a suggestion from a
 * `PlaceAutocompleteElement` fires `gmp-select` with an `event.placePrediction`
 * — a lightweight prediction, not a full place. Getting the formatted
 * address is a two-step async operation: `placePrediction.toPlace()` returns
 * a `Place` with no fields populated yet, and `place.fetchFields({ fields:
 * [...] })` must resolve before `place.formattedAddress` is readable.
 */
type PlaceLike = {
  formattedAddress?: string | null;
  fetchFields(options: { fields: string[] }): Promise<unknown>;
};

type PlacePredictionLike = {
  toPlace(): PlaceLike;
};

type PlaceAutocompleteSelectEvent = Event & {
  placePrediction?: PlacePredictionLike;
};

type PlaceAutocompleteElementLike = HTMLElement & {
  addEventListener(type: "gmp-select", listener: (event: PlaceAutocompleteSelectEvent) => void): void;
};

type PlacesLibraryLike = {
  PlaceAutocompleteElement: new () => PlaceAutocompleteElementLike;
};

/** The subset of `Loader`'s instance API used here, typed independently of `@types/google.maps` (see above). */
type LoaderLike = {
  importLibrary(name: "places"): Promise<PlacesLibraryLike>;
};

/**
 * Location field for the event editor. Always renders a plain, controlled
 * `<input>` wired straight to `value`/`onChange` — typing a location works
 * immediately on mount and keeps working no matter what happens to Google's
 * Places script. This is a hard requirement, not a progressive enhancement:
 * a missing/invalid `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`, a blocked network,
 * or any other Places load failure is caught and logged, never thrown, and
 * never disables or removes this input.
 *
 * On mount, this best-effort *upgrades* the field: it loads the Places
 * library via `@googlemaps/js-api-loader` and, if that succeeds, mounts a
 * `google.maps.places.PlaceAutocompleteElement` as an overlay positioned
 * exactly over the plain input (rather than replacing/unmounting it), so
 * the plain input remains in the DOM and functional throughout. Selecting
 * a suggestion from the overlay fires `gmp-select`, which only carries a
 * lightweight prediction — resolving it to a `formattedAddress` is a
 * second async `fetchFields()` call, which can itself fail; that failure
 * is caught the same way a script-load failure is, so it never throws and
 * never disables the plain input. Once it resolves, `onChange` is called
 * with the resolved `formattedAddress`, same as typing directly into the
 * plain input would.
 */
export function LocationAutocomplete(props: { value: string; onChange(address: string): void }) {
  const { value, onChange } = props;

  // The plain input's displayed text is tracked as our own local state,
  // not a direct mirror of `value` on every render. If it mirrored `value`
  // directly, each keystroke's `onChange` would carry only the just-typed
  // character instead of the full accumulated text, because nothing forces
  // the caller to echo every keystroke straight back through `value`
  // before the next one lands (and nothing should require that — this
  // field needs to work exactly the same whether or not the caller does
  // that echoing). `text` is still kept in sync with `value` below for the
  // cases where the caller changes it out from under us (e.g. switching
  // from "create" to editing a different, already-populated event).
  const [text, setText] = useState(value);
  // Tracks the last `value` this component has synced `text` from, so a
  // genuine external change (see above) can be told apart from `text`
  // having since diverged because of the user's own typing. Adjusting
  // state during render like this (rather than in a `useEffect`) is the
  // pattern React's own docs recommend for "resetting state when a prop
  // changes" — see https://react.dev/learn/you-might-not-need-an-effect.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(value);
  }

  const overlayRef = useRef<HTMLDivElement>(null);
  // Refs must not be written during render, only from effects/handlers —
  // this keeps the latest `onChange` reachable from the mount-only effect
  // below without re-running that effect every time `onChange` changes
  // identity (it's an inline closure from `EventEditor`, recreated every
  // render).
  const latestOnChangeRef = useRef(onChange);
  useEffect(() => {
    latestOnChangeRef.current = onChange;
  }, [onChange]);

  function updateText(next: string) {
    setText(next);
    latestOnChangeRef.current(next);
  }

  // Starts `pointerEvents: "none"` on the overlay so an empty overlay div
  // (the common case: no key configured, or Places hasn't resolved yet)
  // never blocks clicks into the plain input underneath it. Flips to
  // `"auto"` only once a real widget has actually been appended into it.
  const [hasWidget, setHasWidget] = useState(false);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      // No Places key configured for this environment — stay on the plain
      // input, silently. This is the expected shape in dev/test without a
      // key set, not an error worth logging.
      return;
    }

    let cancelled = false;
    const loader = new Loader({ apiKey, version: "weekly" }) as unknown as LoaderLike;

    loader
      .importLibrary("places")
      .then((places) => {
        if (cancelled || !overlayRef.current) {
          return;
        }
        const autocompleteElement = new places.PlaceAutocompleteElement();
        autocompleteElement.addEventListener("gmp-select", (event) => {
          const placePrediction = event.placePrediction;
          if (!placePrediction) {
            return;
          }
          const place = placePrediction.toPlace();
          place
            .fetchFields({ fields: ["formattedAddress"] })
            .then(() => {
              if (place.formattedAddress) {
                updateText(place.formattedAddress);
              }
            })
            .catch((error: unknown) => {
              // Resolving the selected suggestion's address failed (network
              // issue, etc.) — log and leave the plain input exactly as it
              // was. Never throw, never disable the field.
              console.error(
                "Google Places fetchFields failed; the location field remains a plain text input.",
                error,
              );
            });
        });
        overlayRef.current.appendChild(autocompleteElement);
        setHasWidget(true);
      })
      .catch((error: unknown) => {
        // Places failed to load (bad/missing key, blocked network, ad
        // blocker, etc.) — log it and leave the plain input exactly as it
        // was. Never throw, never disable the field.
        console.error("Google Places Autocomplete failed to load; the location field remains a plain text input.", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="location-autocomplete" style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        placeholder="Add location"
        aria-label="Location"
        value={text}
        onChange={(event) => updateText(event.target.value)}
      />
      {/* Overlay the Places widget exactly on top of the plain input once (if ever) it successfully loads. */}
      <div
        ref={overlayRef}
        className="location-autocomplete-overlay"
        style={{ position: "absolute", inset: 0, pointerEvents: hasWidget ? "auto" : "none" }}
      />
    </div>
  );
}
