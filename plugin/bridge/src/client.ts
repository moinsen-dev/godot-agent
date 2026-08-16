import net from "node:net";

export type Reply = { ok: boolean; result?: any; error?: string };

/**
 * Newline-delimited JSON client for the in-game bridge.
 *
 * Replies carry the request id, so commands that need frames (screenshot,
 * step) may complete out of order without confusing the caller.
 */
export class BridgeClient {
  private sock: net.Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

  private port: number;
  private host: string;

  constructor(port: number, host = "127.0.0.1") {
    this.port = port;
    this.host = host;
  }

  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const host = this.host;
      const sock = net.createConnection({ port: this.port, host });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`timed out connecting to the game bridge on ${host}:${this.port}`));
      }, timeoutMs);

      sock.setNoDelay(true);
      sock.once("connect", () => {
        clearTimeout(timer);
        this.sock = sock;
        sock.on("data", (chunk) => this.onData(chunk));
        sock.on("close", () => this.failAll(new Error("game bridge closed the connection")));
        sock.on("error", (e) => this.failAll(e));
        resolve();
      });
      sock.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  private onData(chunk: Buffer) {
    this.buf += chunk.toString("utf8");
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl === -1) break;
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        waiter.resolve(msg as Reply);
      }
    }
  }

  private failAll(err: Error) {
    for (const [, w] of this.pending) w.reject(err);
    this.pending.clear();
    this.sock = null;
  }

  /** Send a command and resolve with its result, throwing on a bridge-side error. */
  async send(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<any> {
    if (!this.sock) throw new Error("not connected to the game bridge");
    const id = this.nextId++;
    const reply = await new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`command '${cmd}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.sock!.write(JSON.stringify({ id, cmd, args }) + "\n");
    });
    if (!reply.ok) throw new Error(reply.error ?? `command '${cmd}' failed`);
    return reply.result;
  }

  close() {
    this.sock?.end();
    this.sock = null;
  }
}

/** True if something is already listening there. */
export function portInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 500);
  });
}

export async function freePort(start = 9080): Promise<number> {
  for (let p = start; p < start + 50; p++) {
    if (!(await portInUse(p))) return p;
  }
  throw new Error(`no free port in ${start}..${start + 50}`);
}
