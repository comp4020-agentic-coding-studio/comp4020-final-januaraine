# Crit 9

*Drafted alongside the implementation, grounded in the actual decisions, test
runs, and failures this session produced. Read it over and make it mine
before the cutoff — this is a starting point, not a finished account.*

<!-- TODO (you): the original version of this reflection below was written
when C9 shipped as one continuous shared arena. The brief then grew into
room-based multiplayer, which is a real redirection mid-milestone — if that
matched or clashed with how you'd planned to spend this week, or changed how
you felt about the earlier "no rooms" decision once you had to partially
walk it back, that's worth saying in your own words. I haven't invented a
reaction to it on your behalf. -->

**What was the breakthrough that moved the work forward?**

Not the networking (that was already settled by the earlier shared-arena
work) — it was noticing that "a room" isn't one setting, it's three
different questions wearing one checkbox each: can you *see* a room exists,
can you *watch* it, can you *become a Player* in it. The brief's own example
made `locked` sound like it should gate everything, but working through the
locked-room case explicitly — "a locked room must still admit Viewers when
its creator allows it" — only resolves cleanly if lock/viewer/capacity are
three independent checks, not one combined flag. Writing that out as
ADR-002's actual decision, rather than letting the first implementation that
compiled decide it implicitly, is what kept the lobby's preview
authorization, the role-selector's enable/disable logic, and the server's
join validation all agreeing with each other instead of drifting apart.

The second breakthrough was adversarial, and came from my own review before
any test ran: an early version of the "join a room" logic treated every join
as "leave wherever you are, then join the new place" — which is correct
for joining a *different* room, but wrong for a creator switching their own
role inside the room they created, because "leaving" a room you created is
exactly the trigger that closes it. The bug was real (the creator closing
their own room by clicking "Become Player" after "Become Viewer") and it
was never an observed test failure — it's the kind of thing that only shows
up once someone (or something) runs the exact sequence "creator becomes
viewer, then becomes player again," which none of my first-draft tests
happened to do. <!-- TODO (you): worth saying how it feels that a plausible,
passing-looking implementation had a correctness bug no test caught until a
second look — did that change how much you trust "the tests are green"? -->

**What did this work change about who I want to be as a software developer?**

<!-- TODO (you): crit 8 and crit 9's first pass both talked about treating
concurrency/design decisions as things to defend in writing, not assume.
This session's actual new material — the self-caught "creator closes their
own room" bug, and the lobby-preview authorization design in ADR-002 — is
about something adjacent: that "a feature works" and "a feature's access
rules all agree with each other" are different claims, and the second one
doesn't show up by eyeballing a happy-path demo. Write this one yourself;
it's the part of the reflection that's actually supposed to be about you,
not a summary of commits. -->
