// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { usePointerDrag } from "../../components/calendar/usePointerDrag";

function Harness({
  onClick,
  onMove,
  onDrop,
}: {
  onClick(): void;
  onMove(clientX: number, clientY: number): void;
  onDrop(clientX: number, clientY: number): void;
}) {
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = usePointerDrag({
    onClick,
    onMove,
    onDrop,
  });
  return (
    <div
      data-testid="target"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

afterEach(() => {
  cleanup();
});

test("a pointerdown+pointerup with no movement calls onClick, not onDrop", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onDrop).not.toHaveBeenCalled();
});

test("movement past the threshold calls onMove during the drag and onDrop (not onClick) on release", () => {
  const onClick = vi.fn();
  const onMove = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={onMove} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 112, pointerId: 1 }); // 12px, past the 4px default
  fireEvent.pointerUp(el, { clientX: 100, clientY: 112, pointerId: 1 });
  expect(onMove).toHaveBeenCalledWith(100, 112);
  expect(onDrop).toHaveBeenCalledWith(100, 112);
  expect(onClick).not.toHaveBeenCalled();
});

test("movement under the threshold does not count as a drag", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 101, clientY: 101, pointerId: 1 }); // ~1.4px
  fireEvent.pointerUp(el, { clientX: 101, clientY: 101, pointerId: 1 });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onDrop).not.toHaveBeenCalled();
});

test("pointercancel aborts without calling onDrop or onClick", () => {
  const onClick = vi.fn();
  const onDrop = vi.fn();
  render(<Harness onClick={onClick} onMove={vi.fn()} onDrop={onDrop} />);
  const el = screen.getByTestId("target");
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 112, pointerId: 1 });
  fireEvent(el, new Event("pointercancel", { bubbles: true, cancelable: true }));
  fireEvent.pointerUp(el, { clientX: 100, clientY: 112, pointerId: 1 }); // stray late pointerup after cancel
  expect(onClick).not.toHaveBeenCalled();
  expect(onDrop).not.toHaveBeenCalled();
});
