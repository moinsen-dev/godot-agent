#!/usr/bin/env node
import { parseArgs } from "node:util";
import { findProject, godotVersion, findGodot } from "./godot.ts";
import { connect, readLog, readSession, startGame, stopGame } from "./session.ts";
import { installAddon } from "./setup.ts";
import { check, checkScript, exportProject, runScript } from "./headless.ts";

const USAGE = `godot-agent — drive a running Godot game from the outside

  setup                     install the bridge addon into the project
  run [scene] [--headless]  launch the game with the bridge enabled
  stop                      quit the running game
  status                    is a game running, which scene, how many errors

  shot [--name N] [--scale] screenshot the running game -> writes a PNG, prints its path
  tree [--path P] [--depth] scene tree of the running game
  get <path> [prop]         read a node property (all editor properties if omitted)
  set <path> <prop> <val>   write a node property
  call <path> <method> ...  call a method on a node
  eval <code> [--path P]    evaluate an expression, optionally against a node

  click <x> <y> [--step N]  inject a mouse click (--step advances N frames,
  key <keycode> [--step N]    needed while paused: a paused tree drops events)
  action <name> [--hold]    fire an input action; --hold keeps it down until
                [--release]   the same action is sent with --release
  step [frames]             advance N frames while paused
  pause | resume            freeze / unfreeze the game

  logs [--errors] [--tail]  engine + script errors from the running game
  events                    things the game reported via GodotAgent.report()

  check                     headless import + parse gate (no window)
  check-script <res://x.gd> parse one script only
  script <res://build.gd>   run a SceneTree script headless (scene authoring)
  export <preset> <out>     export the project

Options: --project <dir> (default: nearest project.godot), --json
`;

function out(v: unknown, json: boolean) {
  if (json || typeof v !== "string") console.log(JSON.stringify(v, null, 2));
  else console.log(v);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      project: { type: "string" },
      json: { type: "boolean", default: false },
      headless: { type: "boolean", default: false },
      errors: { type: "boolean", default: false },
      hold: { type: "boolean", default: false },
      release: { type: "boolean", default: false },
      name: { type: "string" },
      path: { type: "string" },
      scale: { type: "string" },
      depth: { type: "string" },
      tail: { type: "string" },
      port: { type: "string" },
      step: { type: "string" },
    },
  });

  const cmd = positionals[0];
  const json = Boolean(values.json);
  if (!cmd || cmd === "help" || values.help) {
    console.log(USAGE);
    return;
  }

  const project = (values.project as string) ?? findProject();

  // --- lifecycle -----------------------------------------------------------
  if (cmd === "setup") {
    const r = installAddon(project);
    const bin = findGodot();
    out({ ...r, project, godot: godotVersion(bin), bin }, true);
    return;
  }

  if (cmd === "run") {
    const s = await startGame(project, {
      scene: positionals[1],
      headless: Boolean(values.headless),
      port: values.port ? Number(values.port) : undefined,
    });
    out({ started: true, pid: s.pid, port: s.port, scene: s.scene }, true);
    return;
  }

  if (cmd === "stop") {
    out({ stopped: stopGame(project) }, true);
    return;
  }

  if (cmd === "status") {
    const s = readSession(project);
    if (!s) {
      out({ running: false, project }, true);
      return;
    }
    const log = readLog(project, { errorsOnly: true });
    const { client } = await connect(project);
    const ping = await client.send("ping");
    client.close();
    out({ running: true, ...ping, pid: s.pid, port: s.port, errors: log.entries.length }, true);
    return;
  }

  // --- headless (no running game needed) -----------------------------------
  if (cmd === "check") {
    const r = await check(project);
    out({ ok: r.ok, errors: r.entries.filter((e) => e.level === "error"), warnings: r.entries.filter((e) => e.level === "warning").length }, true);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === "check-script") {
    const r = await checkScript(project, positionals[1]);
    out({ ok: r.ok, entries: r.entries }, true);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === "script") {
    const r = await runScript(project, positionals[1]);
    out({ ok: r.ok, stdout: r.stdout.trim(), errors: r.entries.filter((e) => e.level === "error") }, true);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === "export") {
    const r = await exportProject(project, positionals[1], positionals[2], values.release ? "release" : "release");
    out({ ok: r.ok, errors: r.entries.filter((e) => e.level === "error") }, true);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === "logs") {
    const r = readLog(project, { errorsOnly: Boolean(values.errors), tail: values.tail ? Number(values.tail) : undefined });
    out({ entries: r.entries, tail: r.raw }, true);
    return;
  }

  // --- everything below talks to the running game --------------------------
  const { client } = await connect(project);
  try {
    switch (cmd) {
      case "shot": {
        const r = await client.send("screenshot", {
          name: values.name,
          scale: values.scale ? Number(values.scale) : 1.0,
        });
        out(r, true);
        break;
      }
      case "tree":
        out(await client.send("tree", {
          path: values.path ?? "",
          depth: values.depth ? Number(values.depth) : 6,
        }), true);
        break;
      case "get":
        out(await client.send("get", { path: positionals[1], prop: positionals[2] ?? "" }), true);
        break;
      case "set":
        out(await client.send("set", {
          path: positionals[1],
          prop: positionals[2],
          value: coerce(positionals[3]),
        }), true);
        break;
      case "call":
        out(await client.send("call", {
          path: positionals[1],
          method: positionals[2],
          args: positionals.slice(3).map(coerce),
        }), true);
        break;
      case "eval":
        out(await client.send("eval", { code: positionals[1], path: values.path ?? "" }), true);
        break;
      case "click":
        out(await client.send("input", {
          kind: "click",
          x: Number(positionals[1]),
          y: Number(positionals[2]),
          step: values.step ? Number(values.step) : 0,
        }, 30000), true);
        break;
      case "key":
        out(await client.send("input", {
          kind: "key",
          keycode: Number(positionals[1]),
          step: values.step ? Number(values.step) : 0,
        }, 30000), true);
        break;
      case "action":
        out(await client.send("input", {
          kind: "action",
          action: positionals[1],
          pressed: !values.release,
          hold: Boolean(values.hold),
          step: values.step ? Number(values.step) : 0,
        }, 30000), true);
        break;
      case "step":
        out(await client.send("step", { frames: Number(positionals[1] ?? 1) }, 60000), true);
        break;
      case "pause":
        out(await client.send("pause", { paused: true }), true);
        break;
      case "resume":
        out(await client.send("pause", { paused: false }), true);
        break;
      case "events":
        out(await client.send("events", {}), true);
        break;
      default:
        console.error(`unknown command '${cmd}'\n`);
        console.log(USAGE);
        process.exitCode = 2;
    }
  } finally {
    client.close();
  }
}

/** Numbers and booleans on the command line should not arrive as strings. */
function coerce(s: string | undefined): unknown {
  if (s === undefined) return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  // Godot-native literals like "Vector2(4, 8)" round-trip through str_to_var.
  if (/^[A-Z][A-Za-z0-9_]*\(.*\)$/.test(s)) return { __gd: s };
  return s;
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
});
