---
description: Build a Godot feature and keep going until it is verified in the running game
argument-hint: "<what to build or fix>"
---

Implement this in the Godot project, and do not stop until you have seen it
working: **$ARGUMENTS**

Load the `godot-agentic-loop` skill first. Also load `godot-gdscript` before
writing GDScript, `godot-scene-authoring` before creating or changing any
`.tscn`/`.tres`, and `godot-nodes` when choosing what a new scene should be
built from.

Work in this cycle, and keep cycling without asking permission between rounds:

1. **Understand** — `godot_tree` on the running game and read the relevant
   scripts. Do not infer structure from file names.
2. **Change** — edit scripts directly; author scenes with a headless builder
   script via `godot_run_script`, never by hand-editing scene text.
3. **Gate** — `godot_check`. Red means stop and fix; nothing below is meaningful
   until it is green.
4. **Run** — `godot_run` (restart it if it was already running, so the new code
   is loaded).
5. **See** — `godot_screenshot` and **read the image**.
6. **Exercise** — drive the actual behaviour with `godot_input`, read state back
   with `godot_eval` or `godot_get`, and use `godot_step` when timing matters.
   Rendering the feature is not the same as the feature working.
7. **Check** — `godot_logs --errors_only`. Fix and cycle again.

Stop and ask the user only when a genuine design decision is needed — something
where two reasonable answers would produce materially different games. Bugs,
errors and failing checks are yours to fix, not to report back.

When you are done, report in a few lines: what now works, the evidence you have
for it (what you saw, what you measured), and anything you deliberately left
out. If any part is unverified, say which part and why — never describe
something as working when you have not seen it run.
