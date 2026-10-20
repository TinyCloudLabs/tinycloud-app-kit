// Tests for scripts/okf.mjs. Plain node, no dependencies: `npm test`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBundle } from "./lib/okf/check.mjs";
import { generateBundle, writeBundle } from "./lib/okf/generate.mjs";
import { parseDdl } from "./lib/okf/sql.mjs";
import { emitYaml, parseFrontmatter, parseYaml } from "./lib/okf/yaml.mjs";
import { parseResource } from "./lib/okf/manifest.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const cli = join(root, "scripts/okf.mjs");
const tmp = mkdtempSync(join(tmpdir(), "okf-test-"));
let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}

const read = (...p) => readFileSync(join(...p), "utf8");
const codes = (list) => list.map((e) => e.code).sort();
function workCopy(name) {
  const dir = join(tmp, name);
  cpSync(join(root, "examples/okf-fixtures"), dir, { recursive: true });
  return dir;
}
function regenerate(dir, extra = {}) {
  const result = generateBundle({
    manifestPath: join(dir, "manifest.json"),
    sqlPath: join(dir, "schema.sql"),
    outDir: join(dir, "knowledge"),
    date: "2026-10-21",
    ...extra,
  });
  writeBundle(result.files, join(dir, "knowledge"));
  return result;
}

// ---- fixtures ---------------------------------------------------------------

for (const name of ["minimal-app", "sqlite-app", "okf-fixtures"]) {
  test(`${name}: committed bundle is up to date and idempotent`, () => {
    const dir = join(root, "examples", name);
    const manifest = join(dir, "manifest.json");
    const sql = existsSync(join(dir, "schema.sql")) ? join(dir, "schema.sql") : undefined;
    const result = generateBundle({ manifestPath: manifest, sqlPath: sql, outDir: join(dir, "knowledge"), date: "2099-01-01" });
    assert.deepEqual([result.created, result.changed, result.stale], [[], [], []], "regenerating changed the committed bundle");
    for (const [rel, text] of result.files) assert.equal(read(dir, "knowledge", rel), text, rel);
  });
  test(`${name}: check is green with manifest coverage`, () => {
    const dir = join(root, "examples", name);
    const { errors } = checkBundle(join(dir, "knowledge"), { manifestPath: join(dir, "manifest.json") });
    assert.deepEqual(errors, []);
  });
}

test("okf-fixtures: one concept per table and per view", () => {
  const dir = join(root, "examples/okf-fixtures");
  const ddl = parseDdl(read(dir, "schema.sql"));
  assert.equal(ddl.tables.length, 9);
  assert.equal(ddl.views.length, 8);
  const seen = { table: [], view: [] };
  for (const sub of ["tables", "views"]) {
    for (const file of readdirSync(join(dir, "knowledge", sub))) {
      const fm = parseFrontmatter(read(dir, "knowledge", sub, file)).data;
      seen[fm.type === "SQLite Table" ? "table" : "view"].push(fm.table ?? fm.view);
      assert.match(fm.resource, /^tinycloud\.sql:applications:com\.example\.workshop\/shop_log$/);
    }
  }
  assert.deepEqual(seen.table.sort(), ddl.tables.map((t) => t.name).sort());
  assert.deepEqual(seen.view.sort(), ddl.views.map((v) => v.name).sort());
});

test("okf-fixtures: one KV concept per KV permission, foreign prefix flagged", () => {
  const dir = join(root, "examples/okf-fixtures");
  const manifest = JSON.parse(read(dir, "manifest.json"));
  const kv = manifest.permissions.filter((p) => p.service === "tinycloud.kv");
  assert.equal(readdirSync(join(dir, "knowledge/kv")).length, kv.length);
  assert.match(read(dir, "knowledge/kv/com-example-lumberyard-catalog.md"), /belongs to another app/);
  assert.match(read(dir, "knowledge/kv/com-example-lumberyard-catalog.md"), /only reads here/);
});

test("broken fixture fails with exactly three named errors", () => {
  const dir = join(root, "tests/okf/broken");
  const { errors } = checkBundle(join(dir, "knowledge"), { manifestPath: join(dir, "manifest.json") });
  assert.deepEqual(codes(errors), ["index-prose", "missing-type", "resource-uncovered"]);
  const run = spawnSync(process.execPath, [cli, "check", join(dir, "knowledge"), "--manifest"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  for (const code of ["index-prose", "missing-type", "resource-uncovered"]) assert.ok(run.stderr.includes(`[${code}]`), code);
});

// ---- generator behaviour -----------------------------------------------------

test("regeneration keeps keep blocks, extra frontmatter and follows schema changes", () => {
  const dir = workCopy("keep");
  const toolMd = join(dir, "knowledge/tables/tool.md");
  let text = readFileSync(toolMd, "utf8");
  text = `${text.trimEnd()}\n\n<!-- keep -->\nSharpen the chisels monthly.\n<!-- /keep -->\n`;
  text = text.replace("generated:", "verified: { by: human:test, at: 2026-10-20T00:00:00Z }\ngenerated:");
  writeFileSync(toolMd, text);
  writeFileSync(join(dir, "schema.sql"), `${read(dir, "schema.sql")}\nCREATE TABLE IF NOT EXISTS clamp_rack (id TEXT PRIMARY KEY, slots INTEGER NOT NULL);\n`);
  const result = regenerate(dir);
  assert.ok(result.created.includes("tables/clamp_rack.md"));
  const after = readFileSync(toolMd, "utf8");
  assert.match(after, /Sharpen the chisels monthly\./);
  assert.match(after, /verified:/);
  assert.match(read(dir, "knowledge/index.md"), /clamp_rack/);
  assert.match(read(dir, "knowledge/log.md"), /## 2026-10-21\n\* \*\*Creation\*\*: Added \[tables\/clamp_rack\]/);
  assert.deepEqual(checkBundle(join(dir, "knowledge"), { manifestPath: join(dir, "manifest.json") }).errors, []);
  const again = regenerate(dir);
  assert.deepEqual([again.created, again.changed], [[], []], "second run must be a no-op");
});

test("an unterminated keep block aborts instead of overwriting", () => {
  const dir = workCopy("unterminated");
  writeFileSync(join(dir, "knowledge/tables/tool.md"), `${read(dir, "knowledge/tables/tool.md")}\n<!-- keep -->\nunsaved\n`);
  assert.throws(() => regenerate(dir), /unterminated/);
});

test("a dropped table leaves its file and warns instead of deleting hand-edited knowledge", () => {
  const dir = workCopy("stale");
  writeFileSync(join(dir, "schema.sql"), read(dir, "schema.sql").replace(/-- A photo of a project[\s\S]*?\);\n/, ""));
  const result = regenerate(dir);
  assert.ok(result.stale.includes("tables/project_photo.md"));
  assert.ok(existsSync(join(dir, "knowledge/tables/project_photo.md")));
});

test("knowledge-src/app.md frontmatter and body reach app.md", () => {
  const app = parseFrontmatter(read(root, "examples/okf-fixtures/knowledge/app.md"));
  assert.equal(app.data.type, "TinyCloud App");
  assert.match(app.data.description, /woodworking shop log kept in SQLite/);
  assert.match(app.body, /Costs are integer cents/);
  assert.equal(app.data.forked_from.app_id, "com.example.workshop-upstream");
});

// ---- DDL parser ---------------------------------------------------------------

test("ddl: columns, CHECK sets, comments, composite keys, quoted names, skipped statements", () => {
  const ddl = parseDdl(`
    -- Parts.
    CREATE TABLE IF NOT EXISTS "part" (
      a TEXT NOT NULL,
      b INTEGER DEFAULT (1 + 1),   -- the b column; has a ; semicolon
      c TEXT CHECK (c IN ('x', 'it''s')),
      d NUMERIC(10, 2) REFERENCES other(id) ON DELETE SET NULL,
      PRIMARY KEY (a, b)
    ) WITHOUT ROWID;
    CREATE TRIGGER t AFTER INSERT ON part BEGIN UPDATE part SET b = 1; END;
    CREATE VIEW v AS SELECT a, COUNT(*) AS n FROM part GROUP BY a;
    CREATE VIEW w AS SELECT * FROM v;
  `);
  const t = ddl.tables[0];
  assert.equal(t.name, "part");
  assert.equal(t.description, "Parts.");
  assert.deepEqual(t.primaryKey, ["a", "b"]);
  assert.equal(t.options, "WITHOUT ROWID");
  assert.equal(t.columns[1].default, "(1 + 1)");
  assert.equal(t.columns[1].comment, "the b column; has a ; semicolon");
  assert.deepEqual(t.columns[2].checkSet, ["x", "it's"]);
  assert.equal(t.columns[3].type, "NUMERIC(10, 2)");
  assert.deepEqual(t.columns[3].references, { table: "other", columns: ["id"], actions: "ON DELETE SET NULL" });
  assert.deepEqual(ddl.views.map((v) => [v.name, v.columns, v.reads]), [["v", ["a", "n"], ["part"]], ["w", undefined, ["v"]]]);
  assert.equal(ddl.skipped.length, 1);
});

// ---- checker ------------------------------------------------------------------

function bundle(files, manifest) {
  const dir = mkdtempSync(join(tmp, "b-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, "knowledge", rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  if (manifest) writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

test("check: okf_version only on the root index, dated log, index links resolve", () => {
  const dir = mkdtempSync(join(tmp, "c-"));
  const k = join(dir, "knowledge");
  cpSync(join(root, "examples/minimal-app/knowledge"), k, { recursive: true });
  writeFileSync(join(k, "kv/index.md"), '---\nokf_version: "0.2"\n---\n\n# KV\n\n* [settings](settings.md) - x\n');
  writeFileSync(join(k, "log.md"), "# Update Log\n\n## yesterday\n* **Update**: x\n");
  writeFileSync(join(k, "index.md"), `${read(k, "index.md")}\n* [gone](nowhere.md) - missing\n`);
  const { errors } = checkBundle(k);
  assert.deepEqual(codes(errors), ["index-frontmatter", "index-link-dangling", "log-date-invalid"]);
});

test("check: resources are matched against skipPrefix, prefixed and default grants", () => {
  const fm = (resource) => `---\ntype: KV Prefix\ntitle: t\nresource: ${resource}\n---\n\nx\n`;
  const index = '---\nokf_version: "0.2"\n---\n\n# App\n\n* [App](app.md) - x\n';
  const app = "---\ntype: TinyCloud App\ntitle: A\ntinycloud: { app: com.example.a }\n---\n\nx\n";
  const manifest = {
    app_id: "com.example.a",
    name: "A",
    defaults: false,
    permissions: [
      { service: "tinycloud.kv", path: "photos/", actions: ["get"] },
      { service: "tinycloud.kv", path: "other.app/data/", skipPrefix: true, actions: ["get"] },
      { service: "tinycloud.sql", path: "com.example.a/db", skipPrefix: true, actions: ["read"] },
    ],
  };
  const ok = ["tinycloud.kv:applications:com.example.a/photos/", "tinycloud.kv:applications:com.example.a/photos/2026/", "tinycloud.kv:applications:other.app/data/x/"];
  const bad = ["tinycloud.kv:applications:com.example.a/", "tinycloud.kv:applications:com.example.a/photo", "tinycloud.kv:other:com.example.a/photos/", "tinycloud.sql:applications:com.example.a/db2", "tinycloud.kv:applications"];
  for (const resource of ok) {
    const dir = bundle({ "index.md": index, "app.md": app, "kv/t.md": fm(resource) }, manifest);
    assert.deepEqual(checkBundle(join(dir, "knowledge"), { manifestPath: join(dir, "manifest.json") }).errors, [], resource);
  }
  for (const resource of bad) {
    const dir = bundle({ "index.md": index, "app.md": app, "kv/t.md": fm(resource) }, manifest);
    const { errors } = checkBundle(join(dir, "knowledge"), { manifestPath: join(dir, "manifest.json") });
    assert.equal(errors.length, 1, resource);
    assert.match(errors[0].code, /resource-(uncovered|malformed)/);
  }
  assert.deepEqual(parseResource("tinycloud.kv:tinycloud:pkh:eip155:1:0xabc:applications:a/b/"), {
    service: "tinycloud.kv",
    space: "tinycloud:pkh:eip155:1:0xabc:applications",
    path: "a/b/",
  });
});

test("yaml: frontmatter subset round-trips", () => {
  const value = {
    type: "KV Prefix",
    n: 3,
    flag: false,
    list: ["a", "b c"],
    nested: { a: 1, b: "x: y", c: { d: ["e"] } },
    items: [{ id: "one", resource: "https://x" }, { id: "two" }],
    flow: { by: "tool/1", at: "2026-01-01T00:00:00Z" },
    version: "0.2",
  };
  assert.deepEqual(parseYaml(emitYaml(value)), value);
  assert.throws(() => parseYaml("a: |\n  text"), /unsupported/);
});

rmSync(tmp, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nokf-test: all passed");
