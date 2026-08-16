---
description: Install the Godot agent bridge into this project and verify the whole loop works end to end
argument-hint: "[project directory]"
---

Set up the Godot agent bridge for `$ARGUMENTS` (default: the nearest project
containing `project.godot`).

1. Call `godot_setup`. It copies the addon into `addons/godot_agent/` and
   registers the `GodotAgent` autoload in `project.godot`. Report the detected
   Godot version.
2. Call `godot_check` to confirm the project imports and parses cleanly. If it
   is already red before any of your changes, say so plainly and stop — that is
   a pre-existing problem the user should know about.
3. Call `godot_run`, then `godot_screenshot`, then **read the PNG**. Confirm out
   loud that you can see the game.
4. Call `godot_logs --errors_only`.
5. Call `godot_stop`.

Then tell the user, in three or four lines: which Godot version was found,
whether the loop works, and what they can now ask for (see the running game,
inject input, read real script errors, author scenes headless).

Also mention the one thing that will otherwise confuse them: `addons/godot_agent/`
and the `[autoload]` entry are now part of their project and should be committed;
the bridge only opens its socket in debug builds, so exported release builds are
unaffected.

If `godot_setup` fails because no Godot binary was found, tell them to set
`GODOT_BIN` to the executable path — on macOS that is usually
`/Applications/Godot.app/Contents/MacOS/Godot`.
