# Working on this plugin

This repo *is* the plugin. When editing it, the constraints below are the ones
that break things silently.

## The bridge runs as TypeScript with no build step

`plugin/bridge/src/*.ts` is executed directly by Node's native type stripping
(Node 22.18+). There is no `tsc`, no `node_modules`, and no `package.json` — the
plugin must work straight from a clone, because an MCP server that fails to
start leaves its tools missing with no error the user can see.

Type stripping erases types; it never generates code. So these do **not** work
and fail at load time:

- constructor parameter properties (`constructor(private port: number)`)
- `enum`
- `namespace`
- decorators with emit
- `import x = require(...)`

Write the plain-JavaScript equivalent instead — explicit field assignment,
`const X = {...} as const` for enums. Keep the zero-dependency rule: adding a
dependency reintroduces an install step.

## The addon is copied into user projects

`plugin/addon/addons/godot_agent/` is copied verbatim into the user's Godot
project by `godot_setup`. After changing it, re-run `setup` on any test project
— an already-installed copy does not update itself.

It must stay conservative: it opens a socket only in debug builds, skips
`--script` tool runs entirely (autoloads still instantiate there, so without the
guard every headless build would grab the port), and runs with
`PROCESS_MODE_ALWAYS` so it keeps answering while the game is paused.

## Verify against the real engine

`examples/smoke/` is a tiny Godot project for exactly this. The loop:

```bash
node plugin/bridge/src/cli.ts setup --project examples/smoke
node plugin/bridge/src/cli.ts run   --project examples/smoke
node plugin/bridge/src/cli.ts shot  --project examples/smoke
node plugin/bridge/src/cli.ts stop  --project examples/smoke
```

Read the PNG. Every behavioural claim about this plugin should come from a run
against Godot, not from reading the code — the three bugs that shaped the
current design (occluded windows stop drawing, `Input.action_press()` bypasses
`_input()`, `res://` paths break a naive `at:` regex) were all invisible on
paper.

## Godot facts this design rests on

- `--headless` disables rendering, so screenshots are impossible there.
- `RenderingServer.frame_post_draw` never fires for an occluded window; the
  screenshot path detects a frozen `frames_drawn` and calls
  `RenderingServer.force_draw()` instead.
- `PackedScene.pack()` drops any descendant whose `owner` is not the packed root.
- Godot prints errors as a message line plus an indented `at:` line and, since
  4.5, a GDScript backtrace. The backtrace holds the user-code frame; the `at:`
  line often points into engine C++ source.
