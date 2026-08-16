# moinsen-godot

A Claude Code plugin for building games in **Godot 4** — with the feedback loop
closed.

Existing Godot AI tooling mostly drives the *editor*: create a node, save a
scene. That is the easier half. The half that matters is missing, and it is
usually described exactly like this:

> Claude edits files but cannot press play and read the live runtime error.

So the agent writes plausible GDScript, never runs it, and reports success. This
plugin fixes that: it can launch the game, **look at it**, drive it with real
input, step frames, and read script errors with the `res://` file and line.

## What it does

**Runtime bridge** — a small GDScript addon runs inside the game and speaks to
the outside over a local socket.

- `godot_run` / `godot_stop` / `godot_status` — the game stays alive across tool
  calls
- `godot_screenshot` — writes a PNG and returns its path. Works even when the
  window is hidden or behind other windows
- `godot_tree`, `godot_get`, `godot_set`, `godot_call`, `godot_eval` — inspect
  and poke the live scene tree
- `godot_input` — clicks, keys and named input actions, replayed as real events
  so both `_input()` and `Input.is_action_pressed()` see them
- `godot_step`, `godot_pause` — advance an exact number of frames, or slow time
  down, for deterministic verification
- `godot_logs` — engine and script errors, folded one entry per problem, with
  the user-code frame extracted from the GDScript backtrace
- `godot_events` — whatever the game reports about itself via
  `GodotAgent.report()`

**Headless authoring** — `.tscn` and `.tres` are never hand-written. The agent
writes a GDScript builder and Godot serialises the scene itself, so resource
ids, `uid://` references and node paths are correct by construction.

- `godot_check` — import and parse the whole project in seconds, no window
- `godot_run_script` — run a `SceneTree` script headless
- `godot_export` — export via a preset

**Knowledge** — seven skills that load when they are relevant: the verification
loop, scene authoring, Godot 4 GDScript (and the Godot 3 habits that break it),
node selection for 2D and 3D, game feel, game juice, and game design.

Feel and juice are deliberately separate, because the fix is different and
people reach for the wrong one:

|  | **Game feel** | **Juice** |
|---|---|---|
| Question | does the avatar obey me? | does the world react to me? |
| Covers | input forgiveness, latency, movement curves, camera follow | hitstop, flash, knockback, shake, particles, audio, permanence |
| Changes the rules? | yes | no |
| Order | first | second |

Juice cannot rescue bad control — it just makes an unresponsive game noisy. The
`godot-feel-critic` agent measures both axes and tells you which one is actually
the bottleneck.

## Requirements

- **Godot 4** on `PATH` as `godot`, or `GODOT_BIN` pointing at the executable.
  On macOS the bundle is found automatically at
  `/Applications/Godot.app/Contents/MacOS/Godot`. Developed against 4.7.stable.
- **Node 22.18+** — the bridge is TypeScript run directly by Node's native type
  stripping. No build step, no `npm install`, no dependencies.

## Install

```
/plugin marketplace add moinsen-dev/godot-agent
```

Then install the `godot` plugin from `/plugin`, and in your game project:

```
/godot:setup
```

That copies `addons/godot_agent/` into the project, registers the `GodotAgent`
autoload, and verifies the whole loop by launching the game and screenshotting
it. Commit both — the bridge only opens its socket in debug builds, so exported
release builds are unaffected.

## Commands

| Command | What it does |
|---|---|
| `/godot:setup` | Install the bridge and verify the loop end to end |
| `/godot:loop <task>` | Build a feature and keep cycling until it is verified running |
| `/godot:scene <scene>` | Author a scene via a headless builder |
| `/godot:check [--fix]` | Fast headless parse gate |
| `/godot:feel [focus]` | Measure and fix control — responsiveness, forgiveness, curves |
| `/godot:juice [moment]` | Add juice one layer at a time, verifying each before the next |
| `/godot:playtest [focus]` | Play the game and report what actually happens |

## Agents

- **godot-playtester** — plays the game like a person and reports what happens,
  where it breaks, where it stops being interesting
- **godot-feel-critic** — measures control and feedback separately by frame
  stepping and slow motion, and reports which axis is the bottleneck

## Reporting from inside the game

Drop this wherever something interesting happens:

```gdscript
GodotAgent.report("died", {"cause": "spikes", "run_time": elapsed})
```

`godot_events` then drains a timestamped list with frame numbers. For anything
logical — a hit landing twice, a state machine sticking — this beats
screenshots.

## Three things that will otherwise waste your time

- **`--headless` cannot screenshot.** It disables rendering entirely. Use it for
  `godot_check` and build scripts, never for anything visual.
- **An occluded window stops drawing.** `_process` keeps running at full speed
  while `frames_drawn` freezes. The bridge detects this and forces a frame, so
  screenshots keep working in the background.
- **`Input.action_press()` is invisible to `_input()`.** It only moves the
  polling state. `godot_input` replays the mapped event instead, which drives
  both paths.

## Repository layout

```
.claude-plugin/marketplace.json
plugin/
  .claude-plugin/plugin.json
  commands/            slash commands
  agents/              playtester, feel critic
  skills/              six skills, loaded on relevance
  addon/addons/godot_agent/    the GDScript bridge that runs inside the game
  bridge/src/          TypeScript CLI + MCP server (no build step)
examples/smoke/        tiny Godot project used to verify the bridge
```

The bridge is also a plain CLI, which is the fastest way to debug it:

```bash
node plugin/bridge/src/cli.ts run --project examples/smoke
node plugin/bridge/src/cli.ts shot --project examples/smoke
node plugin/bridge/src/cli.ts logs --errors --project examples/smoke
```

## License

MIT
