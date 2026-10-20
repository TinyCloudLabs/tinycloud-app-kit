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

export async function startNode() {
  const reason = nodeSkipReason();
  if (reason) throw new Error(reason);
  const bin = process.env.TC_NODE_BIN;
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "sample-recipes-node-"));
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
    if (Date.now() > deadline) { child.kill("SIGKILL"); throw new Error(`node not ready:\n${log}`); }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    host,
    log: () => log,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => { child.once("exit", r); setTimeout(() => { child.kill("SIGKILL"); r(); }, 3000); });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
