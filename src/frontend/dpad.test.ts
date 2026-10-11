// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Direction } from "../game/types";
import { attachDpad } from "./dpad";

// A minimal stand-in for the markup play.astro/arena.astro actually render —
// attachDpad only cares about `[data-direction]` buttons under the root it's
// given, not which page they came from.
function renderDpad(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="dpad" role="group" aria-label="Movement controls">
      <div class="dpad-row">
        <button type="button" class="dpad-button" data-direction="up" aria-label="Move up">&uarr;</button>
      </div>
      <div class="dpad-row">
        <button type="button" class="dpad-button" data-direction="left" aria-label="Move left">&larr;</button>
        <button type="button" class="dpad-button" data-direction="down" aria-label="Move down">&darr;</button>
        <button type="button" class="dpad-button" data-direction="right" aria-label="Move right">&rarr;</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function button(root: HTMLElement, direction: Direction): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`[data-direction="${direction}"]`)!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachDpad", () => {
  it("fires onDirection with the matching direction for each of the four buttons", () => {
    const root = renderDpad();
    const onDirection = vi.fn();
    attachDpad(root, onDirection);

    for (const direction of ["up", "down", "left", "right"] as const) {
      button(root, direction).click();
    }

    expect(onDirection.mock.calls.map((call) => call[0])).toEqual(["up", "down", "left", "right"]);
  });

  it("fires exactly once per click — a tap's pointer events never double-fire the direction", () => {
    const root = renderDpad();
    const onDirection = vi.fn();
    attachDpad(root, onDirection);

    const up = button(root, "up");
    up.dispatchEvent(new PointerEvent("pointerdown"));
    up.click();
    up.dispatchEvent(new PointerEvent("pointerup"));

    expect(onDirection).toHaveBeenCalledTimes(1);
    expect(onDirection).toHaveBeenCalledWith("up");
  });

  it("toggles a visible .pressed state on pointerdown/pointerup", () => {
    const root = renderDpad();
    attachDpad(root, () => {});
    const left = button(root, "left");

    expect(left.classList.contains("pressed")).toBe(false);
    left.dispatchEvent(new PointerEvent("pointerdown"));
    expect(left.classList.contains("pressed")).toBe(true);
    left.dispatchEvent(new PointerEvent("pointerup"));
    expect(left.classList.contains("pressed")).toBe(false);
  });

  it("also clears .pressed on pointercancel and pointerleave (a drag-off or interrupted touch)", () => {
    const root = renderDpad();
    attachDpad(root, () => {});
    const down = button(root, "down");

    down.dispatchEvent(new PointerEvent("pointerdown"));
    expect(down.classList.contains("pressed")).toBe(true);
    down.dispatchEvent(new PointerEvent("pointercancel"));
    expect(down.classList.contains("pressed")).toBe(false);

    down.dispatchEvent(new PointerEvent("pointerdown"));
    down.dispatchEvent(new PointerEvent("pointerleave"));
    expect(down.classList.contains("pressed")).toBe(false);
  });

  it("stops driving onDirection once the returned cleanup runs", () => {
    const root = renderDpad();
    const onDirection = vi.fn();
    const detach = attachDpad(root, onDirection);

    button(root, "right").click();
    expect(onDirection).toHaveBeenCalledTimes(1);

    detach();
    button(root, "right").click();
    expect(onDirection).toHaveBeenCalledTimes(1); // unchanged — no listener left
  });
});
