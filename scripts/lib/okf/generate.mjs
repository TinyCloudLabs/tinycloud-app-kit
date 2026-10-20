// OKF v0.2 bundle generator: manifest + SQL schema -> knowledge/ concept files.
//
// Layout (one concept per resource):
//   index.md           links only; the root index carries `okf_version`
//   app.md             type: TinyCloud App (manifest description + knowledge-src/app.md)
//   tables/<t>.md      type: SQLite Table, one per CREATE TABLE
//   views/<v>.md       type: SQLite View, one per CREATE VIEW
//   kv/<prefix>.md     type: KV Prefix, one per KV permission prefix
//   log.md             dated change history

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { emitYaml, parseFrontmatter } from "./yaml.mjs";
import { parseDdl } from "./sql.mjs";
import { applyPrefix, formatResource, grantedActions, resolveManifest } from "./manifest.mjs";

export const OKF_VERSION = "0.2";
export const GENERATOR = "tinycloud-app-kit/okf";
export const PROFILE = "tinycloud.app.v1";
export const KEEP_OPEN = "<!-- keep -->";
export const KEEP_CLOSE = "<!-- /keep -->";

const OWNED_KEYS = new Set(["type", "title", "description", "resource", "table", "view", "tinycloud", "generated", "forked_from"]);
const WRITE_ACTIONS = new Set(["put", "del", "write", "schema"]);

// ---- small markdown helpers ------------------------------------------------

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const cell = (text) => oneLine(text).replace(/\|/g, "\\|");
const code = (text) => {
  const t = oneLine(text);
  return t.includes("`") ? `\`\` ${t} \`\`` : `\`${t}\``;
};

function firstSentence(text, max = 200) {
  const t = oneLine(text);
  if (t === "") return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s;
}

const slug = (text) => String(text).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const kvSlug = (text) => String(text).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "root";

function listNames(names, noun) {
  const shown = names.slice(0, 6).join(", ");
  return `${shown}${names.length > 6 ? ", ..." : ""} (${names.length} ${noun}${names.length === 1 ? "" : "s"})`;
}

const tableFallback = (table) => `Table ${table.name}: ${listNames(table.columns.map((c) => c.name), "column")}.`;
const viewFallback = (view) => (view.columns ? `View ${view.name}: ${listNames(view.columns, "column")}.` : `View ${view.name}.`);

function frontmatter(fields) {
  return `---\n${emitYaml(fields)}\n---\n`;
}

function tinycloudBlock(app, extra = {}) {
  return { app, ...extra, profile: PROFILE, containsSecretValue: false };
}

// ---- keep blocks -------------------------------------------------------------

export function extractKeepBlocks(body, label = "file") {
  const lines = body.split("\n");
  const blocks = [];
  let anchor = "";
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (open) {
      open.lines.push(line);
      if (trimmed === KEEP_CLOSE || trimmed === KEEP_OPEN) {
        blocks.push(open);
        open = null;
      }
    } else if (trimmed === KEEP_OPEN) {
      open = { anchor, lines: [line] };
    } else if (trimmed !== "") {
      anchor = line.trimEnd();
    }
  }
  if (open) throw new Error(`${label}: unterminated ${KEEP_OPEN} block (close it with ${KEEP_CLOSE}); refusing to overwrite`);
  return blocks;
}

function applyKeepBlocks(body, blocks, label, warnings) {
  const lines = body.replace(/\s+$/, "").split("\n");
  const insertAfter = new Map(); // line index (or -1) -> blocks
  let cursor = -1;
  for (const block of blocks) {
    let at = block.anchor === "" ? -1 : -2;
    if (at === -2) {
      for (let i = Math.max(cursor, 0); i < lines.length; i++) {
        if (lines[i].trimEnd() === block.anchor) {
          at = i;
          break;
        }
      }
    }
    if (at === -2) {
      at = lines.length - 1;
      warnings.push(`${label}: keep block anchored to a line that no longer exists ("${block.anchor.slice(0, 50)}"); moved to the end`);
    }
    cursor = Math.max(cursor, at);
    insertAfter.set(at, [...(insertAfter.get(at) ?? []), block]);
  }
  const out = [];
  let afterBlock = false;
  const emitBlocks = (at) => {
    for (const block of insertAfter.get(at) ?? []) {
      if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
      out.push(...block.lines);
      afterBlock = true;
    }
  };
  emitBlocks(-1);
  lines.forEach((line, i) => {
    if (afterBlock && line.trim() !== "") out.push("");
    afterBlock = false;
    out.push(line);
    emitBlocks(i);
  });
  return out.join("\n");
}

const KEEP_TEMPLATE = [
  KEEP_OPEN,
  "Hand-written notes for agents go here. Text between the keep markers survives regeneration.",
  KEEP_CLOSE,
];

// ---- bundle assembly ---------------------------------------------------------

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function walkMd(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkMd(path, base, out);
    else if (entry.endsWith(".md")) out.push(relative(base, path).split("\\").join("/"));
  }
  return out;
}

function accessLine(actions, owned) {
  if (actions.length === 0) return "No manifest grant covers this resource.";
  const list = actions.map(code).join(", ");
  const writable = actions.some((a) => WRITE_ACTIONS.has(a));
  return `The manifest grants ${list}.${writable ? "" : " This app only reads here: do not write to it."}${owned ? "" : " The data belongs to another app."}`;
}

function pickSqlSources({ manifest, res, manifestDir, sqlPath, dbOpt, warnings }) {
  const resourceDbs = (res.resources.sql ?? []).filter((r) => r && typeof r.name === "string");
  const ownSqlGrants = res.grants.filter((g) => g.service === "tinycloud.sql" && g.own && !g.implicit);
  const sources = [];

  if (sqlPath) {
    const file = resolve(sqlPath);
    let dbPath = dbOpt;
    const byName = resourceDbs.find((r) => typeof r.schema === "string" && resolve(manifestDir, r.schema) === file);
    if (!dbPath) {
      if (byName) dbPath = applyPrefix(res.prefix, byName.name, false);
      else if (ownSqlGrants.length === 1) dbPath = ownSqlGrants[0].path;
      else throw new Error(`cannot tell which database ${basename(sqlPath)} belongs to (${ownSqlGrants.length} own SQL grants); pass --db <path>`);
    }
    sources.push({ text: readFileSync(file, "utf8"), dbPath, label: relative(process.cwd(), file), description: byName?.description });
    return sources;
  }
  for (const r of resourceDbs) {
    const dbPath = applyPrefix(res.prefix, r.name, false);
    if (typeof r.schema === "string") {
      const file = resolve(manifestDir, r.schema);
      if (!existsSync(file)) throw new Error(`resources.sql ${r.name}: schema file ${r.schema} does not exist`);
      sources.push({ text: readFileSync(file, "utf8"), dbPath, label: r.schema, description: r.description });
    } else if (Array.isArray(r.migrations) && r.migrations.length > 0) {
      const text = r.migrations.flatMap((m) => (Array.isArray(m.sql) ? m.sql : [])).map((s) => `${s.trim().replace(/;\s*$/, "")};`).join("\n");
      sources.push({ text, dbPath, label: `${r.name} migrations`, description: r.description });
    } else warnings.push(`resources.sql ${r.name} has no schema file or migrations; no table concepts generated`);
  }
  return sources;
}

/**
 * Builds the bundle in memory. Existing files in `outDir` supply preserved
 * keep blocks, extra frontmatter keys and the previous log.
 */
export function generateBundle({ manifestPath, sqlPath, dbOpt, srcDir, outDir, date }) {
  const warnings = [];
  const manifestFile = resolve(manifestPath);
  const manifestDir = dirname(manifestFile);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`${manifestPath}: ${error.message}`);
  }
  const res = resolveManifest(manifest);
  const sources = pickSqlSources({ manifest, res, manifestDir, sqlPath, dbOpt, warnings });
  const multiDb = sources.length > 1;

  const concepts = []; // { path, fm, body, keepDefault }
  const links = { tables: [], views: [], kv: [] };

  // --- SQL ---
  for (const source of sources) {
    const ddl = parseDdl(source.text);
    for (const skipped of ddl.skipped) warnings.push(`${source.label}: skipped statement "${skipped}"`);
    const grantForDb = res.grants.find((g) => g.service === "tinycloud.sql" && g.path === source.dbPath && !g.implicit);
    const sqlResource = { service: "tinycloud.sql", space: grantForDb?.space ?? res.space, path: source.dbPath };
    const actions = grantedActions(res.grants, sqlResource);
    if (actions.length === 0) warnings.push(`no manifest grant covers SQL database ${source.dbPath}`);
    const owned = res.isOwn(source.dbPath);
    const sensitivity = (res.resources.sql ?? []).find((r) => applyPrefix(res.prefix, r.name ?? "", false) === source.dbPath)?.sensitivity;
    const dir = (kind) => (multiDb ? `${kind}/${slug(source.dbPath)}` : kind);
    const pathOf = (kind, name) => `${dir(kind)}/${slug(name)}.md`;
    const objects = new Map();
    for (const t of ddl.tables) objects.set(t.name.toLowerCase(), pathOf("tables", t.name));
    for (const v of ddl.views) objects.set(v.name.toLowerCase(), pathOf("views", v.name));
    const linkFor = (name) => (objects.has(name.toLowerCase()) ? `[${name}](/${objects.get(name.toLowerCase())})` : code(name));
    const db = `${code(source.dbPath)} (space ${code(sqlResource.space)})`;
    const dbNote = source.description ? ` ${oneLine(source.description)}` : "";
    const resource = formatResource(sqlResource);
    const readBy = (name) => ddl.views.filter((v) => v.reads.some((r) => r.toLowerCase() === name.toLowerCase()));

    for (const table of ddl.tables) {
      const rows = table.columns.map((c) => {
        const parts = [];
        if (c.primaryKey) parts.push("primary key");
        else if (table.primaryKey.length > 1 && table.primaryKey.includes(c.name)) parts.push("part of primary key");
        if (c.notNull && !c.primaryKey) parts.push("not null");
        if (c.unique) parts.push("unique");
        if (c.default !== undefined) parts.push(`default ${code(c.default)}`);
        if (c.checkSet) parts.push(`one of ${c.checkSet.map((v) => code(v)).join(", ")}`);
        for (const expr of c.checks) if (!c.checkSet || expr !== c.checks[0]) parts.push(`check ${code(expr)}`);
        if (c.references) {
          const cols = c.references.columns.length > 0 ? ` ${code(`(${c.references.columns.join(", ")})`)}` : "";
          parts.push(`references ${linkFor(c.references.table ?? "?")}${cols}${c.references.actions ? ` ${c.references.actions.toLowerCase()}` : ""}`);
        }
        if (c.generated) parts.push(`generated as ${code(c.generated)}`);
        return `| ${code(c.name)} | ${cell(c.type) || "-"} | ${cell(parts.join("; ")) || "-"} | ${cell(c.comment) || "-"} |`;
      });
      const body = [];
      body.push(table.description || `Table ${code(table.name)} in SQLite database ${db}.${dbNote}`);
      if (table.description) body.push("", `Table ${code(table.name)} in SQLite database ${db}.${dbNote}`);
      body.push("", "# Schema", "", "| Column | Type | Constraints | Description |", "| --- | --- | --- | --- |", ...rows);

      const extra = [];
      if (table.primaryKey.length > 1) extra.push(`* Primary key: ${code(`(${table.primaryKey.join(", ")})`)}`);
      for (const c of table.constraints) {
        if (c.kind === "unique") extra.push(`* Unique: ${code(`(${c.columns.join(", ")})`)}`);
        else if (c.kind === "check") extra.push(`* Check: ${code(c.expr)}`);
        else if (c.kind === "foreignKey") {
          const to = c.references ? `${linkFor(c.references.table ?? "?")}${c.references.columns.length ? ` ${code(`(${c.references.columns.join(", ")})`)}` : ""}` : "?";
          extra.push(`* Foreign key ${code(`(${c.columns.join(", ")})`)} references ${to}${c.references?.actions ? ` ${c.references.actions.toLowerCase()}` : ""}`);
        }
      }
      if (table.options) extra.push(`* Table options: ${code(table.options)}`);
      if (extra.length > 0) body.push("", "# Table constraints", "", ...extra);

      const indexes = ddl.indexes.filter((i) => i.table.toLowerCase() === table.name.toLowerCase());
      if (indexes.length > 0) {
        body.push("", "# Indexes", "");
        for (const i of indexes) body.push(`* ${code(i.name)} on ${code(`(${i.columns.join(", ")})`)}${i.unique ? ", unique" : ""}${i.where ? `, where ${code(i.where)}` : ""}`);
      }
      const readers = readBy(table.name);
      if (readers.length > 0) body.push("", "# Read by views", "", ...readers.map((v) => `* ${linkFor(v.name)}`));
      body.push("", "# Access", "", accessLine(actions, owned));

      const path = pathOf("tables", table.name);
      concepts.push({
        path,
        fm: {
          type: "SQLite Table",
          title: table.name,
          description: firstSentence(table.description) || tableFallback(table),
          resource,
          table: table.name,
          generated: { by: GENERATOR },
          tinycloud: tinycloudBlock(res.appId, { service: "sql", ...(sensitivity ? { sensitivity } : {}) }),
        },
        body: body.join("\n"),
      });
      links.tables.push({ path, title: table.name, description: firstSentence(table.description) || tableFallback(table) });
    }

    for (const view of ddl.views) {
      const body = [];
      body.push(view.description || `View ${code(view.name)} in SQLite database ${db}.${dbNote}`);
      if (view.description) body.push("", `View ${code(view.name)} in SQLite database ${db}.${dbNote}`);
      if (view.columns) {
        body.push("", "# Schema", "", "| Column |", "| --- |", ...view.columns.map((c) => `| ${code(c)} |`));
      } else {
        body.push("", "# Schema", "", "The column list is not spelled out in the definition (it uses `*` or unnamed expressions); read it from the definition below.");
      }
      if (view.reads.length > 0) body.push("", "# Reads", "", ...view.reads.map((r) => `* ${linkFor(r)}`));
      const readers = readBy(view.name);
      if (readers.length > 0) body.push("", "# Read by views", "", ...readers.map((v) => `* ${linkFor(v.name)}`));
      body.push("", "# Definition", "", "```sql", view.definition, "```");
      body.push("", "# Access", "", actions.includes("read") ? `Query it with the ${code("read")} action; the manifest grants ${actions.map(code).join(", ")}.` : accessLine(actions, owned));

      const path = pathOf("views", view.name);
      concepts.push({
        path,
        fm: {
          type: "SQLite View",
          title: view.name,
          description: firstSentence(view.description) || viewFallback(view),
          resource,
          view: view.name,
          generated: { by: GENERATOR },
          tinycloud: tinycloudBlock(res.appId, { service: "sql", ...(sensitivity ? { sensitivity } : {}) }),
        },
        body: body.join("\n"),
      });
      links.views.push({ path, title: view.name, description: firstSentence(view.description) || viewFallback(view) });
    }
  }

  // --- KV ---
  const kvItems = new Map();
  for (const g of res.grants.filter((x) => x.service === "tinycloud.kv" && !x.implicit)) {
    const key = `${g.space}|${g.path}`;
    kvItems.set(key, { space: g.space, path: g.path, description: g.description, own: g.own });
  }
  for (const r of res.resources.kv ?? []) {
    if (!r || typeof r.prefix !== "string") continue;
    const path = applyPrefix(res.prefix, r.prefix.replace(/\*+$/, ""), false);
    const key = `${res.space}|${path}`;
    const existing = kvItems.get(key);
    kvItems.set(key, {
      space: res.space,
      path,
      own: res.isOwn(path),
      ...existing,
      description: r.description ?? existing?.description ?? "",
      name: r.name,
      sensitivity: r.sensitivity,
    });
  }
  const usedSlugs = new Set();
  for (const item of kvItems.values()) {
    const resource = { service: "tinycloud.kv", space: item.space, path: item.path };
    const actions = grantedActions(res.grants, resource);
    if (actions.length === 0) warnings.push(`no manifest grant covers KV path ${item.path}`);
    const rel = item.own && item.path.startsWith(`${res.prefix}/`) ? item.path.slice(res.prefix.length + 1) : item.path;
    let name = kvSlug(rel);
    for (let n = 2; usedSlugs.has(name); n++) name = `${kvSlug(rel)}-${n}`;
    usedSlugs.add(name);
    const isPrefix = item.path.endsWith("/");
    const title = item.name ?? rel;
    const description = firstSentence(item.description) || `KV ${isPrefix ? "prefix" : "key"} ${item.path}.`;
    const body = [item.description ? oneLine(item.description) : `KV ${isPrefix ? "prefix" : "key"} ${code(item.path)}.`, "", "# Keys", ""];
    body.push(
      isPrefix
        ? `Every key beginning with ${code(item.path)} in space ${code(item.space)}.`
        : `The single key ${code(item.path)} in space ${code(item.space)}.`,
    );
    if (!item.own) {
      body.push("", `This path belongs to another app (the app whose id is ${code(item.path.split("/")[0])}). Read its own knowledge bundle before relying on the layout.`);
    }
    if (item.path.startsWith(`${res.prefix}/knowledge`)) {
      body.push("", "This is where this knowledge bundle itself lives in your space.");
    }
    body.push("", "# Access", "", accessLine(actions, item.own));
    const path = `kv/${name}.md`;
    concepts.push({
      path,
      fm: {
        type: "KV Prefix",
        title,
        description,
        resource: formatResource(resource),
        generated: { by: GENERATOR },
        tinycloud: tinycloudBlock(res.appId, { service: "kv", ...(item.sensitivity ? { sensitivity: item.sensitivity } : {}) }),
      },
      body: body.join("\n"),
    });
    links.kv.push({ path, title, description });
  }

  // --- app.md ---
  const srcRoot = resolve(srcDir ?? join(manifestDir, "knowledge-src"));
  const srcText = readIfExists(join(srcRoot, "app.md"));
  let srcFm = {};
  let srcBody = "";
  if (srcText !== undefined) {
    const parsed = parseFrontmatter(srcText);
    if (parsed.error) throw new Error(`knowledge-src/app.md: ${parsed.error}`);
    srcFm = parsed.data ?? {};
    srcBody = parsed.body.trim();
  }
  const group = (label, items) => (items.length > 0 ? [`* ${label}: ${items.map((i) => `[${i.title}](/${i.path})`).join(", ")}`] : []);
  const appBody = [res.description || `${res.name} is a TinyCloud app.`];
  if (res.forkedFrom && typeof res.forkedFrom === "object") {
    const f = res.forkedFrom;
    appBody.push("", `Forked from ${code(f.app_id ?? "?")}${f.source ? ` (${f.source}${f.commit ? ` at ${String(f.commit).slice(0, 12)}` : ""})` : ""}.`);
  }
  if (srcBody) appBody.push("", srcBody);
  const resourceLines = [...group("Tables", links.tables), ...group("Views", links.views), ...group("KV prefixes", links.kv)];
  if (resourceLines.length > 0) appBody.push("", "# Resources", "", ...resourceLines);
  const visibleGrants = res.grants.filter((g) => g.service !== "tinycloud.capabilities");
  if (visibleGrants.length > 0) {
    appBody.push("", "# Permissions", "", `Space ${code(res.space)}, app prefix ${code(res.prefix)}. Each resource below is in the form the CLI ${code("--cap")} flag takes (add ${code(":<actions>")}).`, "");
    appBody.push("| Resource | Actions | Why |", "| --- | --- | --- |");
    for (const g of visibleGrants) {
      appBody.push(`| ${code(formatResource(g))} | ${cell(g.actions.join(", "))} | ${cell(g.description) || "-"} |`);
    }
  }
  const foreign = visibleGrants.filter((g) => !g.own);
  if (foreign.length > 0) {
    appBody.push("", "# Other apps' data", "", "These grants point at data owned by other apps:", "");
    for (const g of foreign) {
      appBody.push(`* ${code(formatResource(g))}: ${g.actions.join(", ")}${g.actions.some((a) => WRITE_ACTIONS.has(a)) ? "" : " (read only)"}`);
    }
  }
  const secrets = (res.resources.secrets ?? []).filter((s) => s && typeof s.name === "string");
  if (secrets.length > 0) {
    appBody.push("", "# Secrets", "", "Names only. Secret values are never stored in this bundle.", "");
    for (const s of secrets) {
      const bits = [s.required === true ? "required" : "optional"];
      if (Array.isArray(s.consumers) && s.consumers.length > 0) bits.push(`used by ${s.consumers.map(code).join(", ")}`);
      appBody.push(`* ${code(s.name)} (${bits.join("; ")})${s.description ? `: ${oneLine(s.description)}` : ""}`);
    }
  }
  const sample = visibleGrants.find((g) => g.actions.length > 0);
  if (sample) {
    appBody.push(
      "",
      "# Getting access",
      "",
      `An agent needs a delegation from the owner that covers the resources it touches. Ask for one with ${code("tinycloud auth request --cap <resource>:<actions> --grant")}, for example ${code(`--cap ${formatResource(sample)}:${sample.actions.join(",")}`)}.`,
    );
  }
  const appFm = {
    type: "TinyCloud App",
    title: res.name,
    description: firstSentence(srcFm.description ?? res.description) || res.name,
    ...(res.forkedFrom ? { forked_from: res.forkedFrom } : {}),
    generated: { by: GENERATOR },
    tinycloud: tinycloudBlock(res.appId),
  };
  for (const [k, v] of Object.entries(srcFm)) if (!(k in appFm) && !OWNED_KEYS.has(k)) appFm[k] = v;
  concepts.unshift({ path: "app.md", fm: appFm, body: appBody.join("\n"), keepDefault: true });

  // --- merge with what is already on disk, then render ---
  const out = resolve(outDir);
  const files = new Map();
  const existing = new Map(walkMd(out).map((p) => [p, readFileSync(join(out, p), "utf8")]));
  const changed = [];
  const created = [];

  for (const concept of concepts) {
    const old = existing.get(concept.path);
    let fm = concept.fm;
    let body = concept.body;
    if (old !== undefined) {
      const parsedOld = parseFrontmatter(old);
      const blocks = extractKeepBlocks(parsedOld.body, concept.path);
      if (parsedOld.data) {
        const extras = Object.fromEntries(Object.entries(parsedOld.data).filter(([k]) => !OWNED_KEYS.has(k) && !(k in fm)));
        fm = { ...fm, ...extras };
      }
      if (blocks.length > 0) body = applyKeepBlocks(body, blocks, concept.path, warnings);
      else if (concept.keepDefault) body = `${body}\n\n${KEEP_TEMPLATE.join("\n")}`;
    } else if (concept.keepDefault) {
      body = `${body}\n\n${KEEP_TEMPLATE.join("\n")}`;
    }
    const text = `${frontmatter(fm)}\n${body.replace(/\s+$/, "")}\n`;
    files.set(concept.path, text);
    if (old === undefined) created.push(concept.path);
    else if (old !== text) changed.push(concept.path);
  }

  // --- index.md ---
  const section = (heading, items) =>
    items.length === 0 ? [] : [`# ${heading}`, "", ...items.map((i) => `* [${i.title}](${i.path}) - ${oneLine(i.description)}`), ""];
  const index = [
    "---",
    `okf_version: "${OKF_VERSION}"`,
    "---",
    "",
    ...section("App", [{ path: "app.md", title: res.name, description: appFm.description }]),
    ...section("Tables", links.tables),
    ...section("Views", links.views),
    ...section("KV prefixes", links.kv),
    ...section("History", [{ path: "log.md", title: "Update log", description: "Dated history of changes to this bundle." }]),
  ];
  files.set("index.md", `${index.join("\n").replace(/\s+$/, "")}\n`);

  // --- log.md ---
  const when = date ?? new Date().toISOString().slice(0, 10);
  const label = (p) => `[${p.replace(/\.md$/, "")}](/${p})`;
  const entries = [];
  if (!existing.has("index.md") || !existing.has("log.md")) {
    entries.push(`**Creation**: Generated the bundle from ${code(basename(manifestPath))}: ${plural(links.tables.length, "table")}, ${plural(links.views.length, "view")}, ${plural(links.kv.length, "KV prefix", "KV prefixes")}.`);
  } else {
    const fresh = created.map((p) => ({ kind: "Creation", p }));
    const updated = changed.map((p) => ({ kind: "Update", p }));
    const all = [...fresh, ...updated];
    if (all.length > 8) entries.push(`**Update**: Regenerated the bundle from ${code(basename(manifestPath))}: ${fresh.length} concepts added, ${updated.length} updated.`);
    else for (const e of all) entries.push(`**${e.kind}**: ${e.kind === "Creation" ? "Added" : "Regenerated"} ${label(e.p)}.`);
  }
  files.set("log.md", updateLog(existing.get("log.md"), when, entries));

  const stale = [...existing.keys()].filter((p) => !files.has(p));
  for (const p of stale) warnings.push(`${p}: not produced by this run (dropped from the schema or manifest, or hand-written). Left in place; delete it or move it into knowledge-src/`);

  return { files, warnings, created, changed, stale, appId: res.appId };
}

export function updateLog(old, date, entries) {
  if (entries.length === 0 && old !== undefined) return old;
  const bullets = entries.map((e) => `* ${e}`);
  if (old === undefined) return `# Update Log\n\n## ${date}\n${bullets.join("\n")}\n`;
  const lines = old.replace(/\s+$/, "").split("\n");
  const firstSection = lines.findIndex((l) => /^## /.test(l));
  const fresh = bullets.filter((b) => !lines.includes(b));
  if (fresh.length === 0) return old;
  if (firstSection >= 0 && lines[firstSection].trim() === `## ${date}`) {
    let end = lines.findIndex((l, i) => i > firstSection && /^## /.test(l));
    if (end < 0) end = lines.length;
    while (end > firstSection + 1 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, ...fresh);
  } else {
    const at = firstSection >= 0 ? firstSection : lines.length;
    const block = [`## ${date}`, ...fresh, ""];
    if (at === lines.length && lines[lines.length - 1].trim() !== "") block.unshift("");
    lines.splice(at, 0, ...block);
  }
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

export function writeBundle(files, outDir) {
  const written = [];
  for (const [rel, text] of files) {
    const path = join(outDir, rel);
    if (readIfExists(path) === text) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    written.push(rel);
  }
  return written;
}
