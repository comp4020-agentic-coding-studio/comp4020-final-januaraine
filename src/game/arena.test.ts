import { describe, expect, it } from "vitest";
import {
  DEATH_FADE_TICKS,
  DEATH_FOOD_LIFETIME_TICKS,
  DEATH_FOOD_WARNING_TICKS,
  MAX_DEATH_FOOD_CELLS,
  POINTS_PER_FOOD,
} from "./config";
import {
  type ArenaSnake,
  type ArenaState,
  type DyingSnake,
  type FoodItem,
  capDeathFood,
  createArena,
  isFoodExpiring,
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
    queuedDirection: null,
    score: 0,
    ticks: 0,
    ...overrides,
  };
}

function arena(
  snakes: ArenaSnake[],
  food: FoodItem[] = [{ x: 0, y: 0, source: "spawn" }],
  gridSize = 10,
  dying: DyingSnake[] = [],
): ArenaState {
  return { snakes: Object.fromEntries(snakes.map((s) => [s.playerId, s])), dying, food, gridSize };
}

function dyingSnake(overrides: Partial<DyingSnake> & Pick<DyingSnake, "playerId" | "segments">): DyingSnake {
  return {
    displayName: `Player ${overrides.playerId}`,
    reason: "wall",
    ticksRemaining: DEATH_FADE_TICKS,
    ...overrides,
  };
}

describe("createArena", () => {
  it("starts empty with food placed on the board", () => {
    const state = createArena(10, fixedRandom);
    expect(state.snakes).toEqual({});
    expect(state.dying).toEqual([]);
    // fixedRandom -> first free cell in scan order, tagged as the one
    // always-present ambient food.
    expect(state.food).toEqual([{ x: 0, y: 0, source: "spawn" }]);
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

  it("faces the new snake away from its nearest wall, not always right", () => {
    // Food parked in the far corner (out of scan order's way), so random()
    // = 0.59 on this empty 10x10 board lands at free-list/raw index 58,
    // i.e. (8, 5): clearance is 1 cell right, 8 left, 4 down, 5 up — left is
    // the only one not within a couple of ticks of an unsteered wall death.
    const state = arena([], [{ x: 9, y: 9, source: "spawn" }], 10);
    const joined = joinArena(state, 1, "Player One", () => 0.59);
    expect(joined.snakes[1].segments[0]).toEqual({ x: 8, y: 5 });
    expect(joined.snakes[1].direction).toBe("left");
    expect(joined.snakes[1].pendingDirection).toBe("left");
  });

  it("still defaults to right when no wall is any nearer than another", () => {
    // Food parked in the far corner; fixedRandom then lands spawn at
    // (0, 0) — equally 9 cells from the right wall and the bottom wall,
    // the only tie this spawn algorithm can produce on a square board.
    // Right stays the preferred tie-break.
    const state = arena([], [{ x: 9, y: 9, source: "spawn" }], 10);
    const joined = joinArena(state, 1, "Player One", fixedRandom);
    expect(joined.snakes[1].segments[0]).toEqual({ x: 0, y: 0 });
    expect(joined.snakes[1].direction).toBe("right");
  });

  it("never spawns a new player on top of a still-fading corpse", () => {
    // Every cell on a 2x2 board except (1,1) is blocked by food or a
    // fading corpse — the new player must land on the one cell left.
    const state = arena(
      [],
      [{ x: 0, y: 0, source: "spawn" }],
      2,
      [dyingSnake({ playerId: 9, segments: [{ x: 1, y: 0 }, { x: 0, y: 1 }] })],
    );
    const joined = joinArena(state, 1, "Player One", fixedRandom);
    expect(joined.snakes[1].segments[0]).toEqual({ x: 1, y: 1 });
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
    const state = arena([
      snake({ playerId: 1, segments: [{ x: 1, y: 1 }] }),
      snake({ playerId: 2, segments: [{ x: 5, y: 5 }] }),
    ]);

    const next = setArenaDirection(state, 1, "up");
    expect(next.snakes[1].pendingDirection).toBe("up");
    expect(next.snakes[1].direction).toBe("right"); // not moved yet, only queued
    expect(next.snakes[2].pendingDirection).toBe("right"); // unaffected
  });

  it("is a no-op for an unknown player", () => {
    const state = createArena(10, fixedRandom);
    expect(setArenaDirection(state, 999, "up")).toBe(state);
  });

  it("queues a second turn made before the first has applied, instead of discarding it", () => {
    const state = arena([snake({ playerId: 1, segments: [{ x: 5, y: 5 }], direction: "right" })]);

    // First turn this tick window: takes the empty pendingDirection slot,
    // exactly as before this queue existed.
    const afterFirst = setArenaDirection(state, 1, "up");
    expect(afterFirst.snakes[1].pendingDirection).toBe("up");
    expect(afterFirst.snakes[1].queuedDirection).toBeNull();

    // Second turn before the next tick: the pending slot is already holding
    // an unapplied turn, so this one queues behind it instead of silently
    // overwriting — the bug this fix targets.
    const afterSecond = setArenaDirection(afterFirst, 1, "left");
    expect(afterSecond.snakes[1].pendingDirection).toBe("up"); // first turn preserved
    expect(afterSecond.snakes[1].queuedDirection).toBe("left"); // second turn held, not lost
  });

  it("a third turn before either applies replaces the queued one, not the already-pending one", () => {
    const state = arena([snake({ playerId: 1, segments: [{ x: 5, y: 5 }], direction: "right" })]);
    const queued = setArenaDirection(setArenaDirection(state, 1, "up"), 1, "left");

    const third = setArenaDirection(queued, 1, "down");
    expect(third.snakes[1].pendingDirection).toBe("up");
    expect(third.snakes[1].queuedDirection).toBe("down");
  });
});

describe("tickArena", () => {
  it("is a no-op on an empty arena with no fades in progress", () => {
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

  it("lets a surviving snake eat shared food: it grows, scores, and the spawn food is replaced", () => {
    const state = arena(
      [
        snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
        snake({ playerId: 2, segments: [{ x: 0, y: 9 }], direction: "right", pendingDirection: "right" }),
      ],
      [{ x: 5, y: 5, source: "spawn" }],
    );

    const { state: next, eaten } = tickArena(state, () => 0.9);
    expect(next.snakes[1].segments).toHaveLength(2);
    expect(next.snakes[1].score).toBe(POINTS_PER_FOOD);
    expect(next.food).toHaveLength(1);
    expect(next.food[0].source).toBe("spawn");
    expect(next.food[0]).not.toEqual({ x: 5, y: 5, source: "spawn" });
    // The other player's score/length are untouched by someone else's food.
    expect(next.snakes[2].score).toBe(0);
    expect(next.snakes[2].segments).toHaveLength(1);
    // Attributed to the player who actually ate it, not the other snake.
    expect(eaten).toEqual([{ playerId: 1, source: "spawn" }]);
  });

  it("leaves food in place when only a head-to-head collision reaches it", () => {
    // Both heads move onto the food cell at the same time and eliminate
    // each other — nobody survives to actually eat it.
    const state = arena(
      [
        snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
        snake({ playerId: 2, segments: [{ x: 6, y: 5 }], direction: "left", pendingDirection: "left" }),
      ],
      [{ x: 5, y: 5, source: "spawn" }],
    );

    const { state: next, eaten } = tickArena(state, fixedRandom);
    expect(next.food).toEqual([{ x: 5, y: 5, source: "spawn" }]);
    // Nobody survived to eat it, so nothing is attributed.
    expect(eaten).toEqual([]);
  });

  it("applies a queued turn on the tick after the one ahead of it, instead of losing it", () => {
    // Two turns made in quick succession before either has had a tick to
    // apply: up (takes the pending slot), then left (queues behind it) —
    // exactly setArenaDirection's own queuing test, but now observed through
    // tickArena to confirm the queued turn actually takes effect later
    // rather than just sitting in state forever.
    const queued = setArenaDirection(
      setArenaDirection(arena([snake({ playerId: 1, segments: [{ x: 5, y: 5 }], direction: "right" })]), 1, "up"),
      1,
      "left",
    );

    const firstTick = tickArena(queued, fixedRandom);
    // First tick applies the already-pending "up" turn, exactly as it would
    // have without any queued turn behind it.
    expect(firstTick.state.snakes[1].segments[0]).toEqual({ x: 5, y: 4 });
    expect(firstTick.state.snakes[1].direction).toBe("up");
    // The queued "left" turn has been promoted into the now-empty pending
    // slot, ready to apply on the very next tick.
    expect(firstTick.state.snakes[1].pendingDirection).toBe("left");
    expect(firstTick.state.snakes[1].queuedDirection).toBeNull();

    const secondTick = tickArena(firstTick.state, fixedRandom);
    // Second tick applies the promoted "left" turn — the input from before
    // the first tick was never lost, just delayed by exactly one tick.
    expect(secondTick.state.snakes[1].segments[0]).toEqual({ x: 4, y: 4 });
    expect(secondTick.state.snakes[1].direction).toBe("left");
  });

  it("rejects a queued turn that would reverse into the snake's new direction, falling back to it", () => {
    // Queued turn "down" is a direct reversal of the pending "up" turn it's
    // promoted behind — isValidDirectionChange must re-check it against the
    // direction the snake will actually be facing when it applies, the same
    // rule an ordinary (non-queued) pendingDirection is already held to.
    const queued = setArenaDirection(
      setArenaDirection(arena([snake({ playerId: 1, segments: [{ x: 5, y: 5 }], direction: "right" })]), 1, "up"),
      1,
      "down",
    );

    const firstTick = tickArena(queued, fixedRandom);
    expect(firstTick.state.snakes[1].direction).toBe("up");
    expect(firstTick.state.snakes[1].pendingDirection).toBe("down");

    const secondTick = tickArena(firstTick.state, fixedRandom);
    // "down" is a reversal of "up", so it's rejected and the snake keeps
    // heading up — it does not reverse into its own neck.
    expect(secondTick.state.snakes[1].direction).toBe("up");
    expect(secondTick.state.snakes[1].segments[0]).toEqual({ x: 5, y: 3 });
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
    expect(wire.dying).toEqual([]);
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

describe("death fade and body-to-food conversion", () => {
  it("freezes a wall-eliminated snake's pre-move body into dying, not the invalid off-grid head", () => {
    const state = arena([
      snake({
        playerId: 1,
        segments: [
          { x: 9, y: 5 },
          { x: 8, y: 5 },
        ],
        direction: "right",
        pendingDirection: "right",
      }),
    ]);

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.snakes[1]).toBeUndefined();
    expect(next.dying).toEqual([
      {
        playerId: 1,
        displayName: "Player 1",
        segments: [
          { x: 9, y: 5 },
          { x: 8, y: 5 },
        ],
        reason: "wall",
        ticksRemaining: DEATH_FADE_TICKS,
      },
    ]);
  });

  it("freezes a self-collision's and a snake-collision's body the same way", () => {
    const loop = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    const selfState = arena([snake({ playerId: 1, segments: loop, direction: "right", pendingDirection: "right" })]);
    const { state: afterSelf } = tickArena(selfState, fixedRandom);
    expect(afterSelf.dying[0]).toMatchObject({ playerId: 1, reason: "self", segments: loop });

    const snakeState = arena([
      snake({ playerId: 1, segments: [{ x: 4, y: 5 }], direction: "right", pendingDirection: "right" }),
      snake({
        playerId: 2,
        segments: [
          { x: 6, y: 6 },
          { x: 5, y: 5 },
          { x: 5, y: 6 },
        ],
        direction: "up",
        pendingDirection: "up",
      }),
    ]);
    const { state: afterSnake } = tickArena(snakeState, fixedRandom);
    expect(afterSnake.dying[0]).toMatchObject({ playerId: 1, reason: "snake", segments: [{ x: 4, y: 5 }] });
    expect(afterSnake.snakes[2]).toBeDefined();
  });

  it("does not let a fading snake move or collide again — a live snake can pass right through its corpse", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 2, y: 3 }], direction: "right", pendingDirection: "right" })],
      [],
      10,
      [dyingSnake({ playerId: 99, segments: [{ x: 3, y: 3 }], ticksRemaining: 3 })],
    );

    const { state: next, eliminated } = tickArena(state, fixedRandom);
    expect(eliminated).toEqual([]);
    expect(next.snakes[1]).toBeDefined();
    expect(next.snakes[1].segments[0]).toEqual({ x: 3, y: 3 }); // moved straight onto the corpse's cell, unharmed
    expect(next.dying).toEqual([{ ...dyingSnake({ playerId: 99, segments: [{ x: 3, y: 3 }] }), ticksRemaining: 2 }]);
  });

  it("converts an expired fade's eligible body cells into death food and drops it from dying", () => {
    const state = arena(
      [],
      [],
      10,
      [
        dyingSnake({
          playerId: 5,
          segments: [
            { x: 1, y: 1 },
            { x: 1, y: 2 },
          ],
          reason: "self",
          ticksRemaining: 1, // decrements to 0 this tick -> expires
        }),
      ],
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.dying).toEqual([]);
    expect(next.food).toEqual(
      expect.arrayContaining([
        { x: 1, y: 1, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS },
        { x: 1, y: 2, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS },
      ]),
    );
    expect(next.food).toHaveLength(2);
  });

  it("never drops death food on a cell already occupied by existing food, a survivor's new body, or another still-fading snake", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 2, y: 1 }], direction: "up", pendingDirection: "up" })], // new head -> (2,0)
      [{ x: 1, y: 0, source: "spawn" }],
      10,
      [
        dyingSnake({
          playerId: 5,
          segments: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
          ],
          ticksRemaining: 1, // expires this tick
        }),
        dyingSnake({ playerId: 6, segments: [{ x: 0, y: 0 }], ticksRemaining: 2 }), // still fading, blocks (0,0)
      ],
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.dying).toEqual([{ ...dyingSnake({ playerId: 6, segments: [{ x: 0, y: 0 }] }), ticksRemaining: 1 }]);
    expect(next.snakes[1].segments[0]).toEqual({ x: 2, y: 0 });
    // (0,0) blocked by the still-fading snake, (1,0) by existing food,
    // (2,0) by the survivor's new head — only (3,0) was ever eligible.
    expect(next.food).toEqual(
      expect.arrayContaining([
        { x: 1, y: 0, source: "spawn" },
        { x: 3, y: 0, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS },
      ]),
    );
    expect(next.food).toHaveLength(2);
  });

  it("produces no food and does not throw when an eliminated snake has no eligible cells left", () => {
    const state = arena(
      [],
      [{ x: 5, y: 5, source: "spawn" }],
      10,
      [dyingSnake({ playerId: 5, segments: [{ x: 5, y: 5 }], ticksRemaining: 1 })],
    );

    expect(() => tickArena(state, fixedRandom)).not.toThrow();
    const { state: next } = tickArena(state, fixedRandom);
    expect(next.dying).toEqual([]);
    expect(next.food).toEqual([{ x: 5, y: 5, source: "spawn" }]);
  });

  it("never drops two death-food items on the same cell when two snakes expire in the same tick", () => {
    const state = arena(
      [],
      [],
      10,
      [
        dyingSnake({ playerId: 2, segments: [{ x: 2, y: 2 }], ticksRemaining: 1 }),
        dyingSnake({ playerId: 1, segments: [{ x: 2, y: 2 }], ticksRemaining: 1 }),
      ],
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.dying).toEqual([]);
    expect(next.food).toEqual([{ x: 2, y: 2, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS }]);
  });

  it("lets a survivor eat death food (grows/scores the same as normal food) without replacing it", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 1, y: 1 }], direction: "right", pendingDirection: "right" })],
      [{ x: 2, y: 1, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS }],
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.snakes[1].segments).toHaveLength(2);
    expect(next.snakes[1].score).toBe(POINTS_PER_FOOD);
    expect(next.food).toEqual([]); // one-shot: nothing replaces it
  });

  it("replaces an eaten spawn item while leftover death food is untouched, via the normal random-spawn logic", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 1, y: 1 }], direction: "right", pendingDirection: "right" })],
      [
        { x: 2, y: 1, source: "spawn" },
        { x: 5, y: 5, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS },
      ],
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.snakes[1].score).toBe(POINTS_PER_FOOD);
    // Leftover death food survives untouched (just one tick older); a fresh
    // spawn item replaces the one eaten, landing on the first free cell in
    // scan order once the snake's new body and the leftover death food are
    // excluded.
    expect(next.food).toEqual(
      expect.arrayContaining([
        { x: 5, y: 5, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS - 1 },
        { x: 0, y: 0, source: "spawn" },
      ]),
    );
    expect(next.food).toHaveLength(2);
  });

  it("goes back to only the ambient spawn food, spawning exactly as before, once all death food from a kill is gone", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 1, y: 1 }], direction: "right", pendingDirection: "right" })],
      [{ x: 2, y: 1, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS }], // the only food left after a kill's other cells were already eaten
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.food.some((f) => f.source === "death")).toBe(false);
    expect(next.food).toEqual([]); // the eaten death cell isn't replaced

    // A further tick with no food at all behaves exactly like the
    // pre-existing single-food game: nothing to eat, nothing changes but
    // position/ticks.
    const { state: further } = tickArena(next, fixedRandom);
    expect(further.food).toEqual([]);
    expect(further.snakes[1].ticks).toBe(2);
  });

  describe("serializeArena", () => {
    it("includes a fading snake's displayName/segments/reason/opacity, with isMine computed per viewer", () => {
      const state = arena([], [], 10, [
        dyingSnake({ playerId: 7, displayName: "P7", segments: [{ x: 1, y: 1 }], reason: "wall", ticksRemaining: 2 }),
      ]);

      const mine = serializeArena(state, 7);
      expect(mine.dying).toEqual([
        { displayName: "P7", segments: [{ x: 1, y: 1 }], reason: "wall", isMine: true, opacity: 2 / DEATH_FADE_TICKS },
      ]);

      // A different (or absent) viewer sees the exact same authoritative
      // fade — only isMine differs — confirming every client in the room
      // is driven from one shared state.
      const someoneElse = serializeArena(state, 999);
      expect(someoneElse.dying).toEqual([
        { displayName: "P7", segments: [{ x: 1, y: 1 }], reason: "wall", isMine: false, opacity: 2 / DEATH_FADE_TICKS },
      ]);
    });
  });
});

describe("death-food lifecycle", () => {
  it("a freshly converted death-food cell survives a tick with ticks to spare, just one tick older", () => {
    const state = arena(
      [],
      [],
      10,
      [dyingSnake({ playerId: 9, segments: [{ x: 4, y: 4 }], ticksRemaining: 1 })], // expires this tick
    );

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.food).toEqual([{ x: 4, y: 4, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS }]);

    // One ordinary tick later, nothing special happens to it yet — still
    // present, just a tick closer to expiring.
    const { state: after } = tickArena(next, fixedRandom);
    expect(after.food).toEqual([{ x: 4, y: 4, source: "death", ticksRemaining: DEATH_FOOD_LIFETIME_TICKS - 1 }]);
  });

  it("removes an expired death-food cell automatically, even though nobody ever collected it", () => {
    const state = arena([], [{ x: 4, y: 4, source: "death", ticksRemaining: 1 }], 10, []);

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.food).toEqual([]);
  });

  it("leaves spawn food, live snakes, and dying corpses untouched by a death-food expiry on the same tick", () => {
    const state = arena(
      [snake({ playerId: 1, segments: [{ x: 7, y: 7 }], direction: "right", pendingDirection: "right" })],
      [
        { x: 0, y: 0, source: "spawn" },
        { x: 4, y: 4, source: "death", ticksRemaining: 1 }, // expires this tick
      ],
      10,
      [dyingSnake({ playerId: 99, segments: [{ x: 9, y: 9 }], ticksRemaining: 3 })],
    );

    const { state: next } = tickArena(state, fixedRandom);
    // Only the expired death-food cell is gone — the spawn item, the live
    // snake, and the still-fading corpse are all exactly what an ordinary
    // tick with no death food at all would have produced.
    expect(next.food).toEqual([{ x: 0, y: 0, source: "spawn" }]);
    expect(next.snakes[1].segments[0]).toEqual({ x: 8, y: 7 });
    expect(next.dying).toEqual([{ ...dyingSnake({ playerId: 99, segments: [{ x: 9, y: 9 }] }), ticksRemaining: 2 }]);
  });

  it("cannot award points twice for one cell — it is either eaten this tick or expired, never both", () => {
    // Case 1: ticksRemaining is high enough to still be present when the
    // snake's head lands on it — eaten normally, scored once.
    const eatenState = arena(
      [snake({ playerId: 1, segments: [{ x: 3, y: 4 }], direction: "right", pendingDirection: "right" })],
      [{ x: 4, y: 4, source: "death", ticksRemaining: 2 }],
    );
    const { state: eatenNext, eaten } = tickArena(eatenState, fixedRandom);
    expect(eatenNext.snakes[1].score).toBe(POINTS_PER_FOOD);
    expect(eaten).toEqual([{ playerId: 1, source: "death" }]);
    expect(eatenNext.food).toEqual([]); // consumed, not left behind

    // Case 2: ticksRemaining expires on the very tick the same head would
    // have landed on it — the cell is removed before the eat-check runs, so
    // the snake gets nothing for it, and nothing is double-counted.
    const expiredState = arena(
      [snake({ playerId: 1, segments: [{ x: 3, y: 4 }], direction: "right", pendingDirection: "right" })],
      [{ x: 4, y: 4, source: "death", ticksRemaining: 1 }],
    );
    const { state: expiredNext, eaten: eatenOnExpiry } = tickArena(expiredState, fixedRandom);
    expect(expiredNext.snakes[1].score).toBe(0);
    expect(eatenOnExpiry).toEqual([]);
    expect(expiredNext.food).toEqual([]); // gone either way, but never scored
  });

  it("isFoodExpiring is true only for death food within the final warning window, never for spawn food", () => {
    expect(isFoodExpiring({ x: 0, y: 0, source: "spawn" })).toBe(false);
    expect(isFoodExpiring({ x: 0, y: 0, source: "death", ticksRemaining: DEATH_FOOD_WARNING_TICKS + 1 })).toBe(false);
    expect(isFoodExpiring({ x: 0, y: 0, source: "death", ticksRemaining: DEATH_FOOD_WARNING_TICKS })).toBe(true);
    expect(isFoodExpiring({ x: 0, y: 0, source: "death", ticksRemaining: 1 })).toBe(true);
  });

  describe("capDeathFood", () => {
    it("leaves food untouched when death-food count is at or under the cap", () => {
      const food: FoodItem[] = [
        { x: 0, y: 0, source: "spawn" },
        { x: 1, y: 1, source: "death", ticksRemaining: 5 },
        { x: 2, y: 2, source: "death", ticksRemaining: 10 },
      ];
      expect(capDeathFood(food, 2)).toEqual(food);
    });

    it("never evicts spawn food — the cap only ever bounds death-food cells", () => {
      const food: FoodItem[] = [
        { x: 0, y: 0, source: "spawn" },
        { x: 1, y: 1, source: "death", ticksRemaining: 1 },
        { x: 2, y: 2, source: "death", ticksRemaining: 2 },
        { x: 3, y: 3, source: "death", ticksRemaining: 3 },
      ];
      const capped = capDeathFood(food, 1);
      expect(capped).toContainEqual({ x: 0, y: 0, source: "spawn" });
      expect(capped.filter((f) => f.source === "death")).toHaveLength(1);
    });

    it("evicts the lowest-ticksRemaining (closest to expiring) death-food cells first", () => {
      const food: FoodItem[] = [
        { x: 1, y: 1, source: "death", ticksRemaining: 50 },
        { x: 2, y: 2, source: "death", ticksRemaining: 1 }, // oldest — evicted first
        { x: 3, y: 3, source: "death", ticksRemaining: 20 },
      ];
      const capped = capDeathFood(food, 2);
      expect(capped).toEqual(
        expect.arrayContaining([
          { x: 1, y: 1, source: "death", ticksRemaining: 50 },
          { x: 3, y: 3, source: "death", ticksRemaining: 20 },
        ]),
      );
      expect(capped).toHaveLength(2);
    });

    it("never produces more death-food cells than the cap, however many are passed in", () => {
      const food: FoodItem[] = Array.from({ length: 30 }, (_, i) => ({
        x: i,
        y: 0,
        source: "death" as const,
        ticksRemaining: i + 1,
      }));
      const capped = capDeathFood(food, 10);
      const deathCells = capped.filter((f): f is Extract<FoodItem, { source: "death" }> => f.source === "death");
      expect(deathCells).toHaveLength(10);
      // The 10 kept are exactly the 10 with the highest ticksRemaining (21-30).
      expect(deathCells.map((f) => f.ticksRemaining).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 10 }, (_, i) => 21 + i),
      );
    });

    it("keeps the result within the cap when a single death's conversion alone would exceed it", () => {
      // One large corpse's eligible cells all land on the board the same
      // tick with the same brand-new ticksRemaining — capDeathFood must
      // still bring the total back under the cap deterministically, not
      // merely "usually."
      const hugeCorpseSegments = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 0 }));
      const state = arena([], [], 20, [
        dyingSnake({ playerId: 42, segments: hugeCorpseSegments, ticksRemaining: 1 }),
      ]);

      const { state: next } = tickArena(state, fixedRandom);
      expect(next.food.length).toBeLessThanOrEqual(MAX_DEATH_FOOD_CELLS);
      // No duplicate/overlapping cells among whatever survived the cap.
      const keys = next.food.map((f) => `${f.x},${f.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  it("enforces the cap after a tick's cleanup, regardless of how many sources added cells that same tick", () => {
    // Already at the cap before this tick; one more corpse's cells convert
    // on this same tick, pushing the total over — the post-tick count must
    // still respect MAX_DEATH_FOOD_CELLS.
    const existingDeathFood: FoodItem[] = Array.from({ length: MAX_DEATH_FOOD_CELLS }, (_, i) => ({
      x: i % 20,
      y: Math.floor(i / 20) + 1,
      source: "death" as const,
      ticksRemaining: 50,
    }));
    const state = arena([], existingDeathFood, 20, [
      dyingSnake({ playerId: 7, segments: [{ x: 0, y: 19 }], ticksRemaining: 1 }),
    ]);

    const { state: next } = tickArena(state, fixedRandom);
    expect(next.food.filter((f) => f.source === "death").length).toBeLessThanOrEqual(MAX_DEATH_FOOD_CELLS);
  });

  it("gives every client the same authoritative ticksRemaining for a death-food cell, regardless of viewer", () => {
    const state = arena([], [{ x: 4, y: 4, source: "death", ticksRemaining: 30 }], 10, []);

    const mine = serializeArena(state, 1);
    const someoneElse = serializeArena(state, 999);
    const noViewer = serializeArena(state);

    // Food has no isMine concept — every viewer (Player or Viewer role
    // alike) is handed the exact same array, which is what guarantees the
    // expiration warning renders in lockstep for everyone in the room.
    expect(mine.food).toEqual(someoneElse.food);
    expect(mine.food).toEqual(noViewer.food);
    expect(mine.food).toEqual([{ x: 4, y: 4, source: "death", ticksRemaining: 30 }]);
  });
});
