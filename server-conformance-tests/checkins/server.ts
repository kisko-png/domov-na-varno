import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const BUILD = process.env.WORKING_FOLDER ?? process.cwd();
let built = false;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export interface Service {
  base: string;
  stop: () => Promise<void>;
  log: () => string;
}

/** Runs `npm run build` once across all test files, behind a lock dir in the build folder. */
async function buildOnce(): Promise<void> {
  const marker = path.join(BUILD, ".conformance-built");
  const lock = path.join(BUILD, ".conformance-build-lock");
  const deadline = Date.now() + 90_000;
  while (!existsSync(marker)) {
    let mine = false;
    try {
      mkdirSync(lock);
      mine = true;
    } catch {
      /* another file is building */
    }
    if (mine) {
      execSync("npm run build", { cwd: BUILD, stdio: "pipe" });
      writeFileSync(marker, "");
      return;
    }
    if (Date.now() > deadline) throw new Error("waited 90 s for build");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Builds (once per run) and starts the service on a free port with a fresh database. */
export async function startService(): Promise<Service> {
  if (!built) {
    await buildOnce();
    built = true;
  }
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), "domov-"));
  const child: ChildProcess = spawn("npm", ["start"], {
    cwd: BUILD,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: path.join(dir, "domov.db"),
      LLM_PROVIDER: "fake",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const base = `http://127.0.0.1:${port}`;
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.pid === undefined) return;
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/sim/now`);
      if (r.ok) return { base, stop, log: () => out };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(
    `service did not answer on ${base} within 30 s; output:\n${out}`,
  );
}

export interface Res {
  status: number;
  body: unknown;
}

export async function call(
  svc: Service,
  method: string,
  url: string,
  body?: unknown,
  token?: string,
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers["X-Patient-Token"] = token;
  const r = await fetch(svc.base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body: parsed };
}

/** Reads a property of an unknown JSON value by dotted path. */
export function get(v: unknown, p: string): unknown {
  let cur: unknown = v;
  for (const k of p.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function show(r: Res): string {
  return `status ${r.status}, body ${JSON.stringify(r.body)}`;
}
