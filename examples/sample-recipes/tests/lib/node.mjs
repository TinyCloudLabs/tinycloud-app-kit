// Starts a throwaway native tinycloud-node (no Docker) on a free port with a
// private temp data dir. The binary is a prebuilt `tinycloud` (tinycloud-node release
// build) named by $TC_NODE_BIN. Everything is deleted on stop().
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";


/** Why node-backed tests cannot run here, or undefined when they can. */
export function nodeSkipReason() {
  const bin = process.env.TC_NODE_BIN;
  if (!bin) return "TC_NODE_BIN is not set (path to a prebuilt tinycloud-node `tinycloud` binary); skipping node-backed tests";
  if (!existsSync(bin)) return `TC_NODE_BIN=${bin} does not exist; skipping node-backed tests`;
  return undefined;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Every node started by this process and not yet stopped. `stopAllNodes()` stops exactly these children (by
// handle, never by pattern) and removes their temp dirs; it is safe to call more than once and from a signal handler.
const live = new Set();

async function release(entry) {
  if (!live.delete(entry)) return;
  const { child, dir } = entry;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  rmSync(dir, { recursive: true, force: true });
}

export const stopAllNodes = () => Promise.all([...live].map(release));

export async function startNode() {
  const reason = nodeSkipReason();
  if (reason) throw new Error(reason);
  const bin = process.env.TC_NODE_BIN;
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "sample-recipes-node-"));
  const entry = { child: null, dir };
  live.add(entry); // registered before anything can fail, so a signal during start-up still cleans up
  try {
    return await launch(entry, bin, port, dir);
  } catch (e) {
    await release(entry);
    throw e;
  }
}

async function launch(entry, bin, port, dir) {
  // Minimal config: static root key (from env), local blocks, file staging.
  writeFileSync(join(dir, "tinycloud.toml"), [
    "[global]", 'log_level = "normal"', "cors = true", "",
    "[global.storage]", 'staging = "FileSystem"', "",
    "[global.storage.blocks]", 'type = "Local"', "",
    "[global.keys]", 'type = "Static"', "",
  ].join("\n"));
  const child = spawn(bin, [], {
    cwd: dir,
    env: {
      ...process.env,
      TINYCLOUD_KEYS__SECRET: "ab".repeat(32),
      TINYCLOUD_STORAGE_DATADIR: join(dir, "data"),
      ROCKET_ADDRESS: "127.0.0.1",
      ROCKET_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  entry.child = child;
  let log = "";
  const collect = (c) => { log = (log + String(c)).slice(-8000); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const host = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`node exited early:\n${log}`);
    try {
      const r = await fetch(`${host}/info`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`node not ready:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    host,
    log: () => log,
    stop: () => release(entry),
  };
}
