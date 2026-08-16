import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

/** Where a Godot 4 binary tends to live, per platform. */
const CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Godot.app/Contents/MacOS/Godot",
    join(homedir(), "Applications/Godot.app/Contents/MacOS/Godot"),
    "/Applications/Godot_mono.app/Contents/MacOS/Godot",
  ],
  linux: [
    "/usr/local/bin/godot",
    "/usr/bin/godot",
    join(homedir(), ".local/bin/godot"),
  ],
  win32: [
    "C:\\Program Files\\Godot\\Godot.exe",
  ],
};

function onPath(name: string): string | null {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(which, [name], { encoding: "utf8" }).trim().split("\n")[0];
    return out ? out.trim() : null;
  } catch {
    return null;
  }
}

/** Resolve the Godot 4 executable, or throw with a message that says what to do. */
export function findGodot(): string {
  const fromEnv = process.env.GODOT_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`GODOT_BIN points at a missing file: ${fromEnv}`);
    return fromEnv;
  }
  for (const name of ["godot", "godot4"]) {
    const hit = onPath(name);
    if (hit) return hit;
  }
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "No Godot 4 binary found. Install Godot, put it on PATH as `godot`, or set GODOT_BIN=/path/to/Godot.",
  );
}

export function godotVersion(bin: string): string {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim().split("\n").pop() ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Walk up from `start` looking for the directory that holds project.godot. */
export function findProject(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "project.godot"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // A single nested project is a common layout — accept it rather than failing.
  const nested = readdirSync(resolve(start), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(resolve(start), e.name, "project.godot")))
    .map((e) => join(resolve(start), e.name));
  if (nested.length === 1) return nested[0];
  throw new Error(`No project.godot found at or above ${resolve(start)}.`);
}

export function stateDir(project: string): string {
  return join(project, ".godot-agent");
}
