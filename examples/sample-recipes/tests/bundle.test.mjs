// Static checks of the shipped bundle: manifest, release.json, knowledge coverage, sandbox rules.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveManifest, validateManifest } from "@tinycloud/node-sdk";
import { buildRelease } from "../scripts/make-release.mjs";
import { loadApp } from "../dev/build.mjs";
import { importSpecifiers, scanSource } from "../../sample-healthlog/tests/lib/scan.mjs";
import { GENERATE_ARGS, okf, okfPath } from "../scripts/knowledge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const APP = manifest.app_id;
const HEALTH = "xyz.tinycloud.sample.healthlog";
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("manifest", () => {
  test("is a valid TinyCloud manifest with the interop-spec fields", () => {
    validateManifest(manifest);
    assert.equal(APP, "xyz.tinycloud.sample.recipes");
    assert.equal(manifest.knowledge, "knowledge/index.md");
    assert.equal("forked_from" in manifest, false, "an original publisher's manifest does not carry forked_from");
    assert.equal(manifest.defaults, false);
    assert.equal(manifest.space, "applications");
  });

  test("grants the app's own prefixes, and only read on the Health Log's data", () => {
    const grants = resolveManifest(manifest).resources
      .filter((r) => r.service !== "tinycloud.capabilities")
      .map((r) => `${r.service} ${r.path} ${r.actions.map((a) => a.split("/")[1]).join(",")}`);
    assert.deepEqual(grants, [
      `tinycloud.sql ${APP}/recipes read,write,schema`,
      `tinycloud.kv ${APP}/prefs/ get,put`,
      `tinycloud.kv ${APP}/app/ get`,
      `tinycloud.kv ${APP}/knowledge/ get,put,list`,
      `tinycloud.sql ${HEALTH}/healthlog read`,
    ]);
  });

  test("every grant outside the app's own prefix is read-only", () => {
    for (const r of resolveManifest(manifest).resources) {
      if (r.service === "tinycloud.capabilities" || r.path.startsWith(`${APP}/`)) continue;
      for (const action of r.actions) assert.match(action, /\/(read|get|list)$/, `${r.path} grants ${action} on another app's data`);
    }
  });
});

describe("release.json", () => {
  test("lists every shipped file with its current sha256 and a matching digest", () => {
    const release = JSON.parse(read("release.json"));
    assert.deepEqual(release, buildRelease(), "release.json is stale: run `npm run release`");
    for (const f of release.files) {
      assert.equal(createHash("sha256").update(readFileSync(join(ROOT, f.path))).digest("hex"), f.sha256, f.path);
    }
    const paths = release.files.map((f) => f.path);
    for (const must of ["manifest.json", "schema.sql", "app.jsx", "knowledge/index.md", "knowledge/app.md", "knowledge/log.md"]) {
      assert.ok(paths.includes(must), `${must} missing from release.json`);
    }
    assert.ok(!paths.some((p) => /^(dev|tests|scripts|node_modules|knowledge-src)\//.test(p)), "dev files must not ship");
  });
});

describe("knowledge bundle (in-repo coverage; okf.mjs is the full check)", () => {
  const frontmatter = (text) => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
    return m ? Object.fromEntries(m[1].split("\n").filter((l) => /^[a-z_]+:/.test(l)).map((l) => [l.split(":")[0], l.slice(l.indexOf(":") + 1).trim().replace(/^"(.*)"$/, "$1")])) : null;
  };
  const files = walk(join(ROOT, "knowledge")).map((p) => relative(join(ROOT, "knowledge"), p));
  const concepts = files.filter((f) => !/(^|\/)(index|log)\.md$/.test(f));
  const objects = [...read("schema.sql").matchAll(/CREATE (TABLE|VIEW) IF NOT EXISTS (\w+)/g)].map((m) => [m[1], m[2]]);

  test("every concept has a type; only the root index has frontmatter (okf_version only)", () => {
    for (const f of concepts) assert.ok(frontmatter(read(`knowledge/${f}`))?.type, `${f}: no type`);
    assert.deepEqual(frontmatter(read("knowledge/index.md")), { okf_version: "0.2" });
  });

  test("index.md holds only headings and links, and every link resolves", () => {
    const body = read("knowledge/index.md").replace(/^---[\s\S]*?---\n/, "");
    for (const line of body.split("\n").filter(Boolean)) {
      assert.match(line, /^(# .+|\* \[[^\]]+\]\([^)]+\) - .+)$/, `not a heading or link line: ${line}`);
    }
    for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) assert.ok(files.includes(target), `dangling index link ${target}`);
  });

  test("one concept per table and view in schema.sql (4 tables, 2 views)", () => {
    assert.equal(objects.filter(([k]) => k === "TABLE").length, 4);
    assert.equal(objects.filter(([k]) => k === "VIEW").length, 2);
    for (const [kind, name] of objects) {
      const fm = frontmatter(read(`knowledge/${kind === "TABLE" ? "tables" : "views"}/${name}.md`));
      assert.equal(fm.type, kind === "TABLE" ? "SQLite Table" : "SQLite View");
      assert.equal(fm.resource, `tinycloud.sql:applications:${APP}/recipes`);
      assert.equal(fm[kind.toLowerCase()], name);
    }
  });

  test("one concept per KV permission prefix; resource in tinycloud.<service>:<space>:<path> form", () => {
    const kvPerms = manifest.permissions.filter((p) => p.service === "tinycloud.kv");
    const resources = concepts.map((f) => frontmatter(read(`knowledge/${f}`)).resource).filter(Boolean);
    for (const p of kvPerms) {
      const abs = p.skipPrefix ? p.path : `${APP}/${p.path}`;
      assert.ok(resources.includes(`tinycloud.kv:applications:${abs}`), `no concept for ${abs}`);
    }
    assert.equal(concepts.filter((f) => f.startsWith("kv/")).length, kvPerms.length);
    for (const r of resources) assert.match(r, /^tinycloud\.(kv|sql):applications:xyz\.tinycloud\.sample\.(recipes|healthlog)\/\S+$/, r);
  });

  const okfAvailable = okfPath() !== undefined;
  const noKit = "okf.mjs not found: set TC_APP_KIT to a tinycloud-app-kit checkout (scripts/okf.mjs)";

  test("okf.mjs check knowledge --manifest manifest.json passes", { skip: !okfAvailable && noKit }, () => {
    const r = okf(["check", "knowledge", "--manifest", "manifest.json"]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /manifest coverage checked/);
  });

  test("regenerating knowledge/ from manifest, schema and knowledge-src changes nothing (no drift)", { skip: !okfAvailable && noKit }, () => {
    const tmp = mkdtempSync(join(tmpdir(), "t3b-knowledge-"));
    try {
      cpSync(join(ROOT, "knowledge"), join(tmp, "knowledge"), { recursive: true });
      const r = okf([...GENERATE_ARGS.slice(0, -1), join(tmp, "knowledge"), "--date", "2026-10-20"]);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      const list = (d) => walk(d).map((p) => [relative(d, p), readFileSync(p, "utf8")]);
      assert.deepEqual(list(join(tmp, "knowledge")), list(join(ROOT, "knowledge")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("schema and app agree", () => {
  test("REQUIRED_OBJECTS (the app's 'is the schema installed' probe) is exactly the tables and views in schema.sql", async () => {
    const app = await loadApp();
    const names = [...read("schema.sql").matchAll(/CREATE (?:TABLE|VIEW) IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...app.REQUIRED_OBJECTS].sort(), names.sort());
  });

  test("every statement in schema.sql is idempotent", () => {
    for (const m of read("schema.sql").matchAll(/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|VIEW|INDEX)\b(?!\s+IF\s+NOT\s+EXISTS)/gim)) assert.fail(`not idempotent: ${m[0]}`);
  });
});

describe("sandbox rules for app.jsx", () => {
  // Defence in depth only: the static scan (the Health Log sample's tests/lib/scan.mjs, one source of truth)
  // catches honest mistakes and obvious escape hatches. It is NOT the security boundary: the sandbox CSP
  // (opaque origin, connect-src 'none', no storage, no parent access) is, and the runner proves that (T5b).
  const src = read("app.jsx");
  test("app.jsx is clean under the shared static scan and imports only react and the bridge", () => {
    assert.deepEqual(scanSource(src), []);
    assert.deepEqual([...new Set(importSpecifiers(src))].sort(), ["@tinycloud/app", "react"]);
  });
});
