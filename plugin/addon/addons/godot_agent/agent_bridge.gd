extends Node
## Runtime bridge between a running Godot game and an external agent.
##
## Registered as the autoload singleton `GodotAgent`. Listens on a local TCP
## socket and speaks newline-delimited JSON, so the agent can press play, look
## at the screen, poke at nodes and drive input while the game is running.
##
## Screenshots are written to disk and answered as a path — never inlined into
## the response — so a long agent session does not drown in base64.

const DEFAULT_PORT := 9080
const SHOT_DIR := "user://agent_shots"
const MAX_LINE := 1 << 20  ## 1 MiB guard against a runaway client

var _server: TCPServer
var _clients: Array[Dictionary] = []
var _port: int = DEFAULT_PORT
var _shot_dir_abs: String = ""

## Ring buffer of things the game itself reported, see `report()`.
var _events: Array[Dictionary] = []
const MAX_EVENTS := 500


func _ready() -> void:
	# Keep answering while the game is paused — stepping frames depends on it.
	process_mode = Node.PROCESS_MODE_ALWAYS

	if not _should_start():
		set_process(false)
		return

	_port = _resolve_port()
	_shot_dir_abs = ProjectSettings.globalize_path(SHOT_DIR)
	DirAccess.make_dir_recursive_absolute(_shot_dir_abs)

	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[godot-agent] cannot listen on 127.0.0.1:%d (%s)" % [_port, error_string(err)])
		set_process(false)
		return

	# The bridge greps stdout for this line to learn the port is up.
	print("[godot-agent] listening on 127.0.0.1:%d" % _port)


func _exit_tree() -> void:
	for c in _clients:
		(c.peer as StreamPeerTCP).disconnect_from_host()
	_clients.clear()
	if _server != null:
		_server.stop()


## Record something the game wants the agent to know (deaths, level loads,
## state transitions). Call from anywhere: `GodotAgent.report("died", {...})`.
func report(kind: String, data: Variant = null) -> void:
	_events.append({
		"kind": kind,
		"data": _encode(data),
		"frame": Engine.get_frames_drawn(),
		"t": Time.get_ticks_msec(),
	})
	if _events.size() > MAX_EVENTS:
		_events = _events.slice(_events.size() - MAX_EVENTS)


# --------------------------------------------------------------------------
# transport
# --------------------------------------------------------------------------

func _should_start() -> bool:
	# A `--script` run is a tool invocation (scene authoring, asset generation),
	# not a game session. Autoloads are still instantiated there, so without
	# this guard every headless build would grab the port and leak nodes.
	for arg in OS.get_cmdline_args():
		if arg == "--script" or arg == "-s" or arg.begins_with("--check-only"):
			return false
	if "--agent-bridge" in OS.get_cmdline_args():
		return true
	if OS.has_environment("GODOT_AGENT_PORT"):
		return true
	return OS.is_debug_build()


func _resolve_port() -> int:
	for arg in OS.get_cmdline_args():
		if arg.begins_with("--agent-port="):
			return int(arg.split("=")[1])
	if OS.has_environment("GODOT_AGENT_PORT"):
		return int(OS.get_environment("GODOT_AGENT_PORT"))
	return DEFAULT_PORT


func _process(_delta: float) -> void:
	if _server == null:
		return

	while _server.is_connection_available():
		var peer := _server.take_connection()
		peer.set_no_delay(true)
		_clients.append({"peer": peer, "buf": PackedByteArray()})

	for i in range(_clients.size() - 1, -1, -1):
		var c := _clients[i]
		var peer := c.peer as StreamPeerTCP
		peer.poll()
		if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_clients.remove_at(i)
			continue
		_pump(c)


func _pump(c: Dictionary) -> void:
	var peer := c.peer as StreamPeerTCP
	var avail := peer.get_available_bytes()
	if avail > 0:
		var res: Array = peer.get_data(avail)
		if res[0] == OK:
			var buf: PackedByteArray = c.buf
			buf.append_array(res[1] as PackedByteArray)
			c.buf = buf

	while true:
		var buf: PackedByteArray = c.buf
		var nl := buf.find(10)  # \n
		if nl == -1:
			if buf.size() > MAX_LINE:
				c.buf = PackedByteArray()
			break
		var line := buf.slice(0, nl).get_string_from_utf8()
		c.buf = buf.slice(nl + 1)
		_dispatch(peer, line.strip_edges())


func _send(peer: StreamPeerTCP, payload: Dictionary) -> void:
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	peer.put_data((JSON.stringify(payload) + "\n").to_utf8_buffer())


func _dispatch(peer: StreamPeerTCP, line: String) -> void:
	if line.is_empty():
		return
	var req: Variant = JSON.parse_string(line)
	if typeof(req) != TYPE_DICTIONARY:
		_send(peer, {"ok": false, "error": "malformed JSON request"})
		return

	var id: Variant = req.get("id", null)
	var cmd := String(req.get("cmd", ""))
	var args: Dictionary = req.get("args", {}) if typeof(req.get("args")) == TYPE_DICTIONARY else {}

	var result: Variant = null
	# Commands that need frames are awaited; each reply carries its id, so
	# out-of-order completion is fine for the client.
	match cmd:
		"ping":
			result = _cmd_ping()
		"tree":
			result = _cmd_tree(args)
		"screenshot":
			result = await _cmd_screenshot(args)
		"get":
			result = _cmd_get(args)
		"set":
			result = _cmd_set(args)
		"call":
			result = _cmd_call(args)
		"eval":
			result = _cmd_eval(args)
		"input":
			result = await _cmd_input(args)
		"step":
			result = await _cmd_step(args)
		"pause":
			result = _cmd_pause(args)
		"events":
			result = _cmd_events(args)
		"scene":
			result = _cmd_scene(args)
		"quit":
			_send(peer, {"id": id, "ok": true, "result": {"quitting": true}})
			get_tree().quit()
			return
		_:
			_send(peer, {"id": id, "ok": false, "error": "unknown command '%s'" % cmd})
			return

	if typeof(result) == TYPE_DICTIONARY and (result as Dictionary).has("__error"):
		_send(peer, {"id": id, "ok": false, "error": (result as Dictionary)["__error"]})
	else:
		_send(peer, {"id": id, "ok": true, "result": result})


func _fail(msg: String) -> Dictionary:
	return {"__error": msg}


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

func _cmd_ping() -> Dictionary:
	var vp := get_viewport()
	return {
		"pong": true,
		"godot": "%s.%s.%s" % [
			Engine.get_version_info().major,
			Engine.get_version_info().minor,
			Engine.get_version_info().patch,
		],
		"project": ProjectSettings.get_setting("application/config/name", ""),
		"scene": get_tree().current_scene.scene_file_path if get_tree().current_scene else "",
		"frame": Engine.get_frames_drawn(),
		"fps": Engine.get_frames_per_second(),
		"paused": get_tree().paused,
		"time_scale": Engine.time_scale,
		"viewport": [vp.get_visible_rect().size.x, vp.get_visible_rect().size.y],
		"shot_dir": _shot_dir_abs,
	}


func _cmd_tree(args: Dictionary) -> Variant:
	var root_path := String(args.get("path", ""))
	var root: Node = get_tree().root if root_path.is_empty() else _resolve(root_path)
	if root == null:
		return _fail("node not found: %s" % root_path)
	var depth := int(args.get("depth", 6))
	var props: Array = args.get("props", [])
	return _describe(root, depth, props)


func _describe(n: Node, depth: int, props: Array) -> Dictionary:
	var d := {
		"name": n.name,
		"class": n.get_class(),
		"path": String(n.get_path()),
	}
	if n.get_script() != null:
		d["script"] = (n.get_script() as Script).resource_path
	if n is CanvasItem:
		d["visible"] = (n as CanvasItem).visible
	elif n is Node3D:
		d["visible"] = (n as Node3D).visible
	if n is Node2D:
		d["position"] = _encode((n as Node2D).global_position)
	elif n is Control:
		d["rect"] = _encode((n as Control).get_global_rect())
	elif n is Node3D:
		d["position"] = _encode((n as Node3D).global_position)

	for p in props:
		var key := String(p)
		if key in n:
			d[key] = _encode(n.get(key))

	if depth > 0 and n.get_child_count() > 0:
		var kids: Array = []
		for child in n.get_children():
			kids.append(_describe(child, depth - 1, props))
		d["children"] = kids
	elif n.get_child_count() > 0:
		d["children_omitted"] = n.get_child_count()
	return d


func _cmd_screenshot(args: Dictionary) -> Variant:
	# The image must be grabbed after the frame is on the GPU, otherwise it is
	# either empty or one frame stale.
	#
	# A window that is occluded, minimised or on another Space stops drawing
	# altogether — _process keeps running at full speed while frames_drawn is
	# frozen — so simply awaiting frame_post_draw would hang forever. Detect
	# that and force a frame instead. This is what makes screenshots work while
	# the agent runs in the background.
	var before := Engine.get_frames_drawn()
	await get_tree().process_frame
	if Engine.get_frames_drawn() == before:
		RenderingServer.force_draw(false)
	else:
		await RenderingServer.frame_post_draw

	var vp: Viewport = get_viewport()
	var vp_path := String(args.get("viewport", ""))
	if not vp_path.is_empty():
		var n := _resolve(vp_path)
		if n == null or not (n is Viewport):
			return _fail("viewport not found: %s" % vp_path)
		vp = n as Viewport

	var tex := vp.get_texture()
	if tex == null:
		return _fail("viewport has no texture (running --headless? rendering is disabled there)")
	var img := tex.get_image()
	if img == null or img.is_empty():
		return _fail("empty frame — headless mode cannot produce screenshots")

	var scale := float(args.get("scale", 1.0))
	if scale > 0.0 and not is_equal_approx(scale, 1.0):
		img.resize(int(img.get_width() * scale), int(img.get_height() * scale), Image.INTERPOLATE_BILINEAR)

	var name := String(args.get("name", ""))
	if name.is_empty():
		name = "shot_%08d_%d" % [Engine.get_frames_drawn(), Time.get_ticks_msec()]
	var path := "%s/%s.png" % [_shot_dir_abs, name]
	var err := img.save_png(path)
	if err != OK:
		return _fail("save_png failed: %s" % error_string(err))

	return {
		"path": path,
		"width": img.get_width(),
		"height": img.get_height(),
		"frame": Engine.get_frames_drawn(),
	}


func _cmd_get(args: Dictionary) -> Variant:
	var n := _resolve(String(args.get("path", "")))
	if n == null:
		return _fail("node not found: %s" % args.get("path", ""))
	var prop := String(args.get("prop", ""))
	if prop.is_empty():
		var out := {}
		for p in n.get_property_list():
			if (int(p.usage) & PROPERTY_USAGE_EDITOR) != 0:
				out[p.name] = _encode(n.get(p.name))
		return out
	if not (prop in n):
		return _fail("no property '%s' on %s" % [prop, n.get_class()])
	return {"value": _encode(n.get(prop))}


func _cmd_set(args: Dictionary) -> Variant:
	var n := _resolve(String(args.get("path", "")))
	if n == null:
		return _fail("node not found: %s" % args.get("path", ""))
	var prop := String(args.get("prop", ""))
	if not (prop in n):
		return _fail("no property '%s' on %s" % [prop, n.get_class()])
	n.set(prop, _decode(args.get("value")))
	return {"value": _encode(n.get(prop))}


func _cmd_call(args: Dictionary) -> Variant:
	var n := _resolve(String(args.get("path", "")))
	if n == null:
		return _fail("node not found: %s" % args.get("path", ""))
	var method := String(args.get("method", ""))
	if not n.has_method(method):
		return _fail("no method '%s' on %s" % [method, n.get_class()])
	var call_args: Array = []
	for a in (args.get("args", []) as Array):
		call_args.append(_decode(a))
	return {"value": _encode(n.callv(method, call_args))}


func _cmd_eval(args: Dictionary) -> Variant:
	var code := String(args.get("code", ""))
	if code.is_empty():
		return _fail("eval needs 'code'")
	var base: Object = self
	var base_path := String(args.get("path", ""))
	if not base_path.is_empty():
		base = _resolve(base_path)
		if base == null:
			return _fail("node not found: %s" % base_path)

	# Expression has no access to autoloads or singletons on its own, so hand
	# the common ones in as named inputs — otherwise `Engine.get_frames_drawn()`
	# fails with "Invalid named index".
	var names := PackedStringArray([
		"Engine", "Input", "InputMap", "Time", "OS", "ProjectSettings",
		"DisplayServer", "AudioServer", "RenderingServer", "PhysicsServer2D", "self",
	])
	var inputs: Array = [
		Engine, Input, InputMap, Time, OS, ProjectSettings,
		DisplayServer, AudioServer, RenderingServer, PhysicsServer2D, base,
	]

	var expr := Expression.new()
	var err := expr.parse(code, names)
	if err != OK:
		return _fail("parse error: %s" % expr.get_error_text())
	var value: Variant = expr.execute(inputs, base, true)
	if expr.has_execute_failed():
		return _fail("execute error: %s" % expr.get_error_text())
	return {"value": _encode(value)}


func _cmd_input(args: Dictionary) -> Variant:
	# Measuring how long a piece of feedback lasts means injecting input and then
	# advancing an exact number of frames. But Input.parse_input_event() delivers
	# immediately, and a paused tree drops it for every node with the default
	# process mode — so injecting while paused loses the event entirely.
	# `step` unpauses around the injection and re-pauses afterwards.
	var step := int(args.get("step", 0))
	var was_paused := get_tree().paused
	if step > 0 and was_paused:
		get_tree().paused = false

	var result: Variant = await _do_input(args)

	if step > 0:
		for _i in range(step):
			await get_tree().process_frame
		get_tree().paused = was_paused
		if typeof(result) == TYPE_DICTIONARY and not (result as Dictionary).has("__error"):
			(result as Dictionary)["stepped"] = step
			(result as Dictionary)["frame"] = Engine.get_frames_drawn()
	return result


func _do_input(args: Dictionary) -> Variant:
	var kind := String(args.get("kind", ""))
	match kind:
		"click":
			var pos := Vector2(float(args.get("x", 0)), float(args.get("y", 0)))
			var button := int(args.get("button", MOUSE_BUTTON_LEFT))
			for pressed in [true, false]:
				var ev := InputEventMouseButton.new()
				ev.button_index = button
				ev.pressed = pressed
				ev.position = pos
				ev.global_position = pos
				ev.button_mask = button if pressed else 0
				Input.parse_input_event(ev)
			return {"clicked": [pos.x, pos.y], "button": button}

		"move":
			var ev := InputEventMouseMotion.new()
			ev.position = Vector2(float(args.get("x", 0)), float(args.get("y", 0)))
			ev.global_position = ev.position
			ev.relative = Vector2(float(args.get("dx", 0)), float(args.get("dy", 0)))
			Input.parse_input_event(ev)
			return {"moved": [ev.position.x, ev.position.y]}

		"key":
			var ev := InputEventKey.new()
			ev.keycode = int(args.get("keycode", 0))
			ev.physical_keycode = ev.keycode
			ev.unicode = int(args.get("unicode", 0))
			var hold := bool(args.get("hold", false))
			ev.pressed = bool(args.get("pressed", true))
			Input.parse_input_event(ev)
			if not hold and ev.pressed:
				var up := ev.duplicate() as InputEventKey
				up.pressed = false
				Input.parse_input_event(up)
			return {"key": ev.keycode, "held": hold}

		"action":
			var action := String(args.get("action", ""))
			if not InputMap.has_action(action):
				return _fail("no such input action: '%s' (check project.godot input map)" % action)

			# Input.action_press() only moves the polling state, so code that
			# reads `event.is_action_pressed()` in _input() never sees it.
			# Replaying a real event from the InputMap drives both paths.
			var mapped := InputMap.action_get_events(action)
			var pressed := bool(args.get("pressed", true))
			var hold := bool(args.get("hold", false))

			if mapped.is_empty():
				if pressed:
					Input.action_press(action, float(args.get("strength", 1.0)))
				else:
					Input.action_release(action)
				return {"action": action, "pressed": pressed, "via": "polling-only (action has no events mapped)"}

			var down := (mapped[0] as InputEvent).duplicate() as InputEvent
			_set_event_pressed(down, pressed)
			Input.parse_input_event(down)

			if pressed and not hold:
				# One frame in between, so is_action_just_pressed() is observable.
				await get_tree().process_frame
				var up := (mapped[0] as InputEvent).duplicate() as InputEvent
				_set_event_pressed(up, false)
				Input.parse_input_event(up)
			return {"action": action, "pressed": pressed, "held": hold, "via": down.get_class()}

		_:
			return _fail("unknown input kind '%s' (click|move|key|action)" % kind)


## The `pressed` flag lives on different subclasses, so set it where it exists.
func _set_event_pressed(ev: InputEvent, pressed: bool) -> void:
	if ev is InputEventKey:
		(ev as InputEventKey).pressed = pressed
	elif ev is InputEventMouseButton:
		(ev as InputEventMouseButton).pressed = pressed
	elif ev is InputEventJoypadButton:
		(ev as InputEventJoypadButton).pressed = pressed
	elif ev is InputEventJoypadMotion:
		(ev as InputEventJoypadMotion).axis_value = 1.0 if pressed else 0.0
	elif ev is InputEventAction:
		(ev as InputEventAction).pressed = pressed


func _cmd_step(args: Dictionary) -> Variant:
	var frames := int(args.get("frames", 1))
	var was_paused := get_tree().paused
	get_tree().paused = false
	for _i in range(max(frames, 1)):
		await get_tree().process_frame
	get_tree().paused = was_paused
	return {"stepped": frames, "frame": Engine.get_frames_drawn(), "paused": get_tree().paused}


func _cmd_pause(args: Dictionary) -> Variant:
	if args.has("paused"):
		get_tree().paused = bool(args["paused"])
	if args.has("time_scale"):
		Engine.time_scale = float(args["time_scale"])
	return {"paused": get_tree().paused, "time_scale": Engine.time_scale}


func _cmd_events(args: Dictionary) -> Variant:
	var out := _events.duplicate()
	if bool(args.get("clear", true)):
		_events.clear()
	return {"events": out}


func _cmd_scene(args: Dictionary) -> Variant:
	var path := String(args.get("path", ""))
	if path.is_empty():
		var cur := get_tree().current_scene
		return {"scene": cur.scene_file_path if cur else ""}
	if not ResourceLoader.exists(path):
		return _fail("scene does not exist: %s" % path)
	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		return _fail("change_scene_to_file failed: %s" % error_string(err))
	return {"scene": path}


# --------------------------------------------------------------------------
# value marshalling
# --------------------------------------------------------------------------

## Godot values go over the wire as strings via `var_to_str`, which round-trips
## losslessly through `str_to_var` — no bespoke Vector2/Color encoding needed.
func _encode(v: Variant) -> Variant:
	match typeof(v):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return v
		TYPE_OBJECT:
			if v == null:
				return null
			if v is Node:
				return {"__node": String((v as Node).get_path()), "class": v.get_class()}
			return {"__object": (v as Object).get_class()}
		TYPE_ARRAY:
			var out: Array = []
			for e in (v as Array):
				out.append(_encode(e))
			return out
		TYPE_DICTIONARY:
			var d := {}
			for k in (v as Dictionary):
				d[String(k)] = _encode((v as Dictionary)[k])
			return d
		_:
			return {"__gd": var_to_str(v)}


func _decode(v: Variant) -> Variant:
	if typeof(v) == TYPE_DICTIONARY:
		var d := v as Dictionary
		if d.has("__gd"):
			return str_to_var(String(d["__gd"]))
		if d.has("__node"):
			return _resolve(String(d["__node"]))
		var out := {}
		for k in d:
			out[k] = _decode(d[k])
		return out
	if typeof(v) == TYPE_ARRAY:
		var arr: Array = []
		for e in (v as Array):
			arr.append(_decode(e))
		return arr
	return v


## Accepts absolute node paths, paths relative to the current scene, and the
## shorthand `%UniqueName` used inside the current scene.
func _resolve(path: String) -> Node:
	if path.is_empty():
		return null
	var scene := get_tree().current_scene
	if path.begins_with("%") and scene != null:
		return scene.get_node_or_null(NodePath(path))
	var n := get_tree().root.get_node_or_null(NodePath(path))
	if n != null:
		return n
	if scene != null:
		return scene.get_node_or_null(NodePath(path))
	return null
