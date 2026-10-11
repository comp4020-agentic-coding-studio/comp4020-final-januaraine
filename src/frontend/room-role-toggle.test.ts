import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../game/config";
import { computeRoleToggleState } from "./room-role-toggle";

describe("computeRoleToggleState", () => {
  it("shows 'Become Viewer', enabled, when the caller is a Player", () => {
    const state = computeRoleToggleState({ locked: false, yourRole: "player", playerCount: 3 });
    expect(state).toMatchObject({ hidden: false, targetRole: "viewer", label: "Become Viewer", disabled: false });
  });

  it("shows 'Become Player', enabled, when the caller is a Viewer and a slot is free", () => {
    const state = computeRoleToggleState({ locked: false, yourRole: "viewer", playerCount: MAX_PLAYERS - 1 });
    expect(state).toMatchObject({ hidden: false, targetRole: "player", label: "Become Player", disabled: false });
  });

  it("disables 'Become Player' with a reason once the room is at the five-Player cap", () => {
    const state = computeRoleToggleState({ locked: false, yourRole: "viewer", playerCount: MAX_PLAYERS });
    expect(state.disabled).toBe(true);
    expect(state.reason).toContain(`${MAX_PLAYERS}/${MAX_PLAYERS}`);
  });

  it("never disables 'Become Viewer' for a full room — a Player stepping down always has somewhere to go", () => {
    const state = computeRoleToggleState({ locked: false, yourRole: "player", playerCount: MAX_PLAYERS });
    expect(state.disabled).toBe(false);
  });

  it("hides the toggle entirely in a locked room, regardless of role", () => {
    expect(computeRoleToggleState({ locked: true, yourRole: "player", playerCount: 1 }).hidden).toBe(true);
    expect(computeRoleToggleState({ locked: true, yourRole: "viewer", playerCount: 1 }).hidden).toBe(true);
  });
});
