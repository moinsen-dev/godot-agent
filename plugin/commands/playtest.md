---
description: Play the running game like a player would and report what actually happens
argument-hint: "[what to focus on]"
---

Playtest the running Godot game. Focus: **$ARGUMENTS** (if empty, play it the
way a new player would and see how far you get).

Use the `godot-playtester` agent for this, or do it yourself if the game is
small. Load the `game-design` skill for what to look for.

Play it — do not read the source and reason about it. Launch with `godot_run`,
drive it with `godot_input`, look with `godot_screenshot`, read state with
`godot_eval`, and drain `godot_events` for what the game says about itself.

Report as observations, not as a review:

- **The first 30 seconds.** What is on screen, what is obviously actionable,
  what you tried, whether it worked. This is the most valuable part of the
  report — say what was confusing before you learned the game.
- **The verb.** Does the main action feel worth repeating on its own?
- **Where it stops.** The point at which you got stuck, bored, or could not tell
  what to do. Be precise about where and why.
- **Errors.** Everything from `godot_logs`, with `res://` file and line.
- **Broken or dead ends.** Anything reachable that does nothing, or unreachable
  that should not be.

Separate **what happened** from **what you think about it**, and mark the second
part clearly as opinion. Include screenshots you actually looked at as evidence
for the concrete claims. Do not fix anything unless asked — the report is the
deliverable.
