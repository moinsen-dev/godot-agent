---
name: game-design
description: >-
  Designing what the game actually is, before and while building it — core loop,
  the verb, difficulty and pacing, progression and economy, session shape, and
  how to tell whether a design is working. Read this when starting a new game,
  when a game "has features but is not fun", when balancing difficulty or
  rewards, or when deciding what to build next.
---

# Designing the game

A Godot project can be technically flawless and still not be a game. These are
the decisions that determine whether it is.

## Start with the verb

Every game that works has one verb the player does constantly and enjoys doing
in a vacuum. Mario jumps. Tetris places. Hades dashes. Vampire Survivors moves.

Name yours in one word before building anything else, then answer:

- Is it fun with **no** score, enemies, levels or progression? Ten seconds in an
  empty room should already be pleasant. If it is not, no amount of content
  fixes it — the verb needs work.
- What makes it *interesting* rather than automatic? A verb needs a decision or a
  skill inside it. Walking is a verb; nobody plays walking.
- What does the player get **better at**? If skill does not change outcomes, the
  game is a slot machine.

Build the verb first, alone, and use `godot_run` plus real input to feel it
before adding anything. This is the cheapest possible course correction.

## The core loop

The core loop is the smallest repeating unit that the player wants to repeat:

```
act → get feedback → gain something → face a slightly different situation → act
```

Write yours as one sentence. "Dodge into a crowd, kill it, pick a weapon upgrade,
face a denser crowd." If it cannot be written in one sentence, it is not a loop
yet.

Then check the timings, because loop length determines what the game *is*:

| Loop | Length | Job |
|---|---|---|
| Moment | 0.1–2 s | Does the verb feel good? |
| Encounter | 10–60 s | Is there a decision to make? |
| Session | 5–40 min | Is there an arc — a start, a peak, an end? |
| Meta | days | Is there a reason to come back? |

Most failing prototypes have the moment loop and nothing above it. Most bloated
projects have a meta loop bolted onto a moment loop nobody enjoys.

## Difficulty and pacing

**Teach, test, twist.** Introduce a mechanic safely, ask the player to use it
under pressure, then combine it with something else. Every good level does this.
Do not introduce two mechanics at once.

**A difficulty curve is a sawtooth, not a ramp.** Rising tension, then release.
Constant pressure exhausts; constant ease bores. Every peak should be followed by
a moment to breathe — a safe room, a shop, an easy wave.

**Fail fast, retry faster.** Death-to-playing again should be under two seconds
for anything skill-based. Long retry loops make players quit at exactly the
difficulty they would otherwise have pushed through. This is a technical
requirement of the design: measure it.

**Difficulty should come from the situation, not the numbers.** Doubling enemy
health makes fights longer, not harder. More enemies, new positions, less room,
tighter timing — those make fights harder.

## Progression and economy

- **Power should change how you play, not how big your numbers are.** "+10%
  damage" is not a reward; "your dash now damages enemies" is.
- **Give choices, not gifts.** Picking one of three upgrades creates a build and
  a story. Receiving one upgrade creates nothing.
- **Rewards need a sink.** Currency with nothing meaningful to buy stops being a
  reward within minutes.
- **Front-load generously.** Early rewards should come fast and shrink over time.
  Players decide whether to keep playing long before your balance curve matures.
- **Randomness before the decision, not after.** Random *options* to choose from
  is interesting; a random *outcome* of a correct choice is infuriating.

## Session shape

Decide deliberately how long one sitting is and design for it. A 20-minute
roguelike run and a 3-minute arcade round are different games even with the same
verb. Then make sure the game *ends* — a clear win, loss or stopping point.
Games without an ending have no satisfaction to offer.

## Judging your own design honestly

Watch what a playtest does, not what it says. The useful signals:

- **Where do they stop?** The place people quit is the design problem, whatever
  they say the problem is.
- **What do they do in the first 30 seconds?** If they are confused, the opening
  is wrong. Nobody reads instructions.
- **Do they retry immediately after dying?** Immediate retry means the loss felt
  fair and the loop is working. Hesitation means it did not.
- **Can they explain what they were trying to do?** If not, the goal is not
  legible.

"It needs more content" is almost always wrong. If the loop works, a little
content goes far; if it does not, no amount is enough.

## Working incrementally in Godot

1. **Verb alone.** One scene, one mechanic, no art. Run it, play it with real
   input, decide whether it is pleasant. Discard freely at this stage.
2. **One encounter.** Add the single obstacle that makes the verb a decision.
3. **A session.** Sequence encounters into an arc with a beginning and an end.
4. **Then** systems — progression, meta, menus, saves.

Do not build step 4 before step 1 is enjoyable. That is the most expensive
mistake available, and it is the one most projects make.

## Where this plugin helps

- `godot_run` + `godot_input` — actually play the thing rather than reasoning
  about it. Reasoning about fun does not work.
- `GodotAgent.report()` + `godot_events` — instrument the design questions:
  time-to-first-death, retries, which upgrade was picked, where runs end. Design
  arguments end quickly once there are numbers.
- `godot_pause {time_scale: …}` — inspect a fight at 0.2× to see whether the
  player was actually given time to react.
