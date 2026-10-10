# Snake Arena — COMP4020 Final Project Technical Design

> A real-time multiplayer Snake game inspired by the gameplay idea of competitive snake mini-games, while using original game rules, visuals, assets, and branding.

## 1. Project Overview

### Working title

**Snake Arena**

### One-sentence pitch

> A browser-based real-time multiplayer Snake game where players compete for food, space, power-ups, and survival in a shared arena.

The project is designed around the Final Project requirements:

- Multi-user
- Real-time shared state
- Persistent backend state
- Deployed full-stack web application
- Observability and logging

The game should be playable without registration. Each browser session receives an anonymous server-generated player/session identity.

---

# 2. Core Product Concept

Players enter a lobby and join or create a game room.

Inside a room:

1. Each player controls one snake.
2. All players share the same arena.
3. Food and optional power-ups appear in the arena.
4. Players move simultaneously.
5. The server is authoritative for game state.
6. The server detects movement, food collection, and collisions.
7. Game state is broadcast to connected players in real time.
8. When the game ends, the result is persisted.
9. Historical scores can be displayed on a leaderboard.

The central product idea is:

> **The presence and actions of other players should directly affect gameplay.**

Realtime is therefore not an additional feature; it is part of the core game.

---

# 3. Relationship to C8 / C9 / C10

C8, C9 and C10 should be treated as milestones of the same application rather than three separate applications.

## C8 — Core playable application

Goal:

> Prove that the application exists, works, persists state, and is deployed.

Required/target functionality:

- Playable Snake game
- Player/session identity
- Food
- Snake growth
- Collision detection
- Score
- Game over
- Restart
- Backend API
- Database persistence
- Deployed application
- Stranger can open the URL and understand how to play

At C8, the multiplayer infrastructure may already exist, but the important demonstration is that the core application is functional.

### C8 demo

A simple demo sequence:

1. Open the deployed URL.
2. Enter a room.
3. Start a game.
4. Move the snake.
5. Eat food.
6. Grow.
7. Die or finish the game.
8. Refresh/revisit.
9. Show that the relevant persistent result remains available.

---

## C9 — Multi-user + real-time

Goal:

> Prove that multiple independent browser sessions participate in the same live game.

Two or more browser windows should be sufficient for demonstration.

Example:

```text
Browser A                  Browser B
Player A                   Player B
   |                          |
   | input                    | input
   +------------+-------------+
                |
             WebSocket
                |
             Server
                |
        authoritative state
                |
        +-------+-------+
        |               |
        ↓               ↓
   Browser A        Browser B
```

When Player A moves, Player B sees the updated state without refreshing.

When Player A eats food:

- the server decides whether the food was collected;
- the food disappears from both clients;
- Player A's score changes;
- Player A's snake grows;
- the updated state is broadcast.

When Player A dies:

- all clients receive the same game result.

WebSocket is appropriate because it provides a bidirectional communication channel between browser and server without polling. [MDN WebSocket documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API).

### C9 demo

Use two browser windows:

```text
Window A                  Window B
Player A                  Player B

move right                sees A move
eat food                  sees food disappear
grow                      sees longer snake
approach B                sees collision
die                       receives game-over
```

---

## C10 — Observability

Goal:

> Prove that the developer can understand what the system is doing and diagnose failures.

Add structured logging and useful runtime instrumentation.

Suggested events:

```text
player_connected
player_disconnected
room_created
player_joined_room
player_left_room
game_started
game_tick
food_spawned
food_collected
collision_detected
player_eliminated
game_finished
websocket_error
database_error
```

Example structured log:

```json
{
  "event": "player_eliminated",
  "gameId": "game_8392",
  "playerId": "player_A7F3",
  "reason": "wall_collision",
  "tick": 18293,
  "timestamp": "..."
}
```

Useful metrics:

```text
active_connections
active_rooms
active_players
games_started
games_finished
food_collected
player_eliminations
websocket_disconnects
websocket_errors
api_latency
database_errors
```

The goal is not to build a huge monitoring platform. The goal is to make the system observable enough to answer:

- Who is connected?
- Which room are they in?
- Is a game running?
- What happened?
- When did it happen?
- Did the WebSocket fail?
- Did the database fail?
- How long did requests take?

---

# 4. Recommended Architecture

## High-level architecture

```text
                     Browser
                       |
              Next.js / React
                       |
             HTTP API + WebSocket
                       |
                       v
                Game Server
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
   Room Manager   Game Engine   Realtime Manager
        |              |              |
        +--------------+--------------+
                       |
                 Persistence
                       |
                       v
                  PostgreSQL
```

For a small course project, SQLite can be acceptable during local development. If deployment/runtime characteristics require a more durable multi-instance setup, PostgreSQL is the safer production direction.

---

# 5. Frontend

Recommended stack:

- Next.js
- React
- TypeScript
- CSS/Tailwind or another lightweight styling approach
- HTML Canvas for the game board

## Frontend responsibilities

The client should handle:

- Rendering
- Keyboard input
- Touch/mobile input if time permits
- UI state
- WebSocket connection
- Interpolation/smoothing if needed
- Menus
- Lobby
- Scoreboard
- Game-over screen

The client should NOT be authoritative for:

- Final player position
- Collision results
- Food ownership
- Score
- Winner
- Game outcome

The server should determine these.

---

# 6. Backend

Recommended options:

### Option A — TypeScript full-stack

```text
Next.js
+
Node.js
+
WebSocket library
```

Advantages:

- One language across the project
- Good fit with React/Next.js
- Easy type sharing between client/server

### Option B — Next.js + FastAPI

```text
Next.js / React / TypeScript
             |
             | HTTP / WebSocket
             ↓
FastAPI / Python
             |
             ↓
Database
```

Advantages:

- Python game/backend logic
- Familiar Python ecosystem
- Clear frontend/backend separation

For this project, either architecture is reasonable. Avoid adding a framework simply because it is fashionable.

---

# 7. Game Engine

The server should run an authoritative fixed-timestep game loop.

Conceptually:

```text
Game Loop
    |
    +-- receive player inputs
    |
    +-- validate inputs
    |
    +-- update snake positions
    |
    +-- detect food collision
    |
    +-- update growth / score
    |
    +-- detect player collisions
    |
    +-- detect wall/self collisions
    |
    +-- update power-ups
    |
    +-- produce new state
    |
    +-- broadcast state/events
```

The game loop should be independent from browser rendering speed.

For example:

```text
Server tick
   ↓
20–30 updates/sec
```

The browser can render at its own frame rate.

Do not write every game tick to the database.

---

# 8. Client Input Model

The client should send intent rather than complete game state.

Good:

```json
{
  "type": "input",
  "direction": "LEFT",
  "sequence": 184
}
```

Bad:

```json
{
  "x": 123,
  "y": 456,
  "score": 99999
}
```

The client should never be trusted to tell the server:

> "I am at x=123 and my score is 99999."

The server calculates the authoritative state.

---

# 9. WebSocket Message Protocol

Suggested protocol.

## Client → Server

### Join room

```json
{
  "type": "join_room",
  "roomId": "ABCD"
}
```

### Input

```json
{
  "type": "input",
  "direction": "UP",
  "sequence": 42
}
```

### Ready

```json
{
  "type": "ready"
}
```

### Leave

```json
{
  "type": "leave_room"
}
```

---

## Server → Client

### Room state

```json
{
  "type": "room_state",
  "roomId": "ABCD",
  "players": [...]
}
```

### Game state

```json
{
  "type": "game_state",
  "tick": 18293,
  "players": [...],
  "food": [...],
  "powerUps": [...]
}
```

### Player joined

```json
{
  "type": "player_joined",
  "player": {...}
}
```

### Player eliminated

```json
{
  "type": "player_eliminated",
  "playerId": "A7F3",
  "reason": "collision"
}
```

### Game finished

```json
{
  "type": "game_finished",
  "winner": "B82C",
  "scores": [...]
}
```

Keep the protocol explicit and versionable.

---

# 10. Anonymous Identity

Registration is not required for the MVP.

When a visitor connects:

```text
Browser
   ↓
Server
   ↓
generate session/player ID
   ↓
store in secure cookie/session
```

Example:

```text
player_A7F3
```

The identity only needs to distinguish players.

Do not use a client-supplied arbitrary user ID as an authorization mechanism.

If rooms become private, the server should determine which session belongs to which room.

---

# 11. Room System

Suggested room lifecycle:

```text
CREATE
  ↓
WAITING
  ↓
RUNNING
  ↓
FINISHED
  ↓
RESULTS
```

Room states:

```text
WAITING
RUNNING
FINISHED
```

Example:

```text
Room A
4 / 8 players

Player A  READY
Player B  READY
Player C  NOT READY
Player D  READY
```

The game starts when the room satisfies its start condition.

For the MVP, a simple rule is enough:

> Start when at least 2 players are ready.

---

# 12. Game Rules — MVP

Keep the first version deliberately small.

## Player

Each player has:

```text
id
displayName
snake
direction
score
alive
```

## Snake

```text
segments: [
  {x, y},
  {x, y},
  {x, y}
]
```

## Food

```text
{
  id,
  position,
  type
}
```

## Basic rules

1. Snake moves continuously.
2. Eating food increases length.
3. Eating food increases score.
4. Wall collision eliminates a player.
5. Self collision eliminates a player.
6. Player collision follows one clearly defined rule.
7. Last surviving player wins.
8. If no competitive ending condition is appropriate, the highest score at the timer limit wins.

---

# 13. Collision Rules

Define this early because it affects the entire game engine.

Recommended MVP rule:

### Wall

```text
head outside arena
→ eliminated
```

### Self

```text
head intersects own body
→ eliminated
```

### Snake vs snake

Start with a simple rule:

```text
head hits another snake's body
→ attacker eliminated
```

For head-to-head collision:

```text
same cell
→ both eliminated
```

This avoids complicated combat logic in the first implementation.

Later, if desired:

- Larger snake survives
- Head-to-head duel rules
- Cut-off mechanics
- Shield
- Dash

These are extensions, not MVP requirements.

---

# 14. Power-Ups

Power-ups should be an optional second milestone.

Possible types:

## Speed Boost

```text
temporary movement speed +
```

## Shield

```text
one collision ignored
```

## Magnet

```text
nearby food attracted temporarily
```

## Freeze

```text
target player temporarily slowed
```

Do not implement all of these initially.

A single power-up is enough to demonstrate extensibility.

---

# 15. Persistence

Persist information that has meaning after a game ends.

Suggested tables:

## players

```text
id
display_name
created_at
```

## games

```text
id
room_id
started_at
finished_at
status
winner_id
```

## game_results

```text
id
game_id
player_id
score
rank
survival_time
```

## rooms

```text
id
status
created_at
```

Optional later:

## events

```text
id
game_id
player_id
event_type
payload
created_at
```

Do not persist every movement tick unless there is a specific product reason.

---

# 16. Leaderboard

The leaderboard gives persistence a visible product purpose.

Example:

```text
SNAKE ARENA — ALL TIME

1. Player A7F3    12,430
2. Player B82C     9,820
3. Player C19D     8,440
4. Player D71A     7,910
```

Possible additional views:

- Highest score
- Most games won
- Longest survival
- Most food collected

For the course project, one leaderboard is sufficient.

---

# 17. Frontend Page Structure

Suggested routes:

```text
/
├── Home / Landing
│
├── /play
│   └── Quick match / room selection
│
├── /room/[roomId]
│   └── Lobby + game
│
├── /leaderboard
│
└── /about
```

Do not create pages merely to increase page count.

---

# 18. Game UI

Suggested layout:

```text
┌──────────────────────────────────────────┐
│ SNAKE ARENA                Room: A7F3    │
├──────────────────────────────────────────┤
│                                          │
│              GAME CANVAS                 │
│                                          │
│        🟢🟢🟢                            │
│              🟢                          │
│                         ⭐               │
│                         🔴🔴             │
│                            🔴            │
│                                          │
├──────────────────────────────────────────┤
│ Score: 1240      Alive: 4      01:24     │
├──────────────────────────────────────────┤
│ Players                                  │
│ 🟢 A7F3    1240                          │
│ 🔴 B82C     980                          │
│ 🟡 C19D     840                          │
│ 🟣 D71A     710                          │
└──────────────────────────────────────────┘
```

---

# 19. Development Milestones

## Phase 0 — Project foundation

- Create repository
- Create frontend
- Create backend
- Configure TypeScript/Python
- Configure environment variables
- Add linting
- Add formatting
- Add basic test setup
- Add README
- Add CLAUDE.md
- Add spec/

Deliverable:

```text
Project starts locally.
```

---

## Phase 1 — Single-player game engine

Implement:

- Grid
- Snake
- Direction
- Movement
- Food
- Growth
- Score
- Collision
- Game over
- Restart

No WebSocket required yet.

Deliverable:

```text
A complete single-player Snake game.
```

---

## Phase 2 — Backend persistence

Implement:

- Database
- Player/session
- Games
- Results
- Leaderboard API

Deliverable:

```text
Game result survives refresh/restart.
```

---

## Phase 3 — C8

Make the application publicly usable.

Checklist:

- Core game works
- Backend works
- Persistence works
- Deployment works
- Basic UX works
- Stranger can understand the game
- README explains what "good" means

C8 should represent a coherent product, not a collection of unfinished features.

---

## Phase 4 — Multiplayer architecture

Implement:

- Room manager
- Player connections
- WebSocket server
- Join/leave events
- Authoritative game loop
- Server-side input validation

Deliverable:

```text
Two clients can connect to one room.
```

---

## Phase 5 — C9

Implement:

- Shared game state
- Realtime broadcast
- Player movement synchronization
- Shared food
- Shared collisions
- Game lifecycle synchronization
- Reconnection/disconnection handling

Test:

```text
Browser A
Browser B
Browser C
```

All should see the same game.

C9 success criterion:

> A meaningful action by one player becomes visible to the other players without page refresh.

---

## Phase 6 — Observability

Implement:

- Structured logs
- Connection logs
- Room lifecycle logs
- Game lifecycle logs
- Error logs
- Request latency
- WebSocket errors
- Basic counters

Deliverable:

```text
Developer can diagnose what happened in a game.
```

---

## Phase 7 — C10

Demonstrate:

```text
Player joins
     ↓
Room created
     ↓
Game starts
     ↓
Players move
     ↓
Food collected
     ↓
Collision occurs
     ↓
Player eliminated
     ↓
Game finishes
     ↓
Result persisted
```

Show corresponding logs/instrumentation.

---

# 20. Testing Strategy

## Unit tests

Test pure game logic.

Examples:

```text
movement()
collision()
growSnake()
spawnFood()
calculateScore()
```

Example:

```text
Given:
snake head = (5,5)
direction = RIGHT

When:
tick()

Then:
head = (6,5)
```

---

## Collision tests

Test:

```text
wall collision
self collision
snake-vs-snake collision
head-to-head collision
food collision
```

---

## Integration tests

Test:

```text
create room
join room
start game
send input
receive state
finish game
persist result
```

---

## Multiplayer tests

At minimum:

```text
Client A connects
Client B connects

A joins room

B joins room

A sends input

B receives updated state
```

---

## Persistence test

```text
finish game
↓
restart server
↓
query leaderboard
↓
result still exists
```

---

# 21. Security Considerations

Even though this is a small game, do not trust the client.

The server must validate:

- Player identity
- Room membership
- Direction changes
- Valid message types
- Message size
- Input frequency
- Game state transitions

Never accept:

```text
client says:
score = 999999
```

as authoritative.

The server calculates score.

For WebSockets, also consider validating the connection origin and rejecting invalid connections where appropriate. Browser WebSocket connections include an `Origin` header that servers can use as part of their security checks. See MDN's WebSocket server guidance.

---

# 22. Reconnection Strategy

A player may lose their connection.

MVP behaviour:

```text
disconnect
   ↓
mark player disconnected
   ↓
wait N seconds
   ↓
if reconnect:
    resume
else:
    remove/eliminate player
```

Do not attempt sophisticated distributed session recovery unless required.

---

# 23. Performance Considerations

The game server should maintain active game state in memory.

Avoid:

```text
every game tick
    ↓
database write
```

Prefer:

```text
game tick
    ↓
in-memory state
    ↓
WebSocket broadcast

game finished
    ↓
database write
```

Also avoid broadcasting unnecessary information.

For example, clients generally do not need:

```text
internal server logs
database IDs
private session metadata
```

Send only the state required to render the game.

---

# 24. Deployment

Target:

```text
Fly.io
```

Deployment checklist:

- Production environment variables
- Database configuration
- HTTP server
- WebSocket server
- Health endpoint
- Logging
- Secure WebSocket (`wss://`) in production
- Persistent database storage where required
- Graceful shutdown

For a browser page served over HTTPS, use a secure WebSocket connection (`wss://`) rather than an insecure mixed-content `ws://` connection. MDN documents the WebSocket URL and security considerations.

---

# 25. Suggested Repository Structure

One possible structure:

```text
snake-arena/
│
├── app/
│   ├── page.tsx
│   ├── play/
│   ├── room/
│   └── leaderboard/
│
├── components/
│   ├── GameCanvas.tsx
│   ├── Lobby.tsx
│   ├── Scoreboard.tsx
│   └── GameOver.tsx
│
├── game/
│   ├── types.ts
│   ├── movement.ts
│   ├── collision.ts
│   ├── food.ts
│   └── rules.ts
│
├── server/
│   ├── websocket/
│   ├── rooms/
│   ├── game/
│   ├── sessions/
│   └── logging/
│
├── db/
│   ├── schema/
│   ├── migrations/
│   └── client.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── multiplayer/
│
├── spec/
│   ├── game.md
│   ├── realtime.md
│   └── persistence.md
│
├── CLAUDE.md
├── PROCESS.md
├── README.md
└── package.json
```

The exact structure can change depending on the backend architecture.

---

# 26. What NOT to Build Initially

Avoid scope explosion.

Do NOT initially implement:

- Account registration
- Social login
- Friends system
- Chat
- Complex matchmaking
- Ranked seasons
- Tournament system
- Replay system
- Spectator mode
- Dozens of power-ups
- AI opponents
- Mobile app
- Payment system
- Complex anti-cheat
- Microservices

The MVP should remain:

```text
Join
 ↓
Play
 ↓
Compete
 ↓
Finish
 ↓
Persist result
```

---

# 27. Optional Extensions

After C8/C9/C10 are stable:

### Gameplay

- Power-ups
- Obstacles
- Multiple maps
- Speed zones
- Portals
- Temporary invulnerability

### Multiplayer

- Quick Match
- Private Rooms
- Room codes
- Spectator mode
- Team mode

### Persistence

- Player statistics
- Match history
- Leaderboards
- Personal best

### Presentation

- Sound effects
- Animations
- Particle effects
- Screen shake
- Custom themes

Only implement extensions that improve the actual game rather than simply increasing feature count.

---

# 28. Product Quality Definition

The project should define "good" in concrete terms.

A good Snake Arena should be:

### Responsive

Player input should feel immediate.

### Understandable

A new player should understand how to start and play without external explanation.

### Fair

The server should be authoritative and clients should not be able to arbitrarily modify score or position.

### Social

The presence of other players should materially affect gameplay.

### Reliable

Disconnects and invalid inputs should not destroy the entire room.

### Persistent

Finished games and meaningful scores should survive beyond the current session.

### Observable

The developer should be able to understand important system events.

---

# 29. Demo Plan

A strong final demonstration can be scripted.

## Part 1 — Enter

Open the deployed website.

```text
Player A → Create Room
Player B → Join Room
Player C → Join Room
```

## Part 2 — Play

All players start.

```text
A → food
B → food
C → power-up
```

## Part 3 — Realtime

Move Player A.

Show:

```text
A's screen
+
B's screen
+
C's screen
```

changing simultaneously.

## Part 4 — Collision

Player A collides.

All clients update.

## Part 5 — Persistence

Game ends.

Refresh leaderboard.

The result remains.

## Part 6 — Observability

Show server logs:

```text
room_created
player_joined
game_started
food_collected
collision_detected
player_eliminated
game_finished
```

This gives a very clear C8 → C9 → C10 narrative.

---

# 30. Development Order

The recommended order is:

```text
1. Game rules
       ↓
2. Single-player game
       ↓
3. Database + persistence
       ↓
4. Deployment
       ↓
5. C8
       ↓
6. WebSocket
       ↓
7. Room system
       ↓
8. Authoritative multiplayer
       ↓
9. C9
       ↓
10. Structured logging
       ↓
11. Metrics / instrumentation
       ↓
12. C10
       ↓
13. Polish
```

However, the codebase should be designed from the beginning with the final multiplayer architecture in mind.

Do not build a throwaway C8 application and rewrite it for C9.

---

# 31. Final MVP Definition

The minimum complete version of Snake Arena is:

```text
┌────────────────────────────────────────┐
│              SNAKE ARENA               │
│                                        │
│  Anonymous player identity             │
│  Room system                           │
│  Multiplayer game                     │
│  Shared arena                          │
│  Real-time movement                    │
│  Food                                  │
│  Snake growth                          │
│  Collision                             │
│  Score                                 │
│  Game over                             │
│  Persistent results                   │
│  Leaderboard                           │
│  Structured logs                       │
│  Fly.io deployment                     │
└────────────────────────────────────────┘
```

Everything beyond this is optional.

---

# 32. Key Architectural Principle

The most important design decision is:

> **The server owns the truth.**

The browser sends:

```text
"I want to move LEFT."
```

The server decides:

```text
"You are allowed to move LEFT."
```

The server updates:

```text
position
collision
food
score
alive/dead
```

Then broadcasts:

```text
"This is the new game state."
```

This architecture makes the project simultaneously:

- a real-time application,
- a multiplayer application,
- a game,
- a backend systems project,
- and an observability project.

It also gives C8, C9 and C10 a coherent technical progression rather than three disconnected requirements.

---

## 33. Reference Documentation

- MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- MDN WebSocket client applications: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications
- MDN WebSocket server guidance: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers

WebSockets provide the browser/server bidirectional communication mechanism needed for the realtime layer. MDN also documents the client/server lifecycle and security considerations. 
