import type { Direction } from "../game/types";

// Arrow keys and WASD both map to the same four directions — pure, so it's
// testable without touching a real keyboard event.
export function keyToDirection(key: string): Direction | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    default:
      return null;
  }
}

// Attaches the listener and hands back a cleanup function — the loop that
// owns this calls it on teardown so a restarted game doesn't accumulate a
// second listener underneath the first.
export function attachKeyboardControls(onDirection: (direction: Direction) => void): () => void {
  const handler = (event: KeyboardEvent): void => {
    // A held key auto-repeats keydown at the OS rate (commonly tens of
    // events/sec) — none of that is a new turn, so forwarding it would just
    // flood the input endpoint with redundant same-direction requests,
    // crowding out a genuine second turn queued in the same tick window.
    if (event.repeat) return;
    const direction = keyToDirection(event.key);
    if (direction === null) return;
    event.preventDefault();
    onDirection(direction);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
