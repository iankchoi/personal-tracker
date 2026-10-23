# Calendar — Event & Task Creation, Part 2: Click-to-Create & Full Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 2 of 3** of the Calendar Event & Task Creation feature. Builds directly on **Part 1** (`2026-10-22-calendar-event-task-creation-1-foundations.md`), which must already be merged/present: the server actions (`lib/actions/calendar-events.ts`, `lib/actions/calendar-tasks.ts`), the Google API clients (`lib/google-calendar.ts`, `lib/google-tasks.ts`), the color mapping (`lib/calendar-event-colors.ts`), and the task-rendering data (`CalendarTaskItem`, `GoogleTaskList`) all already exist and are not rebuilt here. This part ships the actual "click to create, click to edit, click to delete" feature end-to-end for non-recurring events and tasks — the "+ New event" button starts working. **Part 3** (`2026-10-22-calendar-event-task-creation-3-recurrence.md`) adds recurring-event support on top of this.

**Goal:** Let the user click anywhere on the calendar grid (or press a keyboard shortcut, or use the toolbar button) to create an Event or Task, and click an existing one to edit or delete it — with the full field set (location, guests, Meet, color, notify) for Events, and (due date/time, notes, color) for Tasks.

**Architecture:** A new client-side `CalendarInteractionProvider` context holds "which popup is open, with what data" so any grid cell, toolbar button, or keyboard shortcut can open the same quick-create popup or full editor without prop-drilling. A lightweight `QuickCreatePopup` handles the common case (title/when/calendar); its "More options" link expands to the full `EventEditor`/`TaskEditor`, which is where location, guests, Meet, and color live. All three call straight into Part 1's already-tested server actions.

**Tech Stack:** Next.js 16 App Router (client components, React Context), Vitest + Testing Library, `@googlemaps/js-api-loader` for Places Autocomplete (new dependency).

**Spec:** `docs/superpowers/specs/2026-10-22-calendar-event-task-creation-design.md`

## Global Constraints

- Events are written through the real Google Calendar API — an event created here is indistinguishable from one created in Google Calendar's own UI, visible to other devices and invited guests.
- Adding an attendee via an event's `attendees` field triggers a real Gmail invite from Google — no custom email system.
- Location autocomplete needs a new Google Cloud API key (Places, a different product from the OAuth client), restricted by HTTP referrer; usage stays inside Google's free tier for a single personal user.
- Per-event color is the real Google `colorId` field; per-task color is local-only. Per-item color is an **override** on top of the existing per-calendar color assignment, never a replacement.
- The calendar picker must only ever offer calendars the user can write to (`accessRole` of `writer`/`owner`, or absent) — picking a read-only calendar and saving would otherwise fail with an unexplained 403.
- Icons match the sidebar's existing visual language: inline SVG, `viewBox="0 0 24 24"`, rendered 16×16, `stroke-width: 1.6`, `stroke: currentColor`, `fill: none` — no emoji, no icon font/library.
- All-day events carry `start.date`/`end.date`, not `start.dateTime`/`end.dateTime` — any code touching an event's start/end must handle both shapes.

## Review Focus

- **Clicking an all-day event to edit it must not crash.** All-day events carry `start.date`/`end.date`, not `start.dateTime`/`end.dateTime`. Covered in Task 3.
- **A non-organizer event's failed `patch`/`delete`** (Google rejects it because `guestsCanModify: false`) must surface as a visible error in the editor, not an unhandled rejection or a silent no-op. Covered in Task 3.
- **The calendar picker must never offer a read-only calendar** as a create target. Covered in Task 1.
- **Google Places Autocomplete failing to load** (network blocked, bad/missing API key) must still leave a working plain-text location input — Places is a best-effort enhancement, not a hard dependency of the Location field. Covered in Task 5.

---

## File Structure

**New files:**
- `components/calendar/CalendarInteractionProvider.tsx` — client context holding popup/editor open state
- `components/calendar/QuickCreatePopup.tsx` — lightweight create/edit popup
- `components/calendar/EventTaskModal.tsx` — modal shell that renders the popup or the full editor
- `components/calendar/EventEditor.tsx` — full Event editor fields
- `components/calendar/TaskEditor.tsx` — full Task editor fields
- `components/calendar/ColorPicker.tsx` — shared 6-swatch color picker
- `components/calendar/LocationAutocomplete.tsx` — Places Autocomplete input
- `components/calendar/CalendarShortcuts.tsx` — keyboard shortcut listener (D/W/M/A/N)

**Modified files:**
- `lib/google-calendar.ts` — add `filterWritableCalendars`
- `app/(app)/calendar/page.tsx` — wrap in `CalendarInteractionProvider`
- `components/calendar/HourGrid.tsx` — wire slot/event/task clicks
- `components/calendar/MonthView.tsx` — wire day-box/event/task clicks
- `components/calendar/AgendaView.tsx` — wire row clicks
- `components/calendar/CalendarToolbar.tsx` — enable "+ New event", mount `CalendarShortcuts`
- `app/globals.css` — popup/editor/color-swatch styles
- `.env.example` — add `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`
- `package.json` — add `@googlemaps/js-api-loader`

---

### Task 1: CalendarInteractionProvider + QuickCreatePopup

**Files:**
- Modify: `lib/google-calendar.ts`
- Test: `tests/lib/google-calendar.test.ts` (add one case)
- Create: `components/calendar/CalendarInteractionProvider.tsx`
- Create: `components/calendar/QuickCreatePopup.tsx`
- Create: `components/calendar/EventTaskModal.tsx`
- Test: `tests/components/quick-create-popup.test.tsx`

**Interfaces:**
- Consumes: `GoogleCalendarListEntry` (with `accessRole`), `GoogleCalendarEvent`, `createEventAction`/`createTaskAction` (all from Part 1), `GoogleTaskList`/`CalendarTaskItem` (Part 1).
- Produces: `filterWritableCalendars(calendars: GoogleCalendarListEntry[]): GoogleCalendarListEntry[]` (in `lib/google-calendar.ts`, alongside the other calendar helpers), plus:

```ts
export type PopupState =
  | { mode: "closed" }
  | { mode: "create"; kind: "event" | "task"; date: Date; hour?: number }
  | { mode: "edit-event"; event: GoogleCalendarEvent }
  | { mode: "edit-task"; task: CalendarTaskItem };

export function useCalendarInteraction(): {
  popup: PopupState;
  openCreate(kind: "event" | "task", date: Date, hour?: number): void;
  openEditEvent(event: GoogleCalendarEvent): void;
  openEditTask(task: CalendarTaskItem): void;
  close(): void;
};

export function CalendarInteractionProvider(props: {
  calendars: GoogleCalendarListEntry[]; // filtered to writer/owner by this task (Step 6)
  taskLists: GoogleTaskList[];
  children: React.ReactNode;
}): JSX.Element;
```

`QuickCreatePopup` is a controlled, presentational component: `function QuickCreatePopup(props: { calendars: GoogleCalendarListEntry[]; taskLists: GoogleTaskList[]; initial: { kind: "event" | "task"; date: Date; hour?: number }; onMoreOptions(): void; onSaved(): void; onCancel(): void }): JSX.Element`. It owns its own title/when/calendar-or-list form state and, on Save, calls `createEventAction`/`createTaskAction` directly, then `onSaved()`.

- [ ] **Step 1: Write the failing test for `filterWritableCalendars`, then implement it**

```ts
test("filterWritableCalendars keeps owner and writer calendars, drops reader and freeBusyReader, and keeps an entry with no accessRole at all", () => {
  const calendars = [
    { id: "a", summary: "Primary", backgroundColor: "#000", accessRole: "owner" as const },
    { id: "b", summary: "Shared", backgroundColor: "#000", accessRole: "writer" as const },
    { id: "c", summary: "Holidays", backgroundColor: "#000", accessRole: "reader" as const },
    { id: "d", summary: "Someone's free/busy", backgroundColor: "#000", accessRole: "freeBusyReader" as const },
    { id: "e", summary: "Legacy entry", backgroundColor: "#000" },
  ];
  expect(filterWritableCalendars(calendars).map((c) => c.id)).toEqual(["a", "b", "e"]);
});
```

Run: `npx vitest run tests/lib/google-calendar.test.ts` (fails, then add `filterWritableCalendars` to `lib/google-calendar.ts` — `calendars.filter((c) => !c.accessRole || c.accessRole === "owner" || c.accessRole === "writer")` — and re-run to confirm it passes).

- [ ] **Step 2: Write the failing tests for `QuickCreatePopup`**

```tsx
test("defaults to Event selected, with the clicked date/hour prefilled", () => {
  render(<QuickCreatePopup calendars={cals} taskLists={lists} initial={{ kind: "event", date: new Date(2026, 9, 22), hour: 9 }} onMoreOptions={vi.fn()} onSaved={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Event" })).toHaveAttribute("aria-pressed", "true");
});

test("switching to Task hides the calendar picker and shows the task-list picker", async () => {
  // click "Task" toggle -> getByLabelText(/task list/i) present, queryByLabelText(/calendar/i) absent
});

test("Save on the Event side calls createEventAction with the title, 1-hour default end, and chosen calendar", async () => {
  vi.mock("@/lib/actions/calendar-events", () => ({ createEventAction: vi.fn().mockResolvedValue({ id: "e1" }) }));
  render(/* kind: "event", date, hour: 9 */);
  await userEvent.type(screen.getByLabelText(/title/i), "Standup");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(createEventAction).toHaveBeenCalledWith(expect.objectContaining({ title: "Standup", allDay: false }));
});

test("Save on the Task side with Month/Agenda-style initial (no hour) defaults to no time set", async () => {
  // initial: { kind: "task", date } (no hour) -> createTaskAction called with dueTime: null
});

test("More options calls onMoreOptions instead of saving", async () => { /* click the link, assert onMoreOptions called, createEventAction not called */ });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/components/quick-create-popup.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement `QuickCreatePopup`**

Fields per the design doc's "The popup (quick create)" section: title input, Event/Task segmented toggle (Event default), a when-section (Event: start input seeded from `initial.hour != null ? that hour : 9:00 AM`, end = start + 1 hour, both editable; Task: a single optional-time "Due" field, seeded with a time only when `initial.hour != null`), a calendar picker (`<select>` of `props.calendars`, defaulting to the primary one) or task-list picker (`<select>` of `props.taskLists`), a "More options" link calling `onMoreOptions`, Cancel (`onCancel`) and Save buttons. Save builds the appropriate `EventActionInput`/`TaskActionInput` and calls the corresponding action, then `onSaved()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/quick-create-popup.test.tsx`
Expected: PASS

- [ ] **Step 6: Implement `CalendarInteractionProvider`**

`"use client"`. Calls `filterWritableCalendars(props.calendars)` (Step 1) once and stores the result, satisfying the "calendar/list picker scope" design requirement and this plan's Review Focus item on it. Holds `popup: PopupState` in `useState`, exposes the context value from the `Interfaces` block above, and renders `{children}` followed by `<EventTaskModal popup={popup} calendars={writableCalendars} taskLists={taskLists} onClose={close} />` (Tasks 3/4 make the modal's edit-mode bodies real; for this task, `EventTaskModal` only needs to render `QuickCreatePopup` for `mode: "create"` and nothing yet for the two edit modes — a bare `null` is fine).

- [ ] **Step 7: Wrap the Calendar page**

In `app/(app)/calendar/page.tsx`, wrap the returned JSX (the `<div className="cal-col">...</div>`) in `<CalendarInteractionProvider calendars={calendars} taskLists={taskLists}>...</CalendarInteractionProvider>`.

- [ ] **Step 8: Commit**

```bash
git add lib/google-calendar.ts tests/lib/google-calendar.test.ts components/calendar/CalendarInteractionProvider.tsx components/calendar/QuickCreatePopup.tsx components/calendar/EventTaskModal.tsx tests/components/quick-create-popup.test.tsx
git commit -m "feat: add calendar interaction context and the quick-create popup"
```

---

### Task 2: Click-to-create wiring + keyboard shortcuts

**Files:**
- Modify: `components/calendar/HourGrid.tsx`
- Modify: `components/calendar/MonthView.tsx`
- Modify: `components/calendar/AgendaView.tsx`
- Modify: `components/calendar/CalendarToolbar.tsx`
- Create: `components/calendar/CalendarShortcuts.tsx`
- Test: `tests/components/calendar-shortcuts.test.tsx`

**Interfaces:**
- Consumes: `useCalendarInteraction` (Task 1).
- Produces: `function CalendarShortcuts(): null` — a client component with no visible output, mounted once, that attaches a `keydown` listener for `D`/`W`/`M`/`A`/`N`.

- [ ] **Step 1: Write the failing tests for `CalendarShortcuts`**

```tsx
test("pressing N opens the create popup via the interaction context", async () => {
  const openCreate = vi.fn();
  // render CalendarShortcuts inside a test provider/mock of useCalendarInteraction returning { openCreate, ... }
  await userEvent.keyboard("n");
  expect(openCreate).toHaveBeenCalledWith("event", expect.any(Date));
});

test("pressing D/W/M/A navigates via router.push to the matching view, preserving the current date", async () => {
  // mock useRouter + a current view/date context (see Step 3); assert router.push called with "/calendar?view=day&date=..."
});

test("a shortcut key typed while focus is inside a text input is ignored", async () => {
  render(<input />); // plus CalendarShortcuts mounted
  screen.getByRole("textbox").focus();
  await userEvent.keyboard("n");
  expect(openCreate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/calendar-shortcuts.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `CalendarShortcuts`**

`"use client"`. Takes `view: ViewType; date: Date; go(view: ViewType, date: Date): void` as props — mount it inside `CalendarToolbar`'s own render (it already has all three) rather than as a sibling, so it can share them without new prop plumbing. On `keydown`, ignore the event entirely if `document.activeElement` is an `input`/`textarea`/`select` or has `contenteditable`. Otherwise, lowercase the key: `d`/`w`/`m`/`a` call `go(viewForKey, date)`; `n` calls `openCreate("event", new Date())` from `useCalendarInteraction()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/calendar-shortcuts.test.tsx`
Expected: PASS

- [ ] **Step 5: Mount `CalendarShortcuts` and enable "+ New event"**

In `CalendarToolbar.tsx`, render `<CalendarShortcuts view={view} date={date} go={go} />` and change the disabled `<button className="cal-new" disabled>` (line 79) to `<button className="cal-new" type="button" onClick={() => openCreate("event", date)}>`, pulling `openCreate` from `useCalendarInteraction()`.

- [ ] **Step 6: Wire grid clicks**

- `HourGrid`: each `.wg-line` hour cell (the empty slot divs rendered per hour, `HourGrid.tsx:103-105`) gets an `onClick` calling `openCreate("event", day, hour)` — the popup itself offers the Event/Task toggle to switch, so a bare slot click always defaults to Event, matching "+ New event"'s default. Also add an `onClick` to each already-rendered event block (`.wg-event`, line 110) and all-day chip (`.wg-chip`, line 80) calling `openEditEvent(event)`, and to each `TaskCheckbox`'s title text (not the checkbox input itself, which must stay a pure complete-toggle) calling `openEditTask(task)`.
- `MonthView`: each `.mg-cell` (line 90) gets an `onClick` on the cell background (not on its chips) calling `openCreate("event", day)`; each chip/task gets the same edit-open wiring as above.
- `AgendaView`: agenda rows already represent existing events/tasks only (no empty "day box" to click per the design doc — Agenda has no create-affordance of its own beyond the toolbar/shortcut); wire each `.rowcard`/task row's click to the corresponding `openEditEvent`/`openEditTask`.
- Since `HourGrid`/`MonthView`/`AgendaView` are currently plain (non-"use client") functions called from server components, and `onClick` requires a Client Component boundary: add `"use client"` to the top of each of these three files (they already consume no server-only APIs — `getViewRange` etc. are plain functions) and confirm `npm run build` still succeeds afterward.

- [ ] **Step 7: Manually verify in the browser**

Click an empty Day-view slot → popup opens prefilled to that time. Click an existing event → an empty modal for now (Task 3 fills the edit body) but no crash. Press `N` → popup opens. Press `D`/`W`/`M`/`A` → view switches.

- [ ] **Step 8: Commit**

```bash
git add components/calendar tests/components/calendar-shortcuts.test.tsx
git commit -m "feat: wire grid clicks, the New event button, and D/W/M/A/N keyboard shortcuts to the create/edit popup"
```

---

### Task 3: Full Event editor (non-recurring save/delete)

**Files:**
- Create: `components/calendar/EventEditor.tsx`
- Create: `components/calendar/ColorPicker.tsx`
- Modify: `components/calendar/EventTaskModal.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/event-editor.test.tsx`
- Test: `tests/components/color-picker.test.tsx`

**Interfaces:**
- Consumes: `updateEventAction`/`deleteEventAction`/`createEventAction` (Part 1), `useCalendarInteraction` (Task 1).
- Produces: `function ColorPicker(props: { value: CalendarColorToken | null; onChange(token: CalendarColorToken | null): void }): JSX.Element` (6 swatches, `cal` shown as the default/selected-by-default swatch); `function EventEditor(props: { mode: "create" | "edit"; initial: Partial<EventActionInput> & { eventId?: string; calendarId: string }; calendars: GoogleCalendarListEntry[]; onSaved(): void; onDeleted(): void; onCancel(): void }): JSX.Element`.

- [ ] **Step 1: Write the failing `ColorPicker` tests**

```tsx
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
```

- [ ] **Step 2: Run, verify fail, implement `ColorPicker`, run, verify pass**

Run: `npx vitest run tests/components/color-picker.test.tsx` (fail, then pass after implementing a `role="radiogroup"` of 6 `role="radio"` swatches keyed to `CalendarColorToken`, each labeled with a human name — Blue/`cal`, Teal/`wk`, Amber/`rem`, Green/`note`, Mauve/`jour`, Red/`cv` — matching the hex values from Part 1's color-mapping table).

- [ ] **Step 3: Write the failing `EventEditor` tests**

```tsx
test("All-day toggle swaps the time pickers for a single date field", async () => {
  render(<EventEditor mode="create" initial={{ calendarId: "primary" }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /all.?day/i }));
  expect(screen.queryByLabelText(/start time/i)).not.toBeInTheDocument();
});

test("editing an existing all-day event reads its start.date, not start.dateTime, without crashing", () => {
  render(<EventEditor mode="edit" initial={{ eventId: "e1", calendarId: "primary", title: "Birthday", start: "2026-10-25", end: "2026-10-26", allDay: true }} calendars={cals} onSaved={vi.fn()} onDeleted={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: /all.?day/i })).toBeChecked();
});

test("Save on create calls createEventAction with the entered title, location, description, guests, and color", async () => { /* fill fields, click Save, assert createEventAction call shape */ });

test("Save on edit calls updateEventAction with the eventId", async () => { /* mode: "edit" -> updateEventAction called with eventId from initial */ });

test("Delete calls deleteEventAction with the eventId and then onDeleted", async () => { /* ... */ });

test("adding a guest email appends it to the guest chip list, and Save includes it in guestEmails", async () => { /* type an email, press Enter/click Add, assert chip renders, then Save -> guestEmails includes it */ });

test("a failed Save (e.g. non-organizer event rejected by Google) surfaces the error inline instead of throwing", async () => {
  vi.mock("@/lib/actions/calendar-events", () => ({ updateEventAction: vi.fn().mockRejectedValue(new Error("403")) }));
  // click Save, assert an error message renders, modal stays open (onSaved not called)
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: FAIL

- [ ] **Step 5: Implement `EventEditor`**

Fields per the design doc's "The full editor" section for Events: title, When (start/end, or a single date range when All-day is checked), calendar picker, All-day toggle, Repeat field (render only a disabled "Does not repeat" placeholder for now — Part 3 makes it live), Notify field (`<input type="number">` minutes, defaulting to 30), Location (plain `<input>` for now — Task 5 adds autocomplete), "Add Google Meet video conferencing" toggle button, Description textarea, Guests (chip list + add-by-email input, Enter/Add appends to a local array), the three guest-permission checkboxes, `ColorPicker`. Icons per the Global Constraints (inline SVG, sidebar style) next to each labeled row. Save builds an `EventActionInput` and calls `createEventAction` (mode `"create"`) or `updateEventAction` (mode `"edit"`, including `eventId`); on success calls `onSaved()`; on a rejected promise, catches it and renders the error message in place instead of calling `onSaved()`. Delete calls `deleteEventAction({ calendarId, eventId })` then `onDeleted()`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/event-editor.test.tsx`
Expected: PASS

- [ ] **Step 7: Wire into `EventTaskModal`**

`EventTaskModal`'s `mode: "create", kind: "event"` and `mode: "edit-event"` branches now render `<EventEditor>` when the popup's "More options" was clicked (track a local `expanded` boolean in the modal, toggled by `QuickCreatePopup`'s `onMoreOptions`) — `mode: "edit-event"` always renders the full `EventEditor` directly (no quick-popup step for editing, per the design doc: "Clicking an existing event or task opens the identical popup/editor").

- [ ] **Step 8: Manually verify in the browser**

Create an event with a location, description, a guest, and a non-default color; confirm it appears correctly in Google Calendar's own web UI (color, guest invite received, description/location present).

- [ ] **Step 9: Commit**

```bash
git add components/calendar/EventEditor.tsx components/calendar/ColorPicker.tsx components/calendar/EventTaskModal.tsx app/globals.css tests/components/event-editor.test.tsx tests/components/color-picker.test.tsx
git commit -m "feat: add the full Event editor with guests, Meet, location, and color"
```

---

### Task 4: Full Task editor (save/delete)

**Files:**
- Create: `components/calendar/TaskEditor.tsx`
- Modify: `components/calendar/EventTaskModal.tsx`
- Test: `tests/components/task-editor.test.tsx`

**Interfaces:**
- Consumes: `createTaskAction`/`updateTaskAction`/`deleteTaskAction` (Part 1), `ColorPicker` (Task 3).
- Produces: `function TaskEditor(props: { mode: "create" | "edit"; initial: Partial<TaskActionInput> & { taskId?: string; taskListId: string }; taskLists: GoogleTaskList[]; onSaved(): void; onDeleted(): void; onCancel(): void }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

```tsx
test("the due time field is optional — Save with a date but no time sends dueTime: null", async () => {
  // fill title + date, leave time blank, click Save, assert createTaskAction called with dueTime: null
});

test("Save on edit calls updateTaskAction with the taskId", async () => { /* ... */ });

test("Delete calls deleteTaskAction and then onDeleted", async () => { /* ... */ });

test("color defaults to the shared ColorPicker's default (cal/blue) when not overridden", async () => { /* ... */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/task-editor.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `TaskEditor`**

Fields: title, Due date (`<input type="date">`), Due time (`<input type="time">`, optional), task-list picker, Description/notes textarea, `ColorPicker`. No location/guests/Meet/Repeat (Tasks never get those, per the design doc). Save/Delete mirror `EventEditor`'s pattern against the task actions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/task-editor.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire into `EventTaskModal`**

Analogous to Task 3 Step 7, for `kind: "task"`/`mode: "edit-task"`.

- [ ] **Step 6: Commit**

```bash
git add components/calendar/TaskEditor.tsx components/calendar/EventTaskModal.tsx tests/components/task-editor.test.tsx
git commit -m "feat: add the full Task editor"
```

---

### Task 5: Google Places Autocomplete for Location

**Files:**
- Create: `components/calendar/LocationAutocomplete.tsx`
- Modify: `components/calendar/EventEditor.tsx`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `tests/components/location-autocomplete.test.tsx`

**Interfaces:**
- Produces: `function LocationAutocomplete(props: { value: string; onChange(address: string): void }): JSX.Element`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @googlemaps/js-api-loader`

- [ ] **Step 2: Add the new env var**

In `.env.example`, add beneath the existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` lines:

```
# A separate Google Cloud API key (Places API, New), restricted by HTTP
# referrer to this app's origin — NOT the OAuth client above.
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=
```

- [ ] **Step 3: Write the failing tests**

```tsx
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
  // mock the @googlemaps/js-api-loader Loader so importLibrary rejects; assert the plain input is still present
  // and typing still calls onChange — the Places failure must not throw or disable the field
});

test("selecting a Places autocomplete suggestion calls onChange with the resolved formatted address", async () => {
  // mock the @googlemaps/js-api-loader Loader + google.maps.places.PlaceAutocompleteElement's
  // 'gmp-placeselect' event to fire with a fixed formattedAddress, assert onChange receives it
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/components/location-autocomplete.test.tsx`
Expected: FAIL

- [ ] **Step 5: Implement `LocationAutocomplete`**

`"use client"`. Renders a controlled `<input>` bound to `value`/`onChange` immediately (so typing always works, satisfying "Non-goals: only resolved address text is needed" even if the script fails to load). In a `useEffect` (once, on mount), load the Places library via `new Loader({ apiKey: process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY!, version: "weekly" }).importLibrary("places")`, wrapped in a `try`/`catch` (or `.catch()`) that swallows a load failure — logging it, not throwing, so the plain input keeps working per this plan's Review Focus item on it. On success, construct a `google.maps.places.PlaceAutocompleteElement` bound to the input's position (or replacing it — follow the library's documented mount pattern), and listen for its place-selection event to call `onChange(place.formattedAddress)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/location-autocomplete.test.tsx`
Expected: PASS

- [ ] **Step 7: Wire into `EventEditor`**

Replace the plain `<input>` for Location (added in Task 3) with `<LocationAutocomplete value={location} onChange={setLocation} />`.

- [ ] **Step 8: Manually verify in the browser**

With a real `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` set locally, type a partial address and confirm suggestions appear and selecting one fills the field.

- [ ] **Step 9: Commit**

```bash
git add components/calendar/LocationAutocomplete.tsx components/calendar/EventEditor.tsx .env.example package.json package-lock.json tests/components/location-autocomplete.test.tsx
git commit -m "feat: add Google Places autocomplete to the event location field"
```

---

## After Task 5

Run the full suite (`npm run test`) and `npm run build` once more, then follow superpowers:finishing-a-development-branch for this part before starting Part 3 — Part 3 builds directly on `EventEditor`'s Repeat-field placeholder and `lib/actions/calendar-events.ts`'s `scope` parameter (both introduced here but inert until Part 3), so it should branch from wherever this part lands.
