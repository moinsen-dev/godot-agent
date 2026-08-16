---
name: godot-nodes
description: >-
  Which Godot node to reach for, in 2D and in 3D, and how to structure a scene
  so it stays workable. Read this when starting a new scene, adding a character,
  camera, level geometry, UI or collision, or when unsure whether something
  should be an Area, a Body, a Control or a Resource.
---

# Choosing nodes

Picking the wrong base node is expensive — it shows up as fights with the engine
three hours later. The choice is nearly always determined by one question.

## Movement and collision

**What moves this thing?**

| The mover is | 2D | 3D |
|---|---|---|
| Your code, with collision response | `CharacterBody2D` | `CharacterBody3D` |
| The physics engine (gravity, impulses) | `RigidBody2D` | `RigidBody3D` |
| Nothing — it is level geometry | `StaticBody2D` | `StaticBody3D` |
| Your code, moving a wall or platform | `AnimatableBody2D` | `AnimatableBody3D` |
| Nothing physical — just detection | `Area2D` | `Area3D` |

Players and enemies are almost always `CharacterBody*`. Reach for `RigidBody*`
only when you genuinely want the simulation to own the object (debris, crates,
ragdolls) — you cannot set its position directly without fighting the solver.

Pickups, hurtboxes, triggers and detection ranges are `Area*` — they report
overlap and never push anything. A hitbox/hurtbox pair is two `Area2D`s on
different collision layers, not bodies.

Every body and area needs a `CollisionShape*` (or `CollisionPolygon*`) **child**.
A body without one silently collides with nothing.

## Visuals

| You want | 2D | 3D |
|---|---|---|
| A still image | `Sprite2D` | `Sprite3D` / `MeshInstance3D` |
| Frame animation | `AnimatedSprite2D` | `AnimationPlayer` on the mesh |
| Property/keyframe animation | `AnimationPlayer` | `AnimationPlayer` |
| Blended state animation | `AnimationTree` | `AnimationTree` |
| Particles | `GPUParticles2D` | `GPUParticles3D` |
| Tilemap level | `TileMapLayer` (one per layer) | `GridMap` |
| Line / trail | `Line2D` | `MeshInstance3D` with an immediate mesh |

`AnimationPlayer` is not only for sprites — it keyframes any property, which
makes it the cheapest way to build a polished UI transition or a door.

## Cameras and viewports

- 2D: `Camera2D` — set `position_smoothing_enabled` for follow, use `limit_*` to
  keep it inside the level.
- 3D: `Camera3D`, usually as a child of a `SpringArm3D` for a third-person rig
  (the spring arm handles wall clipping for free).
- Render-to-texture, split screen, minimaps: `SubViewport` + `SubViewportContainer`.

## UI

All UI is `Control`. Never position UI with `Node2D` coordinates.

- Layout containers do the work: `VBoxContainer`, `HBoxContainer`,
  `GridContainer`, `MarginContainer`, `CenterContainer`.
- Anchors and `size_flags` handle resolution changes. Hard-coded pixel positions
  in UI are a bug waiting for a different window size.
- `CanvasLayer` puts a HUD above the game world and outside camera movement.
- Theme resources, not per-node overrides, for anything that appears more than
  once.

## Structure

**One scene, one responsibility.** A player scene owns the player. A level scene
instances players and enemies. If a scene needs to know about its parent's
internals, the boundary is wrong.

**Signals go up, calls go down.** A parent may call methods on its children. A
child must not reach for its parent — it emits a signal and lets whoever cares
connect. This is what keeps scenes reusable in isolation.

**Composition over inheritance.** Prefer child nodes that each do one thing
(`HealthComponent`, `HurtboxComponent`, `StateMachine`) over a deep class
hierarchy. Godot's tree is already a composition system; a five-level `extends`
chain is fighting it.

**Data belongs in `Resource`s.** Enemy stats, weapon definitions, level configs:
a `class_name` + `@export` Resource saved as `.tres` is inspectable in the
editor, diffable in git, and swappable without touching code.

**Autoloads are for genuinely global, single-instance things** — a save system,
an audio bus manager, an event bus. Every autoload is global mutable state, so
each one needs to earn its place. Game logic in an autoload is a smell.

## 3D specifics worth knowing early

- Units are metres. Model and import at real scale, or physics and lighting will
  both feel wrong.
- `NavigationRegion3D` + `NavigationAgent3D` for pathfinding; bake the mesh after
  the level geometry is final.
- `WorldEnvironment` holds the sky, tonemap, ambient light and post-processing.
  One per scene, and it is the difference between "grey blocks" and "a scene".
- `OccluderInstance3D` and LOD matter far earlier than expected on large scenes.
- `CSGBox3D` and friends are for blockout only. Convert to meshes before shipping
  — CSG is slow and re-evaluates at runtime.

## Verify instead of assuming

`godot_tree` on the running game shows the real structure with real class names.
When a node does not behave as expected, look there first — the difference
between the scene file and the live tree is where most of these bugs hide.
