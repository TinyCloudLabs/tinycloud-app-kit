// Writes release.json: the files of the app bundle with sha256 (dev/, tests/, scripts/ are not shipped).
// Usage: node scripts/make-release.mjs [--check]   (--check fails if release.json is stale)
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function buildRelease() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const paths = ["manifest.json", "schema.sql", "app.jsx", ...walk(join(ROOT, "knowledge")).map((p) => relative(ROOT, p))]
    .map((p) => p.split("\\").join("/"))
    .sort();
  const files = paths.map((path) => {
    const buf = readFileSync(join(ROOT, path));
    return { path, sha256: sha256(buf), size: buf.length };
  });
  // digest = sha256 over the sorted "<path> <sha256>" lines (same rule as the catalog's bundle digest)
  const digest = sha256(files.map((f) => `${f.path} ${f.sha256}`).join("\n"));
  return {
    schema: "tinycloud.app-release/v1",
    app_id: manifest.app_id,
    version: manifest.appVersion,
    ...(manifest.forked_from ? { forked_from: manifest.forked_from } : {}),
    files,
    digest,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = `${JSON.stringify(buildRelease(), null, 2)}\n`;
  const file = join(ROOT, "release.json");
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(file, "utf8"); } catch {}
    if (cur !== next) { console.error("release.json is stale: run `npm run release`"); process.exit(1); }
    console.log("release.json is up to date");
  } else {
    writeFileSync(file, next);
    console.log(`wrote release.json (${JSON.parse(next).files.length} files)`);
  }
}
