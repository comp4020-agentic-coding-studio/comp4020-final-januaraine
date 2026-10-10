import { describe, expect, it } from "vitest";
import { POINTS_PER_FOOD } from "./config";
import {
  type ArenaSnake,
  type ArenaState,
  createArena,
  joinArena,
  leaveArena,
  serializeArena,
  setArenaDirection,
  tickArena,
} from "./arena";

// Same convention as rules.test.ts/food.test.ts: a fixed random source keeps
// every test's food/spawn placement predictable, and randomEmptyCell scans
// row-major (y outer, x inner).
const fixedRandom = () => 0;

function snake(overrides: Partial<ArenaSnake> & Pick<ArenaSnake, "playerId" | "segments">): ArenaSnake {
  return {
    displayName: `Player ${overrides.playerId}`,
    direction: "right",
    pendingDirection: "right",
    score: 0,
    ticks: 0,
    ...overrides,
  };
}

function arena(snakes: ArenaSnake[], food = { x: 0, y: 0 }, gridSize = 10): ArenaState {
  return { snakes: Object.fromEntries(snakes.map((s) => [s.playerId, s])), food, gridSize };
}

describe("createArena", () => {
  it("starts empty with food placed on the board", () => {
    const state = createArena(10, fixedRandom);
    expect(state.snakes).toEqual({});
    expect(state.food).toEqual({ x: 0, y: 0 }); // fixedRandom -> first free cell in scan order
    expect(state.gridSize).toBe(10);
  });
});

describe("joinArena", () => {
  it("adds a new player as a length-1 snake", () => {
    const state = joinArena(createArena(10, fixedRandom), 1, "Player A1B2", fixedRandom);
    expect(state.snakes[1]).toBeDefined();
    expect(state.snakes[1].segments).toHaveLength(1);
    expect(state.snakes[1].displayName).toBe("Player A1B2");
    expect(state.snakes[1].score).toBe(0);
  });

  it("gives two distinct players two distinct spawn cells", () => {
    let state = createArena(10, fixedRandom);
    state = joinArena(state, 1, "Player One", fixedRandom);
    state = joinArena(state, 2, "Player Two", fixedRandom);
    expect(state.snakes[1].segments[0]).not.toEqual(state.snakes[2].segments[0]);
  });

  it("is a no-op for a player who already has a live snake", () => {
    const joined = joinArena(createArena(10, fixedRandom), 1, "Player One", fixedRandom);
    const again = joinArena(joined, 1, "Player One (ignored)", fixedRandom);
    expect(again).toBe(joined);
  });
});

describe("leaveArena", () => {
  it("removes exactly the named player, leaving others untouched", () => {
    let state = createArena(10, fixedRandom);
    state = joinArena(state, 1, "Player One", fixedRandom);
    state = joinArena(state, 2, "Player Two", fixedRandom);

    const after = leaveArena(state, 1);
    expect(after.snakes[1]).toBeUndefined();
    expect(after.snakes[2]).toEqual(state.snakes[2]);
  });

  it("is a no-op for a player not currently in the arena", () => {
    const state = createArena(10, fixedRandom);
    expect(leaveArena(state, 999)).toBe(state);
  });
});

describe("setArenaDirection", () => {
  it("queues a direction for one player without touching another's", () => {
    let state = createArena(10, fixedRandom);
    state = joinArena(state, 1, "Player One", fixedRandom);
    state = joinArena(state, 2, "Player Two", fixedRandom);

    const next = setArenaDirection(state, 1, "up");
    expect(next.snakes[1].pendingDirection).toBe("up");
    expect(next.snakes[1].direction).toBe("right"); // not moved yet, only queued
    expect(next.snakes[2].pendingDirection).toBe("right"); // unaffected
  });

  it("is a no-op for an unknown player", () => {
    const state = createArena(10, fixedRandom);
    expect(setArenaDirection(state, 999, "up")).toBe(state);
  });
});

describe("tickArena", () => {
  it("is a no-op on an empty arena", () => {
    const state = createArena(10, fixedRandom);
    const result = tickArena(state, fixedRandom);
    expect(result.state).toBe(state);
    expect(result.eliminated).toEqual([]);
  });

  it("moves every snake independently, one cell per tick", () => {
    const state = arena([
      snake({ playerId: 1, segments: [{ x: 5, y: 5 }], direction: "right", pendingDirection: "right" }),
      snake({ playerId: 2, segments: [{ x: 2, y: 2 }], direction: "up", pendingDirection: "up" }),
    ]);

    const { state: next, eliminated } = tickArena(state, fixedRandom);
    expect(eliminated).toEqual([]);
    expect(next.snakes[1].segments[0]).toEqual({ x: 6, y: 5 });
    expect(next.snakes[2].segments[0]).toEqual({ x: 2, y: 1 });
    expect(next.snakes[1].ticks).toBe(1);
    expect(next.snakes[2].ticks).toBe(1);
  });

  it("eliminates a player who hits the wall, leaving others unaffected", () => {
    const state = arena([
      snake({ playerId: 1, segments: [{ x: 9, y: 5 }], direction: "right", pendingDirection: "right" }),
      snake({ playerId: 2, segments: [{ x: 2, y: 2 }], direction: "up", pendingDirection: "up" }),
    ]);

    const { state: next, eliminated } = tickArena(state, fixedRandom);
    expect(next.snakes[1]).toBeUndefined();
    expect(next.snakes[2]).toBeDefined();
    expect(eliminated).toEqual([{ playerId: 1, score: 0, ticks: 0, reason: "wall" }]);
  });

  it("eliminates a player who hits their own body", () => {
    // 4-cell loop (same shape as rules.test.ts's LOOP_SNAKE): head at (5,5),
    // moving right drives it onto (6,5) — its own second segment.
    const loop = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    const state = arena([snake({ playerId: 1, segments: loop, direction: "right", pendingDirection: "right" })]);

    const { eliminated } = tickArena(state, fixedRandom);
    expect(eliminated).toEqual([{ playerId: 1, score: 0, ticks: 0, reason: "self" }]);
  });

  it("eliminates only the attacker when its head hits another snake's body", () => {
    const state = arena([
      snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
      snake({
        playerId: 2,
        segments: [
          { x: 6, y: 6 },
          { x: 5, y: 5 }, // player 1's next head lands here
          { x: 5, y: 6 },
        ],
        direction: "up",
        pendingDirection: "up",
      }),
    ]);

    const { state: next, eliminated } = tickArena(state, fixedRandom);
    expect(eliminated).toEqual([{ playerId: 1, score: 0, ticks: 0, reason: "snake" }]);
    expect(next.snakes[1]).toBeUndefined();
    expect(next.snakes[2]).toBeDefined();
  });

  it("eliminates both snakes on a head-to-head collision", () => {
    const state = arena([
      snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
      snake({ playerId: 2, segments: [{ x: 6, y: 5 }], direction: "left", pendingDirection: "left" }),
    ]);

    const { state: next, eliminated } = tickArena(state, fixedRandom);
    expect(next.snakes[1]).toBeUndefined();
    expect(next.snakes[2]).toBeUndefined();
    expect(eliminated.map((e) => e.playerId).sort()).toEqual([1, 2]);
    expect(eliminated.every((e) => e.reason === "snake")).toBe(true);
  });

  it("lets a surviving snake eat shared food: it grows, scores, and food moves", () => {
    const state = arena(
      [
        snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
        snake({ playerId: 2, segments: [{ x: 0, y: 9 }], direction: "right", pendingDirection: "right" }),
      ],
      { x: 5, y: 5 },
    );

    const { state: next } = tickArena(state, () => 0.9);
    expect(next.snakes[1].segments).toHaveLength(2);
    expect(next.snakes[1].score).toBe(POINTS_PER_FOOD);
    expect(next.food).not.toEqual({ x: 5, y: 5 });
    // The other player's score/length are untouched by someone else's food.
    expect(next.snakes[2].score).toBe(0);
    expect(next.snakes[2].segments).toHaveLength(1);
  });

  it("leaves food in place when only a head-to-head collision reaches it", () => {
    // Both heads move onto the food cell at the same time and eliminate
    // each other — nobody survives to actually eat it.
    const state = arena(
      [
        snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
        snake({ playerId: 2, segments: [{ x: 6, y: 5 }], direction: "left", pendingDirection: "left" }),
      ],
      { x: 5, y: 5 },
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.food).toEqual({ x: 5, y: 5 });
  });
});

describe("serializeArena", () => {
  it("turns the snakes record into an array alongside food and gridSize, with no raw playerId", () => {
    let state = createArena(10, fixedRandom);
    state = joinArena(state, 1, "Player One", fixedRandom);
    state = joinArena(state, 2, "Player Two", fixedRandom);

    const wire = serializeArena(state, 2);
    expect(wire.gridSize).toBe(10);
    expect(wire.food).toEqual(state.food);
    expect(wire.snakes).toHaveLength(2);
    expect(wire.snakes.every((s) => !("playerId" in s))).toBe(true);

    const mine = wire.snakes.find((s) => s.isMine);
    expect(mine?.displayName).toBe("Player Two");
    expect(wire.snakes.filter((s) => s.isMine)).toHaveLength(1);
  });

  it("marks nobody as mine when no viewer is given", () => {
    let state = createArena(10, fixedRandom);
    state = joinArena(state, 1, "Player One", fixedRandom);

    const wire = serializeArena(state);
    expect(wire.snakes.every((s) => !s.isMine)).toBe(true);
  });
});
