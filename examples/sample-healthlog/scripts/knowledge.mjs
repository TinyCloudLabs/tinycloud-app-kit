// Regenerates knowledge/ from manifest.json + schema.sql + knowledge-src/ with the kit's scripts/okf.mjs
// (two directories up from this example), or checks it.
//   node scripts/knowledge.mjs generate [--date YYYY-MM-DD]
//   node scripts/knowledge.mjs check
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const okfPath = () => join(ROOT, "../../scripts/okf.mjs");

export function okf(args, cwd = ROOT) {
  return spawnSync(process.execPath, [okfPath(), ...args], { cwd, encoding: "utf8" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = cmd === "generate"
    ? ["generate", "manifest.json", "--sql", "schema.sql", "--src", "knowledge-src", "--out", "knowledge", ...rest]
    : cmd === "check" ? ["check", "knowledge", "--manifest", "manifest.json"] : null;
  if (!args) { console.error("usage: knowledge.mjs generate|check"); process.exit(2); }
  const r = okf(args);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}
