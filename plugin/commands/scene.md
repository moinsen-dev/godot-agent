---
description: Create or modify a Godot scene the safe way — via a headless builder Godot serialises itself
argument-hint: "<scene to build or change>"
---

Build or change this scene: **$ARGUMENTS**

Load the `godot-scene-authoring` skill first, and `godot-nodes` to choose the
node types.

Rules for this task:

- **Never hand-write or text-edit `.tscn` / `.tres`.** Write a GDScript that
  extends `SceneTree`, build the node graph in code, `pack()` and
  `ResourceSaver.save()`, and run it with `godot_run_script`.
- Set `owner` on every descendant of the packed root, or `pack()` drops them
  silently and the scene saves as an empty shell.
- To change an existing scene, `load()` it, `instantiate()`, modify, re-pack.
- Put the builder in a clearly disposable place (e.g. `res://tools/build_*.gd`)
  and tell the user it is a build script, not game code.

Then verify, in this order:

1. `godot_check` — the scene must import and load cleanly.
2. `godot_run` with the new scene (`scene: "res://…"` runs it directly, which
   is faster than navigating there through the game).
3. `godot_screenshot` and read the image — confirm it looks like what was asked.
4. `godot_tree` — confirm the structure is what you intended, and that nothing
   was dropped.

Report what you built, the node structure, and show that you looked at it.
