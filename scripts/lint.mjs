import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

for (const path of walk(root, (p) => p.endsWith(".json"))) {
  readJson(path);
}

for (const manifestPath of walk(join(root, "examples"), (p) => p.endsWith("manifest.json"))) {
  const manifest = readJson(manifestPath);
  if (!manifest) continue;

  if (manifest.knowledge !== undefined) {
    if (manifest.knowledge !== true && typeof manifest.knowledge !== "string") {
      fail(`${relative(root, manifestPath)} knowledge must be true or a knowledge/*.md path`);
    }
    if (typeof manifest.knowledge === "string" && !/^knowledge\/.+\.md$/.test(manifest.knowledge)) {
      fail(`${relative(root, manifestPath)} knowledge path must match knowledge/*.md`);
    }
    const rootPath = manifest.knowledge === true ? "knowledge/index.md" : manifest.knowledge;
    if (rootPath && !existsSync(join(dirname(manifestPath), rootPath))) {
      fail(`${relative(root, manifestPath)} knowledge root ${rootPath} does not exist`);
    }
  }

  for (const sql of manifest.resources?.sql ?? []) {
    const capabilities = new Set(sql.capabilities ?? []);
    const hasMigrations = Array.isArray(sql.migrations) && sql.migrations.length > 0;
    if (hasMigrations && !capabilities.has("tinycloud.sql/schema")) {
      fail(`${relative(root, manifestPath)} SQL resource ${sql.name} has migrations but lacks tinycloud.sql/schema`);
    }
    for (const migration of sql.migrations ?? []) {
      if (typeof migration.id !== "string" || migration.id.length === 0) {
        fail(`${relative(root, manifestPath)} SQL migration id must be non-empty`);
      }
      if (!Array.isArray(migration.sql) || migration.sql.length === 0) {
        fail(`${relative(root, manifestPath)} SQL migration ${migration.id} must include SQL statements`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`lint: ${error}`);
  }
  process.exit(1);
}

console.log("lint: ok");
