// The dev server (dev/serve.mjs) must not leave a node behind: not when the port is taken, and not when it is
// signalled while the node is still starting. Each case runs the real server with a private TMPDIR, finds the node
// it started as a direct child by exact PID, and checks that the child is gone and its temp dir removed.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "../dev/build.mjs";
import { nodeSkipReason } from "./lib/node.mjs";
import { sharedSkipReason } from "./lib/shared.mjs";

const skip = nodeSkipReason() ?? sharedSkipReason();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const childrenOf = (pid) => {
  try {
    return execFileSync("ps", ["-o", "pid=", "--ppid", String(pid)], { encoding: "utf8" }).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return []; // ps exits 1 when there are none
  }
};
const until = async (fn, what, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v && (!Array.isArray(v) || v.length)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Runs dev/serve.mjs with a private TMPDIR. */
function runServer(port, tmp) {
  const proc = spawn(process.execPath, [join(ROOT, "dev/serve.mjs"), "--port", String(port)], {
    cwd: ROOT,
    env: { ...process.env, TMPDIR: tmp },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  const exited = new Promise((resolve) => proc.once("exit", (code, signal) => resolve({ code, signal })));
  return { proc, exited, output: () => out };
}

const nodeDirs = (tmp) => readdirSync(tmp).filter((n) => n.startsWith("sample-recipes-node-"));

describe("dev server cleanup", { skip }, () => {
  for (const delayMs of [0, 1500]) {
    test(`SIGTERM ${delayMs === 0 ? "as soon as the node child exists (while it is starting)" : "1.5 s after the node child exists"} stops that child and removes its temp dir`, async () => {
      const tmp = mkdtempSync(join(tmpdir(), "sample-recipes-devtest-"));
      let server;
      let pids = [];
      try {
        server = runServer(await freePort(), tmp);
        pids = await until(() => childrenOf(server.proc.pid), "the node child");
        if (delayMs === 0) assert.ok(!/dev server:/.test(server.output()), "the server had not finished starting yet");
        await sleep(delayMs);
        server.proc.kill("SIGTERM");
        const done = await Promise.race([server.exited, sleep(15_000).then(() => "hung")]);
        assert.notEqual(done, "hung", `the server did not exit after SIGTERM:\n${server.output()}`);
        for (const pid of pids) assert.equal(alive(pid), false, `node child ${pid} is still running`);
        assert.deepEqual(nodeDirs(tmp), [], "the node's temp dir was not removed");
        assert.equal(childrenOf(server.proc.pid).length, 0);
      } finally {
        for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL"); // exact PIDs we saw, only if the test failed
        if (server && server.proc.exitCode === null) server.proc.kill("SIGKILL");
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  test("a taken port: exits 1 with a message and starts no node at all", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sample-recipes-devtest-"));
    const taken = createServer();
    await new Promise((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const server = runServer(taken.address().port, tmp);
    try {
      const { code } = await server.exited;
      assert.equal(code, 1);
      assert.match(server.output(), /not available.*nothing was started/);
      assert.deepEqual(nodeDirs(tmp), []);
    } finally {
      if (server.proc.exitCode === null) server.proc.kill("SIGKILL");
      await new Promise((resolve) => taken.close(resolve));
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
