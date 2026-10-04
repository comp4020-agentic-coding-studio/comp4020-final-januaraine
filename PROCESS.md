## What I built

I built Snake Arena, a browser-based multiplayer Snake game designed around a simple idea: turn the familiar single-player Snake game into a small shared competitive space. Players can play anonymously, control their snake in real time, compete for food and score, and have their best result recorded on a persistent leaderboard. The project focuses on making real-time interaction, persistence, and player identity part of the core experience rather than adding them as secondary features. The application is deployed as a full-stack web application, with the server responsible for authoritative game state and the database responsible for persistent game results.

## The moments that mattered

### Moment 1: Building the game as a vertical slice before adding multiplayer

1. **what happened**:

   The first important decision was to build a complete playable version of Snake before implementing multiplayer. The initial goal was deliberately small: a player should be able to enter the game, control the snake, eat food, grow, accumulate score, collide, and finish a run. This gave the project a complete gameplay loop before introducing WebSockets and multi-user synchronization.

2. **what you did instead of the obvious thing**:

   Instead of starting with the multiplayer infrastructure immediately, I separated the core game rules from the networking and UI layers. I treated the single-player game as the foundation and designed the game state so that it could later be controlled by a server-authoritative multiplayer loop.

   This meant that movement, collision detection, food generation, growth, scoring, and game-over conditions were treated as game rules rather than UI behaviour.

3. **how you knew it was right**:

   The vertical slice gave me a working and testable game before the complexity of real-time synchronization was introduced. It also reduced the risk of debugging gameplay bugs and WebSocket bugs simultaneously. Once the core loop was reliable, multiplayer could be treated as a synchronization problem rather than a complete rewrite of the game.

4. **the citation**:

   [5dcd4af...12e6e18](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/5dcd4af...12e6e18)


### Moment 2: Treating anonymous identity and data deletion as separate engineering problems

1. **what happened**:

   While implementing the ability for a player to remove their leaderboard record, I realised that an anonymous player ID does not represent a real-world person or a physical computer. It represents an anonymous browser/session identity. Therefore, "delete my record" needed to be defined more precisely.

2. **what you did instead of the obvious thing**:

   Instead of implementing a simple "hide from leaderboard" flag, I chose permanent deletion of all persistent game data associated with the current anonymous player identity. The server determines the current player from the existing session identity rather than trusting a player ID supplied by the client.

   Because the operation is irreversible, the UI also requires explicit confirmation before deletion. After deletion, the anonymous identity is invalidated so that the deleted data cannot accidentally become associated with the same identity again.

3. **how you knew it was right**:

   This approach makes the meaning of the feature explicit: the player is controlling the data associated with their current anonymous identity, rather than claiming to prove the identity of a real-world person. Server-side authorization also prevents a client from changing an ID in a request and deleting another player's data.

4. **the citation**:

   [4590428...fe11139](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/4590428...fe11139)