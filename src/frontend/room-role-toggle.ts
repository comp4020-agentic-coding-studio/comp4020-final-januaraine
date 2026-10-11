import { MAX_PLAYERS } from "../game/config";
import type { MemberRole } from "../lib/room-server";

// Pure state computation for the single role-toggle button on room/[id].astro
// (see docs section 3/4 of the brief this was built against): one button
// whose label names the role a click would request, never two buttons shown
// or hidden in sync with each other. Kept separate from the DOM-wiring
// script so it can be unit-tested the same way src/game/ logic is — no
// window, no fetch, just "given this frame, what should the button look
// like."
export interface RoleToggleState {
  // Locked rooms are solo by design (see ADR-002's lock setting) — role
  // switching isn't offered there at all, for anyone, creator included.
  // Hiding this button is a UI convenience only: src/lib/room-server.ts's
  // becomePlayer/joinRoom enforce the actual `locked && !isCreator`
  // restriction independently, so this never needs to distinguish "why" for
  // a locked room, only "whether".
  readonly hidden: boolean;
  readonly targetRole: MemberRole;
  readonly label: "Become Player" | "Become Viewer";
  readonly disabled: boolean;
  readonly reason: string;
}

export interface RoleToggleInput {
  readonly locked: boolean;
  readonly yourRole: MemberRole;
  readonly playerCount: number;
}

const HIDDEN_STATE: RoleToggleState = {
  hidden: true,
  targetRole: "viewer",
  label: "Become Viewer",
  disabled: true,
  reason: "",
};

export function computeRoleToggleState(input: RoleToggleInput): RoleToggleState {
  if (input.locked) return HIDDEN_STATE;

  if (input.yourRole === "player") {
    return { hidden: false, targetRole: "viewer", label: "Become Viewer", disabled: false, reason: "" };
  }

  const full = input.playerCount >= MAX_PLAYERS;
  return {
    hidden: false,
    targetRole: "player",
    label: "Become Player",
    disabled: full,
    reason: full ? `Room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).` : "",
  };
}
