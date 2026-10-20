// Regenerates knowledge/ from manifest.json + schema.sql + knowledge-src/ with the app-kit's
// okf.mjs (scripts/okf.mjs in TinyCloudLabs/tinycloud-app-kit), or checks it.
//   node scripts/knowledge.mjs generate [--date YYYY-MM-DD]
//   node scripts/knowledge.mjs check
// okf.mjs is found in $TC_APP_KIT, else two directories up (this app lives in the kit at
// examples/sample-recipes/), else ~/scratch/t3b/tinycloud-app-kit.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Path of okf.mjs, or undefined when no kit checkout can be found. */
export function okfPath() {
  const candidates = [process.env.TC_APP_KIT, resolve(ROOT, "../.."), join(homedir(), "scratch/t3b/tinycloud-app-kit")].filter(Boolean);
  return candidates.map((kit) => join(kit, "scripts/okf.mjs")).find((p) => existsSync(p));
}

export function okf(args, cwd = ROOT) {
  const p = okfPath();
  if (!p) throw new Error("okf.mjs not found: set TC_APP_KIT to a checkout of TinyCloudLabs/tinycloud-app-kit");
  return spawnSync(process.execPath, [p, ...args], { cwd, encoding: "utf8" });
}

export const GENERATE_ARGS = ["generate", "manifest.json", "--sql", "schema.sql", "--src", "knowledge-src", "--out", "knowledge"];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = cmd === "generate" ? [...GENERATE_ARGS, ...rest] : cmd === "check" ? ["check", "knowledge", "--manifest", "manifest.json"] : null;
  if (!args) {
    console.error("usage: knowledge.mjs generate|check");
    process.exit(2);
  }
  const r = okf(args);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}
