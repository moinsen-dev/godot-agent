---
description: Measure and fix how the game controls — responsiveness, input forgiveness, movement curves, camera
argument-hint: "[what to focus on, e.g. jumping / combat]"
---

Audit how the running Godot game *controls* and fix what is weakest.
Focus: **$ARGUMENTS** (if empty, start with whatever the player does most).

Load the `game-feel` skill first.

This command is about **control** — whether the avatar obeys the player. The
feedback layer on top (hitstop, shake, particles, flashes) is a separate pass:
that is `/godot:juice`, and it comes second. If you find yourself wanting to add
effects here, note it for the juice pass and stay on control.

**Measure before changing anything.** Opinions about feel are weak evidence:

1. `godot_run`, then perform the game's main verb repeatedly with `godot_input`.
2. `godot_pause {paused: true}` + `godot_step {frames: 1}`, reading
   `godot_eval {code: "velocity", path: "..."}` after each step. This recovers
   the real jump arc and acceleration ramp instead of an impression.
3. Count the frames between input and the first visible change. More than ~6 at
   60 fps reads as laggy.
4. Read the movement scripts and name the constants behind what you measured.

Then work down the checklist in impact order:

- **Input forgiveness** — coyote time, jump/action buffering. Measured values, or
  absent.
- **Response latency** — does something happen within ~100 ms of the press? Does
  any animation block input that should not?
- **Movement curves** — asymmetric gravity, variable jump height, acceleration
  and friction, terminal velocity, separate air control.
- **Camera follow** — framerate-independent smoothing (`1 - exp(-k*delta)`, not a
  raw per-frame `lerp`), lookahead, deadzone, level limits.

Implement the two or three highest-impact fixes, changing **one constant at a
time**, and re-measure each the same way you measured it originally.

Report: what you measured (with numbers), what you changed and to what value,
and what you would do next. "Added 0.1 s coyote time and 0.1 s jump buffer;
fall gravity 980 → 1800" — not "improved the jump".
