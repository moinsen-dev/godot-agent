---
description: Fast headless gate — import and parse the whole project, no window, and fix what is broken
argument-hint: "[--fix]"
---

Run `godot_check` on the project. It imports and parses everything headless in
a few seconds, with no window and no running game.

Report every error with its `res://` file and line. If there are warnings,
report the count and only list ones that indicate a real problem.

If `$ARGUMENTS` contains `--fix`, then fix the errors: load the `godot-gdscript`
skill (most parse errors are Godot 3 syntax that slipped in), fix them, and
re-run `godot_check` until it is green. Report what was wrong and what you
changed.

Otherwise just report, and say what you would change.

This is the right thing to run after any batch of edits and before every launch.
