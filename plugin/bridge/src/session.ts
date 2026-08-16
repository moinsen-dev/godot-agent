import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeClient, freePort, portInUse } from "./client.ts";
import { findGodot, stateDir } from "./godot.ts";

export type Session = {
  pid: number;
  port: number;
  project: string;
  scene: string | null;
  logFile: string;
  godotBin: string;
  startedAt: string;
};

export type LogEntry = {
  level: "error" | "warning";
  message: string;
  at?: string;
  file?: string;
  line?: number;
  backtrace?: string[];
};

const sessionFile = (project: string) => join(stateDir(project), "session.json");
const logFile = (project: string) => join(stateDir(project), "run.log");

export function readSession(project: string): Session | null {
  const f = sessionFile(project);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8")) as Session;
    process.kill(s.pid, 0); // throws if the process is gone
    return s;
  } catch {
    return null;
  }
}

export function clearSession(project: string) {
  rmSync(sessionFile(project), { force: true });
}

/**
 * Launch the project with the bridge enabled and wait until its socket answers.
 *
 * The game is spawned detached so it outlives this CLI invocation — every later
 * command reconnects to the same running game instead of restarting it.
 */
export async function startGame(
  project: string,
  opts: { scene?: string; port?: number; headless?: boolean; extraArgs?: string[] } = {},
): Promise<Session> {
  const existing = readSession(project);
  if (existing) return existing;

  mkdirSync(stateDir(project), { recursive: true });
  const bin = findGodot();
  const port = opts.port ?? (await freePort());
  const log = logFile(project);
  writeFileSync(log, "");
  const fd = openSync(log, "a");

  const args = ["--path", project];
  if (opts.headless) args.push("--headless");
  if (opts.scene) args.push(opts.scene);
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  const child = spawn(bin, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    // The addon reads the port from the environment, which sidesteps Godot's
    // own command-line parsing entirely.
    env: { ...process.env, GODOT_AGENT_PORT: String(port) },
  });
  child.unref();

  const session: Session = {
    pid: child.pid!,
    port,
    project,
    scene: opts.scene ?? null,
    logFile: log,
    godotBin: bin,
    startedAt: new Date().toISOString(),
  };

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await portInUse(port)) {
      writeFileSync(sessionFile(project), JSON.stringify(session, null, 2));
      return session;
    }
    try {
      process.kill(child.pid!, 0);
    } catch {
      const tail = readFileSync(log, "utf8").trim().split("\n").slice(-25).join("\n");
      throw new Error(`Godot exited before the bridge came up.\n\n${tail}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `The game started but the bridge never opened port ${port}.\n` +
      `Is the autoload registered? Check that project.godot has GodotAgent under [autoload].\n\n` +
      readFileSync(log, "utf8").trim().split("\n").slice(-25).join("\n"),
  );
}

export function stopGame(project: string): boolean {
  const s = readSession(project);
  clearSession(project);
  if (!s) return false;
  try {
    process.kill(s.pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function connect(project: string): Promise<{ client: BridgeClient; session: Session }> {
  const session = readSession(project);
  if (!session) {
    throw new Error("No running game. Start one first (`godot-agent run`).");
  }
  const client = new BridgeClient(session.port);
  await client.connect();
  return { client, session };
}

/**
 * Godot writes errors as a message line followed by an indented `at:` line.
 * Fold those pairs back together so an agent sees one entry per problem.
 */
/**
 * Godot reports leaked RIDs and still-referenced resources as ERROR while
 * shutting down. They say nothing about the code under test, and treating them
 * as failures makes every headless gate red for no reason.
 */
const SHUTDOWN_NOISE = [
  /RID allocations? of type .* (were|was) leaked at exit/i,
  /RIDs of type ".*" were leaked/i,
  /ObjectDB instances were leaked at exit/i,
  /resources still in use at exit/i,
];

export function parseGodotLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  const lines = text.split("\n");
  const head = /^\s*(USER )?(SCRIPT )?(ERROR|WARNING):\s*(.*)$/;
  // The path may itself contain colons (`res://main.gd`), so anchor on the
  // trailing `:<digits>)` rather than forbidding colons in the file group.
  const at = /^\s*at:\s*(.*?)\s*\((.+):(\d+)\)\s*$/;
  const frame = /^\s*\[\d+\]\s*(.*?)\s*\((.+):(\d+)\)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const message = m[4].trim();
    if (SHUTDOWN_NOISE.some((re) => re.test(message))) continue;

    const entry: LogEntry = {
      level: m[3] === "ERROR" ? "error" : "warning",
      message,
    };

    // Consume the indented block that belongs to this report: the `at:` line
    // and, since 4.5, a GDScript backtrace. The backtrace is what actually
    // points at the offending line in user code.
    const backtrace: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) break;
      if (head.test(line)) break;

      const a = at.exec(line);
      if (a && entry.file === undefined) {
        entry.at = a[1];
        entry.file = a[2];
        entry.line = Number(a[3]);
        continue;
      }
      const f = frame.exec(line);
      if (f) {
        backtrace.push(`${f[1]} (${f[2]}:${f[3]})`);
        // Prefer the user-code frame over the engine's own source location.
        if (f[2].startsWith("res://")) {
          entry.at = f[1];
          entry.file = f[2];
          entry.line = Number(f[3]);
        }
        continue;
      }
      if (/GDScript backtrace/i.test(line)) continue;
      break;
    }
    if (backtrace.length) entry.backtrace = backtrace;
    i = j - 1;
    out.push(entry);
  }
  return out;
}

export function readLog(project: string, opts: { tail?: number; errorsOnly?: boolean } = {}) {
  const f = logFile(project);
  if (!existsSync(f)) return { raw: "", entries: [] as LogEntry[], bytes: 0 };
  const raw = readFileSync(f, "utf8");
  const entries = parseGodotLog(raw);
  const tail = opts.tail ?? 80;
  return {
    raw: raw.split("\n").slice(-tail).join("\n"),
    entries: opts.errorsOnly ? entries.filter((e) => e.level === "error") : entries,
    bytes: statSync(f).size,
  };
}
