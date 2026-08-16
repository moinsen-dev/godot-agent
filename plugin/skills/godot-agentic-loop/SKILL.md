---
name: godot-agentic-loop
description: >-
  How to actually verify a Godot change instead of guessing. Read this before
  claiming any Godot work is done, and whenever a change needs to be seen
  running: launching the game, screenshotting it, injecting input, reading
  script errors with res:// line numbers, and stepping frames deterministically.
  Covers the traps that silently waste a whole session — headless mode cannot
  screenshot, an occluded window stops drawing, Input.action_press() is invisible
  to _input().
---

# Verifying Godot work

The default failure mode with Godot is writing plausible GDScript, never running
it, and reporting success. This plugin exists to make that unnecessary. **Never
report a Godot change as done without a screenshot or a clean error log from the
running game.**

## The loop

```
edit  →  godot_check  →  godot_run  →  godot_screenshot  →  godot_logs  →  fix
         (parse gate)    (launch)      (look at it)         (read errors)
```

1. **`godot_check` first, always.** Headless import and parse of the whole
   project. Seconds, no window. Catches every syntax and type error before you
   waste a launch. If it is red, stop and fix — nothing downstream is meaningful.
2. **`godot_run`.** Launches the game detached; it stays alive across tool calls,
   so later calls talk to the *same* session. Call it again and it returns the
   existing session rather than starting a second one.
3. **`godot_screenshot`.** Returns a path. **Read that file** — a path you never
   look at proves nothing.
4. **`godot_logs`.** Errors come back folded into one entry each, with the
   `res://` file and line pulled out of the GDScript backtrace. `errors_only:
   true` when you just want the blockers.
5. Fix, then **`godot_run` again** — a stopped-and-restarted game picks up script
   changes. Godot has no hot reload for a running build; restart is the way.

## Traps that will cost you a session

**`headless: true` cannot produce screenshots.** `--headless` disables the
rendering driver entirely. It is for `godot_check`, `godot_run_script` and CI —
never for anything visual. If a screenshot comes back "empty frame", this is why.

**An occluded window stops drawing.** When the game window is behind other
windows, minimised or on another Space, macOS and Godot stop drawing while
`_process` keeps running at full speed — `fps` reads 145 while `frame` stays
frozen. The bridge detects this and forces a frame, so screenshots work anyway.
But if you ever see a frozen `frame` counter in `godot_status`, that is the
cause, not a hung game.

**`Input.action_press()` is invisible to `_input()`.** It only moves the polling
state, so code reading `event.is_action_pressed("jump")` never sees it. Use
`godot_input` with `kind: "action"` — it replays the real event from the
InputMap, which drives both the `_input()` path and `Input.is_action_pressed()`.
If an action does nothing, check first that it exists in the InputMap; the tool
tells you when it does not.

**A default action injection is a *tap*, not a hold.** `godot_input` with
`kind: "action"` presses and releases one frame apart. Any game with variable
jump height — `if event.is_action_released("jump"): velocity.y *= 0.45` — will
therefore produce its *shortest possible* jump, and every measurement you take
is of a mechanic the player never uses.

Measured on a real platformer with this plugin: tap reached **17.1 px**, hold
reached **96.1 px**. Same code, same frame, 5.6× apart. Pass `hold: true` and
release later when the input is meant to be held:

```
godot_input {kind: "action", action: "jump", hold: true}
… wait or step frames …
godot_input {kind: "action", action: "jump", pressed: false}
```

The same applies to holding a movement direction while testing anything about
momentum or acceleration.

**`await` in a `_ready()` you never reach.** If the scene tree looks wrong, get
the truth from `godot_tree` rather than from the `.tscn` file. What is in the
file and what is in the running tree are different questions.

## Deterministic verification

Sleeping and hoping is not verification. Use frames:

- `godot_pause {paused: true}` then `godot_step {frames: 30}` — advances exactly
  30 frames and re-pauses. Screenshot between steps to check an animation, a
  jump arc, or a state transition frame by frame.
- `godot_pause {time_scale: 0.2}` — slow motion, for watching fast action.
- `godot_eval {code: "velocity.length()", path: "/root/Main/Player"}` — read the
  actual number instead of inferring it from a picture.

## Let the game tell you what happened

Add `GodotAgent.report("died", {"cause": "spikes"})` at the interesting moments
in the game's own code — deaths, pickups, level loads, state changes. Then
`godot_events` drains a timestamped list with frame numbers.

This beats screenshots for anything logical. A screenshot tells you the health
bar looks short; `report()` tells you damage fired twice on one hit.

## What "done" means

- `godot_check` is clean.
- The game runs and `godot_logs --errors` is empty.
- A screenshot shows the intended change, and you looked at it.
- The behaviour was exercised — input injected, state read back, or an event
  reported — not just rendered.
