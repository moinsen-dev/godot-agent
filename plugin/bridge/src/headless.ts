import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findGodot } from "./godot.ts";
import { parseGodotLog, type LogEntry } from "./session.ts";

const run = promisify(execFile);

export type HeadlessResult = {
  ok: boolean;
  code: number;
  entries: LogEntry[];
  stdout: string;
  stderr: string;
};

async function godot(project: string, args: string[], timeout = 180000): Promise<HeadlessResult> {
  const bin = findGodot();
  try {
    const { stdout, stderr } = await run(bin, ["--headless", "--path", project, ...args], {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
    const entries = parseGodotLog(stdout + "\n" + stderr);
    return { ok: !entries.some((e) => e.level === "error"), code: 0, entries, stdout, stderr };
  } catch (e: any) {
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? String(e.message ?? e);
    return { ok: false, code: e.code ?? 1, entries: parseGodotLog(stdout + "\n" + stderr), stdout, stderr };
  }
}

/**
 * Import the project and surface every parse error — the cheap gate to run
 * before ever launching the game.
 */
export function check(project: string): Promise<HeadlessResult> {
  return godot(project, ["--editor", "--quit"]);
}

/** Parse a single script without running it. */
export function checkScript(project: string, resPath: string): Promise<HeadlessResult> {
  return godot(project, ["--check-only", "--script", resPath]);
}

/**
 * Run a SceneTree/MainLoop script headless.
 *
 * This is how scenes and resources get authored: the agent writes a build
 * script, Godot runs it and serialises the .tscn itself, so resource ids and
 * node paths are always internally consistent.
 */
export function runScript(project: string, resPath: string): Promise<HeadlessResult> {
  return godot(project, ["--script", resPath]);
}

export function exportProject(
  project: string,
  preset: string,
  out: string,
  mode: "release" | "debug" = "release",
): Promise<HeadlessResult> {
  return godot(project, [mode === "release" ? "--export-release" : "--export-debug", preset, out], 600000);
}
