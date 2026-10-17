# Crit 10

## What I built

I added lightweight observability to Snake Arena so that a developer can understand what the running multiplayer system is doing without attaching a debugger. The implementation uses structured JSON logs for meaningful server-side events and an in-memory metrics counter exposed through `GET /api/metrics`. It instruments the existing room lifecycle, player connections, food collection, eliminations, game-result persistence, and relevant errors. The goal was to make the system diagnosable without introducing a separate monitoring platform, database-backed log store, or per-tick logging.

## The moments that mattered

### Moment 1: Adapting observability to the actual architecture

1. **What happened:** The technical design documentation described generic multiplayer concepts such as WebSocket errors and matches. However, the implemented application uses Server-Sent Events (SSE) and a room-based lifecycle, where rooms continue running while players remain and do not have a conventional match winner.

2. **What I did instead of the obvious thing:** Rather than copying the suggested event names literally or changing the communication architecture to match the documentation, I used names that reflect the actual implementation, such as `sse_error` and room-oriented events. I added structured logging at meaningful state transitions instead of logging every game tick. To identify who collected food, I extended the existing arena tick result with the player attribution already calculated by the game logic, without changing its movement or collision rules.

3. **How I knew it was right:** The event names and metrics correspond to real server-side behaviour, and the approach preserves the existing architecture. Type checking passed, all 91 unit tests passed, and `pnpm check` passed with the integration tests. A manual HTTP-driven game flow also produced the expected logs and metric changes. A real two-browser walkthrough against the deployed application remains a separate verification step.

4. **The citation:** [db852db](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/db852db)

### Moment 2: Correcting documentation against the current implementation

1. **What happened:** While reviewing the API documentation, I found references to retired single-arena endpoints and modules that no longer existed after the application moved to room-based multiplayer.

2. **What I did instead of the obvious thing:** Instead of leaving the stale references in place or changing working application code to match outdated documentation, I checked the README against the actual routes and source files, then corrected the documentation to describe the current implementation.

3. **How I knew it was right:** The corrected API paths and module references match the repository's current structure. The changes were confined to documentation and did not alter the working application.

4. **The citation:** [2dcb721](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/2dcb721)

### Moment 3: Preventing automated tests from polluting production

1. **What happened:** During the final preflight checks, I ran the integration test suite against the deployed Fly.io application by setting `APP_URL` to the production URL. The tests created multiple rooms with names such as `Metrics Room`, `Last Slot`, and `Grace Keeps Player`. Some rooms remained visible in the live lobby after the tests finished.

2. **What I did instead of the obvious thing:** Rather than manually deleting the rooms or changing the production room lifecycle to hide the symptoms, I traced the room names and embedded timestamps back to the test helpers and correlated them with Fly.io logs. I found that some tests created and joined rooms through HTTP requests without opening an SSE connection or explicitly calling the leave endpoint. Consequently, neither of the existing room-cleanup paths was triggered. This showed that the immediate issue was not simply stale UI state, but that the test suite could mutate production data without a sufficient safety guard.

3. **How I knew it was right:** The room names matched the automated test cases, their timestamps aligned with the preflight run, and the corresponding room creation and player-join events appeared in the Fly.io logs. The investigation also confirmed that runtime room state is held in memory while room metadata is stored in SQLite, with room records cleared during application startup. I chose to address the unsafe test configuration rather than introduce unnecessary production cleanup logic. A production-URL safety guard is the proposed follow-up; it should only be described as implemented after the code change and its tests are complete.

4. **The citation:** [e210e7b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/e210e7b)