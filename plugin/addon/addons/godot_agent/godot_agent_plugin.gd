@tool
extends EditorPlugin
## Registers the runtime bridge as an autoload so it is present in every scene.
##
## The autoload only opens its socket in debug builds (or when `--agent-bridge`
## is passed), so an exported release build stays untouched.

const AUTOLOAD_NAME := "GodotAgent"
const AUTOLOAD_PATH := "res://addons/godot_agent/agent_bridge.gd"


func _enter_tree() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)


func _exit_tree() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
