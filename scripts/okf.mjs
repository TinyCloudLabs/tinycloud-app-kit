#!/usr/bin/env node
// OKF v0.2 knowledge bundles for TinyCloud apps. No dependencies.
//
//   node scripts/okf.mjs generate <manifest.json> [--sql <schema.sql>] [--db <path>]
//                                  --out <knowledge/> [--src <knowledge-src/>] [--date YYYY-MM-DD]
//   node scripts/okf.mjs check <dir>... [--manifest[=<manifest.json>]]
//
// See guides/generate-knowledge.md.
import { relative } from "node:path";
import { checkBundle, defaultManifestPath } from "./lib/okf/check.mjs";
import { generateBundle, writeBundle } from "./lib/okf/generate.mjs";

const USAGE = `usage:
  okf.mjs generate <manifest.json> [--sql <schema.sql>] [--db <path>] --out <dir> [--src <dir>] [--date YYYY-MM-DD]
  okf.mjs check <dir>... [--manifest[=<manifest.json>]]

generate  writes index.md, app.md, tables/, views/, kv/ and log.md. Existing
          <!-- keep --> ... <!-- /keep --> blocks and extra frontmatter keys survive.
check     enforces OKF v0.2 (type on every concept, links-only index.md, okf_version
          on the root index only, dated log.md). With --manifest it also requires
          app.md and that every resource: is covered by a manifest permission; the
          manifest defaults to <dir>/../manifest.json.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (eq >= 0) flags[name] = arg.slice(eq + 1);
    else if (name === "manifest") {
      // bare flag, or `--manifest <file>.json`
      if (argv[i + 1]?.endsWith(".json")) flags[name] = argv[++i];
      else flags[name] = true;
    } else {
      if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`);
      flags[name] = argv[++i];
    }
  }
  return { positional, flags };
}

function fail(message) {
  console.error(`okf: ${message}`);
  process.exit(2);
}

function runGenerate({ positional, flags }) {
  if (positional.length !== 1) fail(`generate takes exactly one manifest\n${USAGE}`);
  if (typeof flags.out !== "string") fail(`generate needs --out <dir>\n${USAGE}`);
  if (flags.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) fail("--date must be YYYY-MM-DD");
  const result = generateBundle({
    manifestPath: positional[0],
    sqlPath: flags.sql,
    dbOpt: flags.db,
    srcDir: flags.src,
    outDir: flags.out,
    date: flags.date,
  });
  const written = writeBundle(result.files, flags.out);
  for (const warning of result.warnings) console.warn(`okf: warning: ${warning}`);
  const concepts = [...result.files.keys()].filter((p) => !["index.md", "log.md"].includes(p)).length;
  console.log(`okf: ${result.appId}: ${concepts} concepts, ${written.length} file(s) written to ${relative(process.cwd(), flags.out) || "."}`);
}

function runCheck({ positional, flags }) {
  if (positional.length === 0) fail(`check needs at least one bundle directory\n${USAGE}`);
  if (typeof flags.manifest === "string" && positional.length > 1) fail("--manifest <file> applies to one bundle; use the bare --manifest for several");
  let failed = false;
  for (const dir of positional) {
    const manifestPath = flags.manifest === undefined ? undefined : flags.manifest === true ? defaultManifestPath(dir) : flags.manifest;
    const { errors, warnings } = checkBundle(dir, { manifestPath });
    for (const w of warnings) console.warn(`okf: warning: ${dir}/${w.file}: [${w.code}] ${w.message}`);
    for (const e of errors) console.error(`okf: ${dir}/${e.file}: [${e.code}] ${e.message}`);
    if (errors.length > 0) failed = true;
    else console.log(`okf: ${dir}: ok${manifestPath ? " (manifest coverage checked)" : ""}`);
  }
  if (failed) process.exit(1);
}

try {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === "generate") runGenerate(args);
  else if (command === "check") runCheck(args);
  else fail(USAGE);
} catch (error) {
  fail(error.message);
}
