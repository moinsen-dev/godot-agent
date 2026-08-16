---
name: godot-gdscript
description: >-
  Godot 4 GDScript idioms and the Godot 3 habits that still leak into generated
  code. Read this before writing or editing any .gd file. Covers signals, await,
  tweens, exports, typed GDScript, physics bodies, the renamed APIs that fail at
  parse time, and how to check a version-sensitive API instead of guessing.
---

# Writing GDScript that actually parses

Most Godot code that fails on first run fails because Godot 3 syntax slipped in.
The 3.x corpus is far larger than the 4.x one, so this is the default drift.
`godot_check` catches all of it in seconds — **run it after every edit**, and
treat everything below as the list of things to not get wrong in the first place.

## Godot 3 habits that break Godot 4

| Godot 3 | Godot 4 |
|---|---|
| `export var speed = 100` | `@export var speed: float = 100.0` |
| `onready var s = $Sprite` | `@onready var s: Sprite2D = $Sprite2D` |
| `tool` | `@tool` |
| `yield(get_tree(), "idle_frame")` | `await get_tree().process_frame` |
| `connect("died", self, "_on_died")` | `died.connect(_on_died)` |
| `emit_signal("died", cause)` | `died.emit(cause)` |
| `scene.instance()` | `scene.instantiate()` |
| `KinematicBody2D` + `move_and_slide(vel)` | `CharacterBody2D`, set `velocity`, call `move_and_slide()` |
| `PoolVector2Array` | `PackedVector2Array` |
| `OS.get_ticks_msec()` | `Time.get_ticks_msec()` |
| `$Tween` node | `create_tween()` |
| `setget set_x, get_x` | `var x: int: set(v): …, get: …` |
| `Directory` / `File` | `DirAccess` / `FileAccess` |
| `rand_range(a, b)` | `randf_range(a, b)` / `randi_range(a, b)` |
| `TileMap` cell API | `TileMapLayer` (one node per layer, since 4.3) |

## Signals

Declare with typed parameters, connect with the Callable, emit on the signal:

```gdscript
signal health_changed(current: int, maximum: int)

func _ready() -> void:
	health_changed.connect(_on_health_changed)
	# one-shot, and auto-disconnects when the target dies:
	died.connect(_on_died, CONNECT_ONE_SHOT)

func take_damage(amount: int) -> void:
	health -= amount
	health_changed.emit(health, max_health)
```

Lambdas work and are the right tool for tiny local reactions:

```gdscript
button.pressed.connect(func(): visible = false)
```

## await

`await` suspends until a signal fires. Any function containing it becomes a
coroutine; callers that need its value must `await` it too.

```gdscript
await get_tree().create_timer(0.5).timeout
await tween.finished
await get_tree().process_frame          # one idle frame
await RenderingServer.frame_post_draw   # after the frame is drawn
```

Do not `await` a timer inside `_process` — you will stack a coroutine per frame.

## Tweens

Tweens are created from code and die with the scene. There is no Tween node.

```gdscript
var tw := create_tween()
tw.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
tw.tween_property(self, "position", target, 0.3)
tw.parallel().tween_property(self, "modulate:a", 0.0, 0.3)
await tw.finished
```

Keep a reference and `kill()` it before starting a replacement, or two tweens
will fight over the same property:

```gdscript
if _tw and _tw.is_running():
	_tw.kill()
_tw = create_tween()
```

## Typed GDScript

Type everything. It is faster at runtime and turns whole classes of mistake into
parse errors that `godot_check` catches before you launch.

```gdscript
class_name Player
extends CharacterBody2D

const MAX_SPEED: float = 220.0

@export var jump_velocity: float = -400.0
@export_range(0.0, 1.0) var friction: float = 0.15
@export var bullet_scene: PackedScene

@onready var sprite: AnimatedSprite2D = $AnimatedSprite2D

var _coins: Array[int] = []          # typed arrays are enforced
```

`:=` infers; use it when the right-hand side already says the type.

## Physics bodies

`CharacterBody2D` / `CharacterBody3D` use the `velocity` property and take no
argument:

```gdscript
func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta
	var dir := Input.get_axis("move_left", "move_right")
	velocity.x = dir * MAX_SPEED
	move_and_slide()
```

Movement belongs in `_physics_process`, not `_process`. Input *polling*
(`Input.get_axis`, `Input.is_action_pressed`) belongs there too; input *events*
(`event.is_action_pressed`) belong in `_input`/`_unhandled_input`.

## Node references

```gdscript
@onready var hud: Control = $UI/HUD      # path from this node
@onready var hp: ProgressBar = %HealthBar # unique name, survives reparenting
```

Prefer `%UniqueName` (right-click a node → Access as Unique Name) over long `$`
paths — those break every time the tree is rearranged. Never reach upward with
`get_parent().get_parent()`; emit a signal instead.

## Freeing things

`queue_free()` for nodes, always — `free()` mid-frame corrupts the tree. Check
`is_instance_valid(node)` before touching a reference you have held across
frames.

## Silent failures worth knowing

These produce no error, no warning and no log line — the only way to catch them
is to measure the result.

**`AudioStreamWAV.loop_end` counts frames, and 0 means a zero-length loop.**
Setting `loop_mode = LOOP_FORWARD` and leaving `loop_end` at its default gives a
loop region of nothing: playback ends instantly, `playing` reads `false`, and a
`finished`-handler that restarts it spins forever. Set it explicitly:

```gdscript
w.loop_end = int(w.get_length() * w.mix_rate)
```

`AudioStreamMP3` and `AudioStreamOggVorbis` use a plain `loop = true` instead.

**`set_script(null)` succeeds.** `load()` returns null on a parse error, so a
builder that does not check produces a scene with no script attached — and
`godot_check` then passes, because nothing references the broken script any
more. See `godot-scene-authoring`.

**Verify audio from the outside** rather than trusting that `play()` was called:

```gdscript
AudioServer.get_bus_peak_volume_left_db(AudioServer.get_bus_index("SFX"), 0)
```

Read it through `godot_eval` before and after triggering a sound. Silence sits
around −200 dB, so the difference is unambiguous.

## When you are unsure about an API

Do not guess a method name from memory. Any of these is cheaper than a wrong
guess:

- `godot_check_script` — parse one file, get the exact error.
- `godot_eval` against the running game — `Engine`, `Input`, `InputMap`, `Time`,
  `OS` and `ProjectSettings` are in scope.
- `godot_get` with no `prop` — dumps every editor-visible property of a live
  node, which settles "what is this property called" instantly.
