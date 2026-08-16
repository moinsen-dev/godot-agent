#!/usr/bin/env node
/**
 * MCP stdio server for the Godot bridge.
 *
 * Newline-delimited JSON-RPC 2.0, no dependencies — the plugin has to work
 * straight from a clone, and an npm install that silently fails would leave
 * the tools missing with no error anywhere the user can see.
 *
 * stdout carries protocol only. Everything diagnostic goes to stderr.
 */
import { createInterface } from "node:readline";
import { findProject, godotVersion, findGodot } from "./godot.ts";
import { connect, readLog, readSession, startGame, stopGame } from "./session.ts";
import { installAddon } from "./setup.ts";
import { check, checkScript, exportProject, runScript } from "./headless.ts";

const SERVER = { name: "godot-agent", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (a: any) => Promise<unknown>;
};

const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });
const bool = (d: string) => ({ type: "boolean", description: d });

const projectOf = (a: any) => (a?.project ? String(a.project) : findProject());

/** Run a command against the live game and always close the socket after. */
async function live<T>(a: any, fn: (c: Awaited<ReturnType<typeof connect>>["client"]) => Promise<T>): Promise<T> {
  const { client } = await connect(projectOf(a));
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

const TOOLS: Tool[] = [
  {
    name: "godot_setup",
    description:
      "Install the agent bridge addon into a Godot project and register its autoload. Run once per project before godot_run.",
    inputSchema: { type: "object", properties: { project: str("project directory (default: nearest project.godot)") } },
    run: async (a) => {
      const project = projectOf(a);
      const bin = findGodot();
      return { ...installAddon(project), project, godot: godotVersion(bin) };
    },
  },
  {
    name: "godot_run",
    description:
      "Launch the Godot game with the bridge enabled and wait until it answers. The game keeps running across tool calls. Returns pid and port.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        scene: str("optional scene to run instead of the main scene, e.g. res://levels/test.tscn"),
        headless: bool("run without a window — NOTE: screenshots are impossible in headless mode"),
      },
    },
    run: async (a) => startGame(projectOf(a), { scene: a?.scene, headless: Boolean(a?.headless) }),
  },
  {
    name: "godot_stop",
    description: "Quit the running game.",
    inputSchema: { type: "object", properties: { project: str("project directory") } },
    run: async (a) => ({ stopped: stopGame(projectOf(a)) }),
  },
  {
    name: "godot_status",
    description:
      "Whether a game is running, plus current scene, fps, frames drawn, pause state, viewport size and error count.",
    inputSchema: { type: "object", properties: { project: str("project directory") } },
    run: async (a) => {
      const project = projectOf(a);
      const s = readSession(project);
      if (!s) return { running: false, project };
      const errors = readLog(project, { errorsOnly: true }).entries.length;
      const ping = await live(a, (c) => c.send("ping"));
      return { running: true, ...(ping as object), pid: s.pid, port: s.port, errors };
    },
  },
  {
    name: "godot_screenshot",
    description:
      "Capture the running game's current frame and write it to a PNG. Returns the absolute path — read that file to actually look at the game. Works even when the game window is hidden or behind other windows.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        name: str("file name without extension"),
        scale: num("resize factor, e.g. 0.5 for a smaller image"),
        viewport: str("node path of a specific Viewport/SubViewport to capture"),
      },
    },
    run: async (a) =>
      live(a, (c) => c.send("screenshot", { name: a?.name, scale: a?.scale ?? 1.0, viewport: a?.viewport ?? "" }, 30000)),
  },
  {
    name: "godot_tree",
    description:
      "Scene tree of the running game with class, node path, visibility and position per node. This is how you find the node paths every other tool needs.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        path: str("subtree root node path (default: /root)"),
        depth: num("how deep to descend (default 6)"),
        props: { type: "array", items: { type: "string" }, description: "extra properties to include per node" },
      },
    },
    run: async (a) => live(a, (c) => c.send("tree", { path: a?.path ?? "", depth: a?.depth ?? 6, props: a?.props ?? [] })),
  },
  {
    name: "godot_get",
    description: "Read a property of a live node. Omit `prop` to dump every editor-visible property.",
    inputSchema: {
      type: "object",
      properties: { project: str("project directory"), path: str("node path"), prop: str("property name") },
      required: ["path"],
    },
    run: async (a) => live(a, (c) => c.send("get", { path: a.path, prop: a?.prop ?? "" })),
  },
  {
    name: "godot_set",
    description:
      'Write a property on a live node. Godot-typed values go in as {"__gd": "Vector2(10, 20)"} — any literal str_to_var accepts.',
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        path: str("node path"),
        prop: str("property name"),
        value: { description: "new value" },
      },
      required: ["path", "prop", "value"],
    },
    run: async (a) => live(a, (c) => c.send("set", { path: a.path, prop: a.prop, value: a.value })),
  },
  {
    name: "godot_call",
    description: "Call a method on a live node and return its result.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        path: str("node path"),
        method: str("method name"),
        args: { type: "array", description: "arguments" },
      },
      required: ["path", "method"],
    },
    run: async (a) => live(a, (c) => c.send("call", { path: a.path, method: a.method, args: a?.args ?? [] })),
  },
  {
    name: "godot_eval",
    description:
      "Evaluate a GDScript expression inside the running game. With `path`, it is evaluated against that node, so `health` or `get_children().size()` work directly. Engine, Input, InputMap, Time, OS and ProjectSettings are in scope.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        code: str("expression, e.g. position.x or velocity.length()"),
        path: str("node to evaluate against"),
      },
      required: ["code"],
    },
    run: async (a) => live(a, (c) => c.send("eval", { code: a.code, path: a?.path ?? "" })),
  },
  {
    name: "godot_input",
    description:
      "Drive the game: click at a coordinate, move the mouse, press a key, or fire a named input action. Actions replay the real event from the InputMap, so both _input() handlers and Input.is_action_pressed() polling see them.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        kind: { type: "string", enum: ["click", "move", "key", "action"], description: "what to inject" },
        x: num("x for click/move"),
        y: num("y for click/move"),
        keycode: num("Godot keycode for kind=key"),
        action: str("action name for kind=action, must exist in the InputMap"),
        pressed: bool("press (true) or release (false) — kind=action"),
        hold: bool("keep it held instead of pressing and releasing"),
        step: num(
          "advance exactly this many frames around the injection, then restore the pause state. Required when the game is paused — a paused tree drops injected events. This is how you measure how many frames an effect stays visible.",
        ),
      },
      required: ["kind"],
    },
    run: async (a) => live(a, (c) => c.send("input", a, 30000)),
  },
  {
    name: "godot_step",
    description:
      "Advance the game a fixed number of frames while it stays paused otherwise. Use this to verify animation, physics or timing deterministically instead of sleeping.",
    inputSchema: {
      type: "object",
      properties: { project: str("project directory"), frames: num("frames to advance (default 1)") },
    },
    run: async (a) => live(a, (c) => c.send("step", { frames: a?.frames ?? 1 }, 60000)),
  },
  {
    name: "godot_pause",
    description: "Pause or resume the game, and/or change Engine.time_scale (e.g. 0.2 to inspect fast action in slow motion).",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        paused: bool("pause state"),
        time_scale: num("engine time scale, 1.0 is normal"),
      },
    },
    run: async (a) => {
      const args: Record<string, unknown> = {};
      if (a?.paused !== undefined) args.paused = a.paused;
      if (a?.time_scale !== undefined) args.time_scale = a.time_scale;
      return live(a, (c) => c.send("pause", args));
    },
  },
  {
    name: "godot_logs",
    description:
      "Engine and script errors from the running game, each folded into one entry with the res:// file and line from the GDScript backtrace. This is the tool that tells you whether your change actually worked.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        errors_only: bool("drop warnings"),
        tail: num("how many raw log lines to include"),
      },
    },
    run: async (a) => readLog(projectOf(a), { errorsOnly: Boolean(a?.errors_only), tail: a?.tail }),
  },
  {
    name: "godot_events",
    description:
      "Drain the events the game reported via GodotAgent.report(kind, data) — the game's own account of what happened (deaths, pickups, state changes).",
    inputSchema: {
      type: "object",
      properties: { project: str("project directory"), clear: bool("clear the buffer after reading (default true)") },
    },
    run: async (a) => live(a, (c) => c.send("events", { clear: a?.clear ?? true })),
  },
  {
    name: "godot_check",
    description:
      "Headless import and parse gate for the whole project — no window, no running game. Fast, and the right thing to run after every edit before launching.",
    inputSchema: { type: "object", properties: { project: str("project directory") } },
    run: async (a) => {
      const r = await check(projectOf(a));
      return { ok: r.ok, errors: r.entries.filter((e) => e.level === "error"), warnings: r.entries.filter((e) => e.level === "warning").length };
    },
  },
  {
    name: "godot_run_script",
    description:
      "Run a GDScript that extends SceneTree headless. This is how scenes and resources should be authored: build the node graph in code and let Godot serialise the .tscn, instead of hand-writing scene text.",
    inputSchema: {
      type: "object",
      properties: { project: str("project directory"), script: str("res:// path of the script") },
      required: ["script"],
    },
    run: async (a) => {
      const r = await runScript(projectOf(a), a.script);
      return { ok: r.ok, stdout: r.stdout.trim(), errors: r.entries.filter((e) => e.level === "error") };
    },
  },
  {
    name: "godot_check_script",
    description: "Parse a single GDScript file without running it.",
    inputSchema: {
      type: "object",
      properties: { project: str("project directory"), script: str("res:// path") },
      required: ["script"],
    },
    run: async (a) => {
      const r = await checkScript(projectOf(a), a.script);
      return { ok: r.ok, entries: r.entries };
    },
  },
  {
    name: "godot_export",
    description: "Export the project using a preset from export_presets.cfg.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("project directory"),
        preset: str("preset name"),
        out: str("output path"),
        debug: bool("export a debug build"),
      },
      required: ["preset", "out"],
    },
    run: async (a) => {
      const r = await exportProject(projectOf(a), a.preset, a.out, a?.debug ? "debug" : "release");
      return { ok: r.ok, errors: r.entries.filter((e) => e.level === "error") };
    },
  },
];

// --------------------------------------------------------------------------
// JSON-RPC plumbing
// --------------------------------------------------------------------------

function write(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id: unknown, result: unknown) {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, code: number, message: string) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg: any) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications carry no id and want no response

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `unknown tool '${params?.name}'`);
      try {
        const result = await tool.run(params?.arguments ?? {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e: any) {
        // Report tool failures as results, not protocol errors, so the model
        // can read the message and act on it.
        return reply(id, {
          isError: true,
          content: [{ type: "text", text: String(e?.message ?? e) }],
        });
      }
    }

    default:
      if (id === undefined) return;
      return fail(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: any;
  try {
    msg = JSON.parse(text);
  } catch {
    return fail(null, -32700, "parse error");
  }
  handle(msg).catch((e) => {
    process.stderr.write(`[godot-agent-mcp] ${String(e?.stack ?? e)}\n`);
    if (msg?.id !== undefined) fail(msg.id, -32603, String(e?.message ?? e));
  });
});
