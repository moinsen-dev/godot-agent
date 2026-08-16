---
name: game-feel
description: >-
  Game feel — whether the avatar obeys the player. Read this when movement feels
  floaty, stiff, laggy or unfair, when tuning jumps, acceleration, input
  handling or camera follow, or before any polish pass. Covers input forgiveness,
  movement curves, response latency, animation that blocks input, and camera
  follow. For the feedback layer on top — hitstop, shake, particles — read
  `game-juice` instead, and read it second.
---

# Game feel

Steve Swink's definition: *the tactile, kinesthetic sense of manipulating a
virtual object* — real-time control of a virtual body in a simulated space.

Feel is about **control**, and unlike juice it **does change the rules**. It is
also strictly first: a game with bad feel and good juice is a noisy game with
bad feel. Fix this layer before adding any feedback effects.

The order of impact within feel: **input forgiveness → response latency →
movement curves → camera follow.**

## 1. Input forgiveness

Players are imprecise and blame the game. Both of these are nearly free and both
are the difference between "unfair" and "tight" without changing a single
visible number.

**Coyote time** — still jumpable for a moment after leaving a ledge:

```gdscript
const COYOTE_TIME := 0.1        # ~6 frames at 60fps; 0.08–0.15 all feel fine
var _coyote := 0.0

func _physics_process(delta: float) -> void:
	if is_on_floor():
		_coyote = COYOTE_TIME
	else:
		_coyote -= delta
```

**Jump buffering** — a jump pressed just before landing still fires:

```gdscript
const JUMP_BUFFER := 0.1
var _buffered := 0.0

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("jump"):
		_buffered = JUMP_BUFFER

func _physics_process(delta: float) -> void:
	_buffered -= delta
	if _buffered > 0.0 and _coyote > 0.0:
		velocity.y = JUMP_VELOCITY
		_buffered = 0.0
		_coyote = 0.0
```

The same pattern generalises: buffer the next attack during the current one,
buffer a dash during recovery. Anywhere the player can press a button "too
early", buffer it.

## 2. Response latency

**Something must happen within ~100 ms of the input**, even if the real action
takes longer. A wind-up animation is fine; a wind-up during which nothing on
screen changes is not.

- Start the response on the *press*, not on the release, and not after a
  validation step.
- Read input events in `_input`/`_unhandled_input`; poll continuous input
  (`Input.get_axis`) in `_physics_process`. Movement belongs in
  `_physics_process`, never in `_process`.
- Watch out for anything that defers action by a frame — `call_deferred`,
  awaiting a signal, a state machine that transitions next tick. Individually
  invisible, they stack.

**Animation must not own control.** The most common stiffness bug is an
animation that blocks input until it finishes. Animations should be
interruptible ("cancellable") except where the design deliberately commits the
player to a recovery window — and that window should be short and readable.

## 3. Movement curves

**Asymmetric gravity.** Real gravity feels floaty. Fall faster than you rise — a
factor of roughly 1.5–2.5:

```gdscript
@export var jump_gravity: float = 980.0
@export var fall_gravity: float = 1800.0

func _physics_process(delta: float) -> void:
	var g := jump_gravity if velocity.y < 0.0 else fall_gravity
	velocity.y += g * delta
	velocity.y = minf(velocity.y, 900.0)   # terminal velocity, or long falls
	                                       # become uncontrollable
```

**Variable jump height** — releasing early cuts the rise:

```gdscript
if event.is_action_released("jump") and velocity.y < 0.0:
	velocity.y *= 0.45
```

**Acceleration, not teleportation.** Instant full speed feels robotic; too much
acceleration feels like ice. Accelerate fast, decelerate faster:

```gdscript
const ACCEL := 1800.0
const FRICTION := 2400.0

var target := dir * MAX_SPEED
var rate := ACCEL if dir != 0.0 else FRICTION
velocity.x = move_toward(velocity.x, target, rate * delta)
```

**Air control** is a separate number from ground control, always. Usually 60–80%
of ground acceleration — enough to correct a jump, not enough to make jumps
trivial.

## 4. Camera follow

The camera is part of control: it determines what the player can react to.

**Framerate-independent smoothing.** A raw `lerp(a, b, 0.1)` per frame is
framerate-dependent and will feel different on a 60 Hz and a 144 Hz display:

```gdscript
position = position.lerp(target, 1.0 - exp(-6.0 * delta))
```

Use `1.0 - exp(-k * delta)` everywhere you smooth anything.

**Lookahead** — offset toward where the player is heading. This buys reaction
time and reads as intent:

```gdscript
var lead := Vector2(player.velocity.x * 0.25, 0.0)
position = position.lerp(player.position + lead, 1.0 - exp(-6.0 * delta))
```

Also: a **deadzone** so small movements do not move the camera, and `limit_*` on
`Camera2D` so it never shows outside the level.

Camera *shake* and *kick* are juice, not feel — see `game-juice`.

## Measuring feel with this plugin

Feel is timing, so opinions are weak evidence and screenshots alone prove
nothing. Measure:

1. `godot_pause {paused: true}` then `godot_step {frames: 1}` repeatedly, reading
   `godot_eval {code: "velocity", path: "..."}` after each step — this recovers
   the actual jump arc and acceleration ramp instead of an impression of it.
2. Count the frames between the input and the first visible change. More than
   ~6 frames at 60 fps and the game feels laggy.
3. `godot_pause {time_scale: 0.15}` to watch a transition slowly.
4. `godot_input` with `kind: "action"` to drive the real verb repeatedly —
   feel is about repetition, so exercise it more than once.

Then compare against the numbers above and change one constant at a time.
