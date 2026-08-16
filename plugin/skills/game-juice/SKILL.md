---
name: game-juice
description: >-
  Juice — the layer of sensory feedback that makes a game feel alive without
  changing its rules. Read this when a game works but feels flat or dead, when
  adding impact to hits, shooting, pickups, UI or transitions, when doing a
  polish pass, or whenever "juice", "juicy", "screenshake" or "game feel" comes
  up. Holds the canonical technique list, Godot 4 implementations, the
  layer-and-evaluate method, and when juice becomes harmful.
---

# Juice

> Juice is the accumulated layer of sensory feedback that makes interactions
> feel satisfying and alive — **without changing the underlying rules**.

The canonical references are Martin Jonasson & Petri Purho's *Juice it or lose
it* (GDC 2012), which takes a block-breaker and adds one layer at a time, and
Jan Willem Nijman's *The Art of Screenshake* (INDIGO 2013), which turns a
deliberately bad platform shooter into a good-feeling one in ~30 named steps.

## Juice is not game feel

They get used interchangeably and it costs people a lot of wasted effort.

| | Game feel | Juice |
|---|---|---|
| Question | "Does the avatar obey me?" | "Does the world react to me?" |
| Concerns | control, responsiveness, movement curves, input forgiveness | feedback about events |
| Changes rules? | **Yes** — it alters behaviour | **No** — remove it all and the game still plays identically |
| Fix order | **first** | second |

**Juice cannot rescue bad feel.** Adding screenshake to unresponsive controls
produces a game that is unresponsive *and* noisy. If the verb does not feel good
in an empty room, close this skill and open `game-feel` instead.

The core principle: **maximum output for minimum input.** One button press should
produce several simultaneous responses. A single hit is legitimately a freeze, a
flash, a knockback, a shake, a particle burst, a sound and a number — all at
once, all within 150 ms.

## The method — this is the actual technique

The talks are famous for their *process*, not their effect list: add **one layer
at a time and evaluate after each**. Do not implement twelve effects and then
look. You will not know which ones helped, and some will be fighting each other.

1. Pick the single most-repeated moment in the game (the hit, the jump, the
   pickup).
2. Add **one** layer.
3. Verify it — frame-step it, look at it, count the frames it is visible.
4. Keep it, tune it, or throw it away. Throwing it away is a normal outcome.
5. Next layer.

This plugin makes step 3 possible, which is the step everyone skips:

```
godot_pause {paused: true}
godot_step {frames: 1}   +  godot_screenshot   ← repeat, count the frames
godot_pause {time_scale: 0.15}                 ← watch the whole sequence slowly
godot_eval  {code: "velocity", path: "..."}    ← read the real numbers
```

**A one-frame effect at 144 fps does not exist for the player.** This is the most
common juice bug and it is invisible without frame stepping — the code is
correct, the effect renders, and nobody ever sees it.

### What measuring actually catches

A real example, measured with this plugin. A perfectly ordinary flash:

```gdscript
$Box.color = Color(8.0, 8.0, 8.0)                                   # blow out
create_tween().tween_property($Box, "color", Color(0.2, 0.6, 1.0), 0.1)
```

Reading the colour once per frame gives:

```
frame +0 … +8   r = 8.0 → 1.96     every one of these renders as pure white
frame +9        r = 0.84           first frame that is actually a colour
frame +10       r = 0.2            done
```

The code looks right and the duration looks right. What the player actually sees
is **nine frames of flat white ending in a hard cut** — not a fade, because
everything above 1.0 clips to the same white. Seven eighths of the tween is
spent in a range where nothing visibly changes.

The fix is to spend the tween inside the *visible* range: a short overbright
spike (1–3 frames), then a separate tween from 1.0 down to the base colour. But
the point is that no amount of reading the code tells you this, and neither does
watching it at full speed. You have to count the frames.

## The layer list

Adapted from Nijman's ordering, which is roughly by impact per unit of effort.

### Impact — do these first
| Layer | What it is | Godot |
|---|---|---|
| **Sleep / hitstop** | freeze everything for a few frames on impact | `Engine.time_scale` + a timer that ignores it |
| **Impact effect** | something visible spawns at the contact point | one-shot `GPUParticles2D` |
| **Hit animation** | the struck thing visibly reacts | flash via `modulate`, or a shader param |
| **Knockback** | both the struck *and* the striker move | add to `velocity` |
| **Screenshake** | trauma-based, squared falloff | `Camera2D.offset` + noise |
| **Camera kick** | directional push *opposite* the action | offset toward the recoil |

### Weapon and action feel
| Layer | Note |
|---|---|
| **Muzzle flash** | one or two frames, oversized |
| **Bigger, faster bullets** | Nijman's first real jump in quality — visibility beats realism |
| **Less accuracy** | random spread reads as power, not sloppiness |
| **Gun delay / kickback** | the weapon animates before and after firing |
| **Shell casings** | physical debris that outlives the shot |

### Permanence — the underrated one
Things that stay: corpses, shells, scorch marks, smoke, blood, cracks. Nijman
calls this out specifically — *leave, come back, and the evidence is still
there*. It makes the world feel affected by the player rather than reset.

In Godot: do not `queue_free()` corpses immediately, or blit them into a
persistent `SubViewport`/`Sprite2D` layer so thousands cost nothing.

### Surface polish
Squash and stretch · tweened/eased everything · trails (`Line2D`) · colour
shifts · number popups · counters that count up instead of snapping · UI that
scales on hover · screen flash · chromatic aberration or vignette on damage ·
objects that react to the music.

### Audio
Pitch-randomise every repeated sound (`randf_range(0.9, 1.1)`) — identical
repeats are the single fastest way to sound cheap. Layer a transient plus a body
for impacts. Nijman's "more bass" is a real note: low end is most of perceived
weight.

## Godot 4 implementations

**Hitstop.** The timer must be told to ignore `time_scale`, or it freezes along
with everything else and never fires:

```gdscript
func hitstop(duration: float = 0.08) -> void:
	Engine.time_scale = 0.02
	# create_timer(sec, process_always, process_in_physics, ignore_time_scale)
	await get_tree().create_timer(duration, true, false, true).timeout
	Engine.time_scale = 1.0
```

Light hit ≈ 0.05 s · heavy ≈ 0.12 s · kill ≈ 0.2 s. Longer reads as a bug.

**Trauma-based shake.** Square the trauma so small hits stay subtle, and drive it
with noise — random per-frame offsets look like a rendering fault:

```gdscript
extends Camera2D

@export var decay: float = 1.6
@export var max_offset := Vector2(24.0, 16.0)
@export var strength: float = 1.0     # global scale — see accessibility below

var _trauma := 0.0
var _t := 0.0
var _noise := FastNoiseLite.new()

func add_trauma(amount: float) -> void:
	_trauma = minf(_trauma + amount, 1.0)

func _process(delta: float) -> void:
	_t += delta
	_trauma = maxf(_trauma - decay * delta, 0.0)
	var s := _trauma * _trauma * strength
	offset = Vector2(
		max_offset.x * s * _noise.get_noise_2d(_t * 900.0, 0.0),
		max_offset.y * s * _noise.get_noise_2d(0.0, _t * 900.0),
	)
```

Budget: light hit 0.2 · heavy 0.4 · explosion 0.7 · death 1.0.

Use `offset`, never `position` — `position` belongs to the follow logic and the
two will fight.

**Flash.** Values above 1.0 blow out to white:

```gdscript
func flash(duration: float = 0.12) -> void:
	modulate = Color(6.0, 6.0, 6.0)
	create_tween().tween_property(self, "modulate", Color.WHITE, duration)
```

**Squash and stretch:**

```gdscript
func land() -> void:
	sprite.scale = Vector2(1.3, 0.7)
	create_tween().tween_property(sprite, "scale", Vector2.ONE, 0.18)\
		.set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
```

**One-shot particles.** Set `one_shot = true` and `emitting = false` in the
scene, then:

```gdscript
$ImpactParticles.global_position = contact_point
$ImpactParticles.restart()    # restart(), not emitting = true — that will not re-fire
```

**Everything at once**, which is what juice actually looks like in code:

```gdscript
func on_hit(from: Vector2, heavy: bool) -> void:
	hitstop(0.12 if heavy else 0.06)
	flash()
	velocity += (global_position - from).normalized() * (420.0 if heavy else 240.0)
	camera.add_trauma(0.4 if heavy else 0.2)
	$ImpactParticles.restart()
	sfx.pitch_scale = randf_range(0.92, 1.08)
	sfx.play()
	DamagePopup.spawn(global_position, damage)
```

## When juice is wrong

Juice amplifies. It amplifies bad games too.

- **Legibility beats spectacle.** If the effect hides what happened — whether the
  hit landed, where the enemy went — it is a bug, however good it looks. This is
  the failure mode of stacking juice without evaluating each layer.
- **Shake is the first thing to overdo.** If it is noticeable *as shake*, it is
  too strong. It is also a genuine accessibility problem: screenshake, flashing
  and chromatic aberration cause motion sickness and can trigger photosensitive
  reactions.
- **Ship a reduce-motion option.** Route every shake through one global
  multiplier (the `strength` export above) and every screen flash through one
  toggle, from the start. Retrofitting this later means touching every effect.
- **Juice hides missing design.** A satisfying hit does not make a boring
  encounter interesting. If the answer to "why is this dull" is "needs more
  juice" twice in a row, the problem is in `game-design`.

## A juice pass, concretely

1. `godot_run`, and identify the single most-repeated moment.
2. Baseline: `godot_screenshot` and `godot_step` through that moment, and count
   how many frames of feedback exist today. Often the answer is zero.
3. Add one layer. `godot_check`, restart, frame-step it again, look.
4. Keep, tune, or revert. Then the next layer.
5. After every third layer, watch the whole thing at `time_scale: 0.15` and ask
   whether it is still *legible* — not whether it is more exciting.

Sources: [Juice it or lose it](https://www.youtube.com/watch?v=Fy0aCDmgnxg) ·
[The Art of Screenshake](https://www.youtube.com/watch?v=SkgkIXZ_13Y) ·
[Making Games Juicy](https://abagames.github.io/joys-of-small-game-development-en/make_game_juicy.html)
