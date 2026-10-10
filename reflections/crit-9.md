# Crit 9

*Drafted alongside the implementation, grounded in the actual decisions, test
runs, and failures this session produced. Read it over and make it mine
before the cutoff — this is a starting point, not a finished account.*

**What was the breakthrough that moved the work forward?**

The breakthrough wasn't the networking code — it was realising "real-time"
is a decision with trade-offs, not a feature to switch on. My own earlier
design doc had already settled on WebSockets, and I almost just implemented
that. Checking it against this exact stack first (the Astro node adapter's
standalone mode doesn't expose a raw server for a WebSocket upgrade without
ejecting it) and against what's actually happening on Fly.io right now (a
live community report of WebSocket-upgrade requests failing at the edge)
turned "use WebSockets because the plan says so" into an actual choice, with
a reason I could write down instead of assume. The same thing happened again
designing the arena itself: the brief's example sketched rooms with a
winner, but writing out what a room *costs* — a second state machine, a
start condition, a reset flow — against what this README already says "good"
means for this game made "one shared arena, no matches" the better-fitting
answer, not just the simpler one. And then testing it exposed a bug: my
first integration tests were flaky because a disconnected player's snake,
left in an arena other people were still watching, could run into a wall
before my own test assertions checked anything. That forced the disconnect
rule itself to become more precise than "wait, then remove."

**What did this work change about who I want to be as a software developer?**

It sharpened something crit 8 already started: I want to be someone who
treats a concurrency rule as something to design and defend, not something
that falls out of whichever library gets imported first. The parts of this
week that actually mattered — one arena instead of rooms, a grace window
sized against a browser's own retry behaviour, a transport picked against a
real, current operational risk rather than a diagram — were decisions I had
to be able to say "because of X" about, in writing, in a repo someone else
will read. That's a different habit than "make it work," and it's the one
I want to keep.
