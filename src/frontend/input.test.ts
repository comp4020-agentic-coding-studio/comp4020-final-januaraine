// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachKeyboardControls, keyToDirection } from "./input";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("keyToDirection", () => {
  it("maps arrow keys and WASD (both cases) to the matching direction", () => {
    expect(keyToDirection("ArrowUp")).toBe("up");
    expect(keyToDirection("w")).toBe("up");
    expect(keyToDirection("W")).toBe("up");
    expect(keyToDirection("ArrowDown")).toBe("down");
    expect(keyToDirection("s")).toBe("down");
    expect(keyToDirection("ArrowLeft")).toBe("left");
    expect(keyToDirection("a")).toBe("left");
    expect(keyToDirection("ArrowRight")).toBe("right");
    expect(keyToDirection("d")).toBe("right");
  });

  it("returns null for an unrelated key", () => {
    expect(keyToDirection("Enter")).toBeNull();
    expect(keyToDirection(" ")).toBeNull();
  });
});

describe("attachKeyboardControls", () => {
  it("fires onDirection once for a fresh keydown", () => {
    const onDirection = vi.fn();
    attachKeyboardControls(onDirection);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));

    expect(onDirection).toHaveBeenCalledTimes(1);
    expect(onDirection).toHaveBeenCalledWith("up");
  });

  it("ignores a key's own OS auto-repeat instead of flooding onDirection", () => {
    const onDirection = vi.fn();
    attachKeyboardControls(onDirection);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    // A held key: the browser marks every repeat after the first with
    // `repeat: true` — none of these are a new turn.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", repeat: true }));

    expect(onDirection).toHaveBeenCalledTimes(1);
  });

  it("still fires again once the key is released and pressed anew", () => {
    const onDirection = vi.fn();
    attachKeyboardControls(onDirection);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));

    expect(onDirection).toHaveBeenCalledTimes(2);
  });

  it("ignores keys that don't map to a direction", () => {
    const onDirection = vi.fn();
    attachKeyboardControls(onDirection);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onDirection).not.toHaveBeenCalled();
  });

  it("stops driving onDirection once the returned cleanup runs", () => {
    const onDirection = vi.fn();
    const detach = attachKeyboardControls(onDirection);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(onDirection).toHaveBeenCalledTimes(1);

    detach();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(onDirection).toHaveBeenCalledTimes(1); // unchanged — no listener left
  });
});
