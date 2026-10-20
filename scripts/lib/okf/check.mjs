// OKF v0.2 conformance checker plus the TinyCloud rules: every `resource:` is
// well formed and covered by a manifest grant, every index link resolves.
//
// Error codes (each finding is printed as `<file>: [code] message`):
//   frontmatter-missing     non-reserved .md without a frontmatter block
//   frontmatter-invalid     frontmatter block that does not parse
//   missing-type            frontmatter without a non-empty `type`
//   index-frontmatter       index.md frontmatter other than `okf_version` on the root
//   okf-version-missing     root index.md without `okf_version`
//   okf-version-invalid     `okf_version` is not the string "0.2"
//   index-prose             index.md line that is not a heading, a blank line or a link entry
//   index-link-dangling     index.md link whose target does not exist in the bundle
//   index-missing           no root index.md
//   log-date-invalid        log.md `##` heading that is not YYYY-MM-DD
//   resource-missing        TinyCloud resource concept without `resource:`
//   resource-malformed      `resource:` that starts with tinycloud. but is not tinycloud.<service>:<space>:<path>
//   resource-uncovered      `resource:` that no manifest grant covers
//   app-missing             no app.md (needs --manifest)
//   app-id-mismatch         app.md `tinycloud.app` differs from the manifest app_id
// Warnings (exit code unaffected): concept-unlisted, link-dangling, log-order.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { parseFrontmatter } from "./yaml.mjs";
import { coveringGrants, parseResource, resolveManifest } from "./manifest.mjs";
import { OKF_VERSION } from "./generate.mjs";

const RESOURCE_TYPES = new Set(["SQLite Table", "SQLite View", "KV Prefix"]);
const RESERVED = new Set(["index.md", "log.md"]);

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, base, out);
    else if (entry.endsWith(".md")) out.push(relative(base, path).split("\\").join("/"));
  }
  return out;
}

function stripFences(body) {
  // Blank out fenced code so link/heading scans ignore SQL and examples.
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

function linkTargets(text) {
  const out = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1]);
  return out;
}

function resolveLink(target, fromRel) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return undefined; // external or anchor
  const clean = decodeURI(target.split("#")[0].split("?")[0]);
  if (clean === "") return undefined;
  return clean.startsWith("/") ? posix.normalize(clean.slice(1)) : posix.normalize(posix.join(posix.dirname(fromRel), clean));
}

/**
 * Checks one bundle directory. Returns { errors, warnings } where each entry
 * is { file, code, message }.
 */
export function checkBundle(dir, { manifestPath } = {}) {
  const errors = [];
  const warnings = [];
  const err = (file, code, message) => errors.push({ file, code, message });
  const warn = (file, code, message) => warnings.push({ file, code, message });

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(".", "bundle-missing", `${dir} does not exist or is not a directory`);
    return { errors, warnings };
  }

  let resolved;
  if (manifestPath !== undefined) {
    try {
      resolved = resolveManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (error) {
      err(manifestPath, "manifest-invalid", error.message);
      return { errors, warnings };
    }
  }

  const files = walk(dir);
  const set = new Set(files);
  const concepts = [];

  if (!set.has("index.md")) err("index.md", "index-missing", "the bundle has no root index.md");
  if (resolved && !set.has("app.md")) err("app.md", "app-missing", "the bundle has no app.md (minimum bundle: index.md + app.md)");

  for (const rel of files) {
    const text = readFileSync(join(dir, rel), "utf8");
    const base = posix.basename(rel);
    const parsed = parseFrontmatter(text);

    if (base === "index.md") {
      checkIndex(rel, parsed, text);
      continue;
    }
    if (base === "log.md") {
      checkLog(rel, parsed);
      continue;
    }

    // concept document
    if (!parsed.hasBlock) {
      err(rel, "frontmatter-missing", "concept has no YAML frontmatter block");
      continue;
    }
    if (parsed.error) {
      err(rel, "frontmatter-invalid", parsed.error);
      continue;
    }
    const type = parsed.data.type;
    if (typeof type !== "string" || type.trim() === "") {
      err(rel, "missing-type", "frontmatter has no non-empty `type`");
      continue;
    }
    concepts.push(rel);
    checkConceptLinks(rel, parsed.body);
    checkResource(rel, type, parsed.data);
    if (rel === "app.md" && resolved) {
      const app = parsed.data.tinycloud?.app;
      if (app !== resolved.appId) err(rel, "app-id-mismatch", `tinycloud.app is ${JSON.stringify(app)}, manifest app_id is ${JSON.stringify(resolved.appId)}`);
    }
  }

  function checkIndex(rel, parsed, text) {
    const isRoot = rel === "index.md";
    if (parsed.hasBlock) {
      if (parsed.error) err(rel, "frontmatter-invalid", parsed.error);
      else if (!isRoot) err(rel, "index-frontmatter", "only the bundle-root index.md may carry frontmatter");
      else {
        const keys = Object.keys(parsed.data);
        if (keys.some((k) => k !== "okf_version")) {
          err(rel, "index-frontmatter", `root index.md frontmatter may only hold okf_version (found ${keys.filter((k) => k !== "okf_version").join(", ")})`);
        }
        if (!("okf_version" in parsed.data)) err(rel, "okf-version-missing", `root index.md must declare okf_version: "${OKF_VERSION}"`);
        else if (parsed.data.okf_version !== OKF_VERSION) err(rel, "okf-version-invalid", `okf_version must be the string "${OKF_VERSION}", found ${JSON.stringify(parsed.data.okf_version)}`);
      }
    } else if (isRoot) {
      err(rel, "okf-version-missing", `root index.md must declare okf_version: "${OKF_VERSION}"`);
    }
    const body = stripFences(parsed.unterminated ? text : parsed.body);
    body.split("\n").forEach((line) => {
      const t = line.trim();
      if (t === "" || /^#{1,6}\s+\S/.test(t) || /^<!--.*-->$/.test(t)) return;
      const entry = /^[*+-]\s+(.*)$/.exec(t);
      if (entry && /\[[^\]]+\]\([^)\s]+\)/.test(entry[1])) return;
      err(rel, "index-prose", `index.md may only hold headings and link entries; found: "${t.slice(0, 60)}"`);
    });
    for (const target of linkTargets(body)) {
      const dest = resolveLink(target, rel);
      if (dest === undefined) continue;
      const exists = set.has(dest) || (dest.endsWith("/") && files.some((f) => f.startsWith(dest))) || existsSync(join(dir, dest));
      if (!exists) err(rel, "index-link-dangling", `link ${target} does not resolve inside the bundle`);
    }
  }

  function checkLog(rel, parsed) {
    const body = stripFences(parsed.unterminated ? "" : parsed.body);
    let previous;
    for (const line of body.split("\n")) {
      const m = /^##\s+(.*)$/.exec(line.trim());
      if (!m) continue;
      const heading = m[1].trim();
      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(heading);
      const valid = date && !Number.isNaN(Date.parse(`${heading}T00:00:00Z`)) && new Date(`${heading}T00:00:00Z`).toISOString().startsWith(heading);
      if (!valid) {
        err(rel, "log-date-invalid", `log heading "${heading}" is not an ISO 8601 YYYY-MM-DD date`);
        continue;
      }
      if (previous !== undefined && heading > previous) warn(rel, "log-order", `log entries should be newest first (${heading} follows ${previous})`);
      previous = heading;
    }
  }

  function checkConceptLinks(rel, body) {
    for (const target of linkTargets(stripFences(body))) {
      const dest = resolveLink(target, rel);
      if (dest === undefined) continue;
      if (!set.has(dest) && !existsSync(join(dir, dest))) warn(rel, "link-dangling", `link ${target} does not resolve inside the bundle`);
    }
  }

  function checkResource(rel, type, data) {
    const value = data.resource;
    if (value === undefined || value === null || value === "") {
      if (RESOURCE_TYPES.has(type)) err(rel, "resource-missing", `${type} concepts must carry resource:`);
      return;
    }
    if (typeof value !== "string") {
      err(rel, "resource-malformed", "resource must be a string");
      return;
    }
    if (!value.startsWith("tinycloud.")) {
      if (RESOURCE_TYPES.has(type)) err(rel, "resource-malformed", `resource ${JSON.stringify(value)} must be tinycloud.<service>:<space>:<path>`);
      return; // other URI forms are allowed for other concept types
    }
    const parsed = parseResource(value);
    if (!parsed) {
      err(rel, "resource-malformed", `resource ${JSON.stringify(value)} must be tinycloud.<service>:<space>:<path>`);
      return;
    }
    if (resolved && coveringGrants(resolved.grants, parsed).length === 0) {
      err(rel, "resource-uncovered", `resource ${value} is not covered by any manifest permission`);
    }
  }

  if (set.has("index.md")) {
    const listed = new Set();
    const indexText = readFileSync(join(dir, "index.md"), "utf8");
    for (const target of linkTargets(stripFences(indexText))) {
      const dest = resolveLink(target, "index.md");
      if (dest) listed.add(dest);
    }
    for (const rel of concepts) if (!listed.has(rel)) warn(rel, "concept-unlisted", "concept is not linked from the root index.md");
  }

  return { errors, warnings };
}

export function defaultManifestPath(dir) {
  return join(dirname(resolve(dir)), "manifest.json");
}
