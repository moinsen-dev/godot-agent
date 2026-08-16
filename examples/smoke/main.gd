extends Node2D

var score := 0
var jumps := 0


func _ready() -> void:
	$Label.text = "score 0"


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		score += 1
		$Label.text = "score %d" % score
		GodotAgent.report("clicked", {"score": score})
		_flash()
	if event.is_action_pressed("jump"):
		jumps += 1
		GodotAgent.report("jumped", {"jumps": jumps})


## A deliberately short juice effect, here to verify that frame stepping can
## actually count how many frames a piece of feedback stays on screen.
func _flash() -> void:
	$Box.color = Color(8.0, 8.0, 8.0)
	create_tween().tween_property($Box, "color", Color(0.2, 0.6, 1.0), 0.1)


func _process(delta: float) -> void:
	$Box.rotation += delta
