---
name: godot-scene-authoring
description: >-
  How to create and modify Godot scenes (.tscn) and resources (.tres) reliably —
  by writing a headless GDScript builder and letting Godot serialise the file,
  never by hand-writing scene text. Read this before creating any scene,
  instancing a scene into another, building a resource, or editing .tscn markup.
  Covers the owner trap that silently drops nodes, uid:// references, and how to
  modify an existing scene.
---

# Authoring scenes without breaking them

**Do not hand-write `.tscn` or `.tres` text.** The format has interlocking parts
— `[ext_resource]` ids, `[sub_resource]` ids, `uid://` references, node paths,
`load_steps` counts — and a hand-edited file that looks right is the single most
common way to corrupt a Godot project. Godot already has a correct serialiser.
Use it.

## The pattern

Write a script that extends `SceneTree`, build the node graph in code, pack and
save. Run it with `godot_run_script` (headless, no window, a second or two).

```gdscript
extends SceneTree

func _initialize() -> void:
	var root := CharacterBody2D.new()
	root.name = "Player"
	root.set_script(load("res://player/player.gd"))

	var sprite := Sprite2D.new()
	sprite.name = "Sprite2D"
	sprite.texture = load("res://art/player.png")
	root.add_child(sprite)

	var shape := CollisionShape2D.new()
	shape.name = "CollisionShape2D"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(16, 24)
	shape.shape = rect          # sub-resources are just objects; no ids to manage
	root.add_child(shape)

	# THE TRAP: every descendant needs `owner` set to the scene root, or pack()
	# silently drops it. The scene saves fine and comes back empty.
	for child in root.get_children():
		child.owner = root

	var packed := PackedScene.new()
	var err := packed.pack(root)
	if err != OK:
		push_error("pack failed: %s" % error_string(err))
		quit(1)
		return

	err = ResourceSaver.save(packed, "res://player/player.tscn")
	if err != OK:
		push_error("save failed: %s" % error_string(err))
		quit(1)
		return

	print("wrote res://player/player.tscn")
	root.free()
	quit(0)
```

### The owner rule, precisely

`PackedScene.pack()` only stores nodes whose `owner` is the packed root. Direct
children *and* every nested descendant need it. For deep trees, recurse:

```gdscript
func _own_all(node: Node, root: Node) -> void:
	for child in node.get_children():
		child.owner = root
		_own_all(child, root)
```

The one exception: nodes that come from an instanced sub-scene keep their own
ownership — set `owner` on the instance root only, not on its internals.

## Instancing one scene inside another

```gdscript
var enemy_scene: PackedScene = load("res://enemy/enemy.tscn")
var enemy := enemy_scene.instantiate()   # 4.x — `instance()` is Godot 3
enemy.name = "Enemy1"
enemy.position = Vector2(320, 180)
level.add_child(enemy)
enemy.owner = level                      # instance root only
```

## Modifying an existing scene

Load it, change it, pack it again. Never patch the text.

```gdscript
var scene: PackedScene = load("res://level/level.tscn")
var root := scene.instantiate()

root.get_node("Player").position = Vector2(64, 400)
var pickup := preload("res://items/coin.tscn").instantiate()
root.add_child(pickup)
pickup.owner = root

var packed := PackedScene.new()
packed.pack(root)
ResourceSaver.save(packed, "res://level/level.tscn")
root.free()
```

`instantiate()` on a loaded scene already sets `owner` correctly for the existing
nodes — only nodes *you* add need it.

## Resources (.tres)

Same idea, less ceremony:

```gdscript
var cfg := load("res://data/enemy_stats.gd").new()   # a Resource subclass
cfg.health = 30
cfg.speed = 90.0
ResourceSaver.save(cfg, "res://data/goblin.tres")
```

Define the resource type with `class_name` and `@export` so the editor shows it:

```gdscript
class_name EnemyStats
extends Resource

@export var health: int = 10
@export var speed: float = 60.0
```

## uid:// references

Since 4.4 Godot writes a `.uid` file next to each script and refers to resources
by `uid://` in scene files. They are generated and maintained by the engine.

- Never write `uid://` values by hand, and never invent one.
- Never delete a `.uid` file on its own — move or delete it together with its
  script, or Godot regenerates it and existing references break.
- Moving assets is the editor's job (it fixes references). If you must move files
  outside the editor, run `godot_check` afterwards — broken references show up as
  load errors there.

## After writing a scene

Always `godot_check`. A scene that saved without error can still fail to load —
a missing texture, a script that does not parse, a `class_name` collision. The
check catches all of it before you launch.
