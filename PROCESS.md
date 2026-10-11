# Process overview

## What I built

Snake Arena is a browser-based, real-time multiplayer Snake game built around anonymous players, shared rooms, and a persistent leaderboard. The idea was to take a familiar single-player game and turn it into a shared experience where players can join the same room, control their own snakes, watch other players in real time, and compete without creating an account. C9 focused on making concurrent play work reliably while keeping the game understandable and accessible across desktop and mobile devices.

## The moments that mattered

### Moment 1: Moving from solo play to a shared, real-time arena

1. **What happened:** The project evolved from a single-player Snake game into a room-based multiplayer game. This introduced problems that do not exist in solo play: multiple players must see a consistent arena, player inputs must be handled safely, and updates must reach other connected sessions without requiring a page reload.

2. **What you did instead of the obvious thing:** Rather than treating each browser as the owner of its own game state, I used the server as the authority for shared arena state. Clients send inputs, while the server processes game progression and distributes updates. This makes the shared game state less dependent on individual clients and gives newly connected or reconnected sessions a way to recover the current state.

3. **How you knew it was right:** I checked the multiplayer behavior through the existing room tests and local multi-session testing, focusing on whether different clients could observe the same room and whether state updates propagated without reloading. The important success criterion was not simply that the game worked in one browser, but that independent sessions could participate in the same live game.

4. **The citation:** [8accb31...d121156](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/8accb31...d121156)


### Moment 2: Treating multiplayer edge cases as part of the game design

1. **What happened:** Multiplayer introduced lifecycle and consistency questions beyond the basic Snake movement rules. A player can be eliminated while other players continue playing; viewers may remain after players leave; and disconnected clients may need to recover the current room state.

2. **What you did instead of the obvious thing:** I did not treat these cases as ordinary single-player game-over behavior. The server remains responsible for authoritative game state, while each client presents the appropriate view for its own role and status. Room lifecycle rules also distinguish active players from viewers, rather than assuming that anyone still viewing a room means it should remain active.

3. **How you knew it was right:** I examined the room lifecycle and elimination behavior against the intended multiplayer experience, and used tests to investigate failures rather than assuming every failed test meant the production game logic was broken. This helped separate actual implementation defects from timing-sensitive test assumptions.

4. **The citation:** [1af35d2...4b4330d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/1af35d2...4b4330d)

### Moment 3: Making the development process more reliable through targeted verification

1. **What happened:** Testing exposed a flaky room test: a snake could spawn close to a wall and be eliminated by normal movement before a timing-dependent assertion ran. Repeated local runs showed that the failure was intermittent rather than a deterministic failure of the intended behavior.

2. **What you did instead of the obvious thing:** Instead of simply increasing timeouts or immediately changing production game rules, I investigated the cause and separated test reliability from game-design decisions. The test was adjusted to account for the random spawn position, and the affected test suite was run repeatedly to check whether the fix addressed the race.

3. **How you knew it was right:** Type checking was clean, and the room test was stress-tested over 20 repeated runs after the changes. This provided stronger evidence than relying on a single successful test run. The lesson was that a green test result is useful only when the test itself reliably measures the behavior it is intended to verify.

4. **The citation:** [b527db1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/b527db1) 
[1af35d2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/1af35d2)

