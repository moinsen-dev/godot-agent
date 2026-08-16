extends SceneTree
## Headless scene builder — run with:
##   godot --headless --path . --script res://build_main.gd
##
## This is the pattern the plugin uses everywhere instead of hand-writing
## .tscn text: build the node graph in code, let Godot serialise it. Resource
## ids, node paths and property formatting are then correct by construction.


func _initialize() -> void:
	var main := Node2D.new()
	main.name = "Main"
	main.set_script(load("res://main.gd"))

	var box := ColorRect.new()
	box.name = "Box"
	box.color = Color(0.2, 0.6, 1.0)
	box.size = Vector2(120, 120)
	box.position = Vector2(260, 120)
	box.pivot_offset = Vector2(60, 60)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	main.add_child(box)

	var label := Label.new()
	label.name = "Label"
	label.text = "score 0"
	label.position = Vector2(20, 20)
	main.add_child(label)

	# Every descendant needs `owner` pointing at the scene root, or pack()
	# silently drops it. This is the single most common .tscn authoring bug.
	for child in main.get_children():
		child.owner = main

	var packed := PackedScene.new()
	var err := packed.pack(main)
	if err != OK:
		push_error("pack failed: %s" % error_string(err))
		quit(1)
		return

	err = ResourceSaver.save(packed, "res://main.tscn")
	if err != OK:
		push_error("save failed: %s" % error_string(err))
		quit(1)
		return

	print("wrote res://main.tscn with %d children" % main.get_child_count())
	main.free()
	quit(0)
