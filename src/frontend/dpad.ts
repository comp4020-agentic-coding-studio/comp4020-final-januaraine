import type { Direction } from "../game/types";

// Wires the four D-pad buttons already in the page's markup (see
// play.astro/arena.astro) to the same onDirection callback keyboard input
// already drives — one movement path for keyboard, touch, and mouse alike,
// never a second client-side movement system. A plain `click` fires once
// for a mouse click AND once for a tap (the browser synthesizes it after
// touchstart/touchend; `touch-action: manipulation` in the CSS removes the
// legacy ~300ms delay before it, so it already feels instant) — pointer
// events here only toggle the visible pressed state, so a tap can never
// fire a direction twice.
export function attachDpad(root: ParentNode, onDirection: (direction: Direction) => void): () => void {
  const buttons = root.querySelectorAll<HTMLButtonElement>("[data-direction]");
  const cleanups: Array<() => void> = [];

  buttons.forEach((button) => {
    const direction = button.dataset.direction as Direction;
    const press = (): void => button.classList.add("pressed");
    const release = (): void => button.classList.remove("pressed");
    const onClick = (): void => onDirection(direction);

    button.addEventListener("click", onClick);
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);

    cleanups.push(() => {
      button.removeEventListener("click", onClick);
      button.removeEventListener("pointerdown", press);
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointercancel", release);
      button.removeEventListener("pointerleave", release);
    });
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}
