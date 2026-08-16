---
description: Add juice one layer at a time, verifying each layer in the running game before the next
argument-hint: "[the moment to juice, e.g. getting hit / firing / landing]"
---

Run a juice pass on the running Godot game. Target moment: **$ARGUMENTS** (if
empty, pick the single most-repeated moment in the game and say which one you
chose and why).

Load the `game-juice` skill first.

## Check the foundation before adding anything

Juice amplifies whatever is underneath, including bad control. Spend the first
few minutes on feel:

- `godot_run`, then drive the verb repeatedly with `godot_input`.
- Count the frames between input and first visible change (`godot_pause
  {paused: true}` + `godot_step {frames: 1}` + screenshot).
- Check for input forgiveness in the source — coyote time, buffering.

If control is unresponsive or unforgiving, **stop and say so.** Load `game-feel`
and fix that first. Report this plainly rather than juicing over it — juice on
bad feel makes the game worse, not better.

## Baseline

Frame-step through the target moment and **count how many frames of feedback
exist today**. Screenshot each step. Often the honest answer is zero. Write the
number down; it is what you will compare against.

## Then layer, one at a time

Work down the impact order from the skill: hitstop → impact effect → hit
animation → knockback → screenshake → camera kick → permanence → surface polish
→ audio.

For **each** layer, all of it, before moving on:

1. Implement exactly one layer.
2. `godot_check`, then restart with `godot_run`.
3. Frame-step through the moment with a screenshot per frame. **Count the frames
   the effect is actually visible.** One frame at 144 fps does not exist for the
   player — if that is what you built, fix the duration before continuing.
4. Watch it once at `godot_pause {time_scale: 0.15}`.
5. Decide: keep, tune, or revert. **Reverting is a normal outcome** — say when
   you did it and why.

Do not batch several layers and check at the end. Knowing *which* layer helped
is the entire point of the method.

After every third layer, watch the whole sequence in slow motion and ask whether
it is still **legible** — can you still tell what happened, whether the hit
landed, where things went? If not, remove the layer that obscured it. Legibility
beats spectacle every time.

## Build in the escape hatch from the start

Route every shake through one global strength multiplier and every screen flash
through one toggle, wired to a reduce-motion setting. Screenshake and flashing
cause motion sickness and can trigger photosensitive reactions; retrofitting this
later means touching every effect. Do it in the first layer that needs it.

## Report

- The baseline frame count versus the final one.
- Each layer: what you added, the numbers you chose, how many frames it is
  visible, and whether you kept it.
- Which layers you reverted and why.
- Whether legibility held.
- The next two layers you would add.

Attach the before and after screenshots you actually looked at. Be specific —
"hitstop 0.08 s, 5 frames of white flash, trauma 0.4" beats "added impact".
