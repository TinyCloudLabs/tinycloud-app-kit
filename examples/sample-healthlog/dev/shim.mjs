// Dev shim for the `@tinycloud/app` bridge, backed by @tinycloud/node-sdk.
//
//   import { sql, kv } from "@tinycloud/app";        // what app.jsx writes
//   → in tests, esbuild aliases "@tinycloud/app" to this file, and a test calls
//     `await connect({ host, manifest, privateKey })` once before rendering.
//
// It plays the role of the PARENT page in the real runner (PLAN-TINYAPPS.md
// T5b): the app only ever sees result objects, never a session, key or URL.
// It mirrors what the parent does: a per-call check against the app's own
// resolved manifest, message-size / in-flight / timeout caps, and error codes.
// The node stays the authority for SQL (and anything else it enforces).
//
// ------------------------------------------------------------------ CONTRACT
// Nothing here throws: every call resolves to `{ ok: true, ... }` or
// `{ ok: false, error: { code, message } }`.
//
//   kv.get(key)                          -> { ok, bytes: Uint8Array, contentType? }
//   kv.put(key, body, opts?)             -> { ok }        body: string | Uint8Array
//                                           opts: { contentType?: string, ifNoneMatch?: true };
//                                           null/undefined opts mean {}, anything else that is
//                                           not a plain object of those keys is BAD_REQUEST
//   kv.list(prefix = "")                 -> { ok, keys: string[], truncated }
//   kv.del(key)                          -> { ok }
//   sql.query(db, text, params = [])     -> { ok, columns: string[], rows: any[][], rowCount }
//   sql.execute(db, text, params = [])   -> { ok, changes, lastInsertRowId }
//
// Paths: `key` and `db` are relative to `<app_id>/` ("prefs/goals.json",
// "healthlog"). A leading "/" means an absolute path in the space; it is
// checked against the manifest like any other path, so it only succeeds where a
// grant covers it. `kv.list(prefix)` needs a grant that covers `prefix` (here:
// none covers the bare app root, so `kv.list("")` is PERMISSION_DENIED) and
// returns keys in the same relative form. params: string | number | boolean | null.
// Statement classes: `sql.query` accepts ONE read-only statement (see classifySql),
// `sql.execute` one write or schema statement; the class decides the ability
// checked against the manifest. The node enforces by ability, not by call name.
// Error codes: PERMISSION_DENIED NOT_FOUND PRECONDITION_FAILED SQL_ERROR
//   BAD_REQUEST TOO_LARGE BUSY TIMEOUT INTERNAL NOT_CONNECTED
// Caps: 1 MB per call (size of the arguments: strings as UTF-8, binary as is,
//   8 bytes per other value), 4 in flight (the 5th is
//   refused with BUSY, not queued), 30 s per call (TIMEOUT: the call may still
//   have been applied, so read back before retrying a write).
// ---------------------------------------------------------------------------

import { TinyCloudNode, resolveManifest, validateManifest } from "@tinycloud/node-sdk";

export const LIMITS = Object.freeze({ maxMessageBytes: 1_000_000, maxInFlight: 4, timeoutMs: 30_000 });

// Shared on globalThis so that every bundled copy of this module (the app is
// bundled with its own copy) talks to the connection the test opened.
const SLOT = Symbol.for("tinycloud.app.bridge.dev");
const err = (code, message) => ({ ok: false, error: { code, message } });
const notConnected = () => err("NOT_CONNECTED", "Bridge not connected (dev shim: call connect() first).");

// ------------------------------------------------------------- manifest check

function covers(grantPath, target) {
  if (grantPath.endsWith("/")) return target.startsWith(grantPath);
  return target === grantPath;
}

function makeAuthorizer(manifest) {
  const resolved = resolveManifest(manifest);
  const grants = resolved.resources.filter((r) => r.service === "tinycloud.kv" || r.service === "tinycloud.sql");
  return (service, path, action) =>
    grants.some(
      (g) =>
        g.service === service &&
        (g.space === resolved.space || g.space === undefined) &&
        g.actions.includes(`${service}/${action}`) &&
        covers(g.path, path),
    );
}

/**
 * T5b: the real bridge MUST implement this classification.
 *
 * tinycloud-node enforces SQL by the ABILITY the delegation carries (read / write /
 * schema), not by which call the client used: on v1.20.6 and v1.21.0 a `DROP TABLE`
 * sent to the query endpoint with a schema-capable delegation executes. So the parent
 * has to classify every statement itself, refuse what it cannot classify, and only then
 * check the manifest for that class.
 *
 *   -> "read"    exactly ONE statement: SELECT, VALUES, a read-only WITH ... SELECT, or
 *                EXPLAIN [QUERY PLAN] of one of those
 *   -> "write"   exactly ONE INSERT / UPDATE / DELETE / REPLACE (also WITH ... INSERT|UPDATE|DELETE)
 *   -> "schema"  exactly ONE CREATE / DROP / ALTER / REINDEX
 *   -> null      anything else: empty or unterminated text, more than one statement (a `;`
 *                outside literals and comments, except one trailing), PRAGMA, ATTACH, DETACH,
 *                VACUUM, load_extension anywhere, WITH ... with a schema/maintenance word,
 *                or any other first word.
 *
 * `sql.query` accepts only "read"; `sql.execute` only "write" and "schema".
 * Comments and string / quoted-identifier literals are blanked first, so keywords inside
 * them never count and nothing can hide behind them.
 */
export function classifySql(text) {
  if (typeof text !== "string") return null;
  const code = blankLiteralsAndComments(text);
  if (code === null) return null;
  // one statement: drop a single trailing `;`, then no other `;` may remain
  const body = code.replace(/;\s*$/, "").trim();
  if (body === "" || body.includes(";")) return null;
  const words = body.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.map((w) => w.toUpperCase()) ?? [];
  if (words.length === 0 || words.includes("LOAD_EXTENSION")) return null;
  const first = words[0];
  const has = (...ws) => ws.some((w) => words.includes(w));
  // REPLACE( is the string function; a bare REPLACE is the statement
  const replaceStatement = /\bREPLACE\b(?!\s*\()/i.test(body);

  if (first === "SELECT" || first === "VALUES") return "read";
  if (first === "EXPLAIN") {
    const rest = body.replace(/^\s*EXPLAIN\s+(QUERY\s+PLAN\s+)?/i, "");
    return classifySql(rest) === "read" ? "read" : null;
  }
  if (first === "WITH") {
    if (has("CREATE", "DROP", "ALTER", "REINDEX", "PRAGMA", "ATTACH", "DETACH", "VACUUM")) return null;
    return has("INSERT", "UPDATE", "DELETE") || replaceStatement ? "write" : "read";
  }
  if (first === "INSERT" || first === "UPDATE" || first === "DELETE" || (first === "REPLACE" && replaceStatement)) return "write";
  if (first === "CREATE" || first === "DROP" || first === "ALTER" || first === "REINDEX") return "schema";
  return null; // PRAGMA, ATTACH, DETACH, VACUUM, BEGIN, COMMIT, ... and anything unknown
}

/** Replace comments with a space and literals with empty ones; null if one is unterminated. */
function blankLiteralsAndComments(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "-" && n === "-") {
      const e = text.indexOf("\n", i);
      i = e === -1 ? text.length : e + 1;
      out += " ";
    } else if (c === "/" && n === "*") {
      const e = text.indexOf("*/", i + 2);
      if (e === -1) return null;
      i = e + 2;
      out += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      for (;;) {
        if (j >= text.length) return null;
        if (text[j] === c) {
          if (text[j + 1] === c) j += 2; // doubled quote is an escaped quote
          else break;
        } else j += 1;
      }
      out += `${c}${c}`;
      i = j + 1;
    } else if (c === "[") {
      const e = text.indexOf("]", i + 1);
      if (e === -1) return null;
      out += '""';
      i = e + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// ------------------------------------------------------------------- plumbing

/** Size in bytes of call arguments; null when they are not plain data (circular, odd objects). */
function sizeOf(value) {
  let bytes = 0;
  const seen = new Set();
  const walk = (v) => {
    if (v instanceof Uint8Array) bytes += v.byteLength;
    else if (typeof v === "string") bytes += Buffer.byteLength(v);
    else if (Array.isArray(v) || (v && typeof v === "object")) {
      if (seen.has(v)) throw new TypeError("circular");
      seen.add(v);
      for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
      seen.delete(v);
    } else bytes += 8;
  };
  try {
    walk(value);
  } catch {
    return null;
  }
  return bytes;
}

function badPath(p) {
  return typeof p !== "string" || p.length === 0 || p.length > 1024 || p.includes("\0") || p.split("/").includes("..");
}

function mapNodeError(e) {
  const code = e?.code ?? "";
  const message = String(e?.message ?? "request failed").slice(0, 500);
  if (code === "KV_NOT_FOUND") return err("NOT_FOUND", message);
  if (code === "KV_PRECONDITION_FAILED") return err("PRECONDITION_FAILED", message);
  if (/UNAUTHORIZED|PERMISSION|FORBIDDEN/.test(code)) return err("PERMISSION_DENIED", message);
  if (code.startsWith("SQL_")) return err("SQL_ERROR", message);
  return err("INTERNAL", message);
}

/** Copy of kv.put options as plain data, or null if they are not { contentType?: string, ifNoneMatch?: true }. */
function cleanPutOpts(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    const keys = Object.keys(raw);
    if (keys.some((k) => k !== "contentType" && k !== "ifNoneMatch")) return null;
    const out = {};
    if (raw.contentType !== undefined) {
      if (typeof raw.contentType !== "string" || raw.contentType.length > 200) return null;
      out.contentType = raw.contentType;
    }
    if (raw.ifNoneMatch !== undefined) {
      if (raw.ifNoneMatch !== true) return null;
      out.ifNoneMatch = true;
    }
    return out;
  } catch {
    return null; // a throwing getter or proxy
  }
}

const PARAM_OK = (p) => p === null || ["string", "number", "boolean"].includes(typeof p);

/**
 * Open a dev bridge.
 * @param {object} o
 * @param {object} o.manifest   the app's manifest (what the runner would sign)
 * @param {string} [o.host]     tinycloud-node URL
 * @param {string} [o.privateKey] hex wallet key of the owner (dev only)
 * @param {TinyCloudNode} [o.node] an already signed-in node-sdk client instead
 * @param {Partial<typeof LIMITS>} [o.limits]
 */
export async function connect({ manifest, host, privateKey, node, limits = {} }) {
  const m = validateManifest(manifest);
  let tc = node;
  if (!tc) {
    tc = new TinyCloudNode({ privateKey, host, prefix: "healthlog-dev", autoCreateSpace: true, manifest: m });
    await tc.signIn();
  }
  const prefix = m.prefix !== undefined ? m.prefix : m.app_id;
  const root = prefix === "" ? "" : `${prefix}/`;
  const allowed = makeAuthorizer(m);
  const cfg = { ...LIMITS, ...limits };
  let inFlight = 0;
  const faults = []; // test-only: { match(req) -> bool, times, code, phase }

  const absolute = (rel) => (rel.startsWith("/") ? rel.slice(1) : `${root}${rel}`);
  const relative = (abs) => (root && abs.startsWith(root) ? abs.slice(root.length) : `/${abs}`);

  /** Runs one bridge call with the caps, then applies any injected fault. */
  async function call(op, args, run) {
    const req = { op, args };
    const size = sizeOf(args);
    if (size === null) return err("BAD_REQUEST", "Arguments must be plain data.");
    if (size > cfg.maxMessageBytes) return err("TOO_LARGE", `Call exceeds ${cfg.maxMessageBytes} bytes.`);
    if (inFlight >= cfg.maxInFlight) return err("BUSY", `More than ${cfg.maxInFlight} calls in flight.`);
    inFlight += 1;
    let timer;
    try {
      const drop = faults.find((f) => f.phase === "before" && f.times > 0 && f.match(req));
      if (drop) {
        drop.times -= 1;
        return err(drop.code, "Injected: the call was dropped before it was applied.");
      }
      const result = await Promise.race([
        run().catch((e) => mapNodeError(e)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(err("TIMEOUT", `No answer within ${cfg.timeoutMs} ms.`)), cfg.timeoutMs);
        }),
      ]);
      const fault = faults.find((f) => f.phase === "after" && f.times > 0 && f.match(req));
      if (fault && result.ok) {
        fault.times -= 1;
        return err(fault.code, "Injected: the call was applied but its response was lost.");
      }
      return result;
    } finally {
      clearTimeout(timer);
      inFlight -= 1;
    }
  }

  const kvOp = (op, action, path, args, run) => {
    // kv.list("") names the app's whole prefix (and is then checked like any path); every other path must be non-empty.
    if (!(op === "list" && path === "") && badPath(path)) return Promise.resolve(err("BAD_REQUEST", `Invalid path for kv.${op}.`));
    const abs = path.startsWith("/") ? path.slice(1) : absolute(path);
    if (!allowed("tinycloud.kv", abs, action)) {
      return Promise.resolve(err("PERMISSION_DENIED", `The app's manifest does not allow kv ${action} on ${path}.`));
    }
    return call(`kv.${op}`, args, () => run(abs));
  };

  const sqlOp = (op, db, text, params, kind) => {
    if (badPath(db)) return Promise.resolve(err("BAD_REQUEST", "Invalid database name."));
    if (typeof text !== "string" || text.length === 0) return Promise.resolve(err("BAD_REQUEST", "Empty SQL."));
    if (!Array.isArray(params) || !params.every(PARAM_OK)) return Promise.resolve(err("BAD_REQUEST", "Invalid params."));
    const cls = classifySql(text);
    if (op === "query" ? cls !== "read" : cls === null || cls === "read") {
      return Promise.resolve(err("BAD_REQUEST", `${op} does not accept this statement type.`));
    }
    const abs = absolute(db);
    if (!allowed("tinycloud.sql", abs, cls)) {
      return Promise.resolve(err("PERMISSION_DENIED", `The app's manifest does not allow sql ${cls} on ${db}.`));
    }
    return call(`sql.${op}`, { db, text, params }, async () => {
      const handle = tc.sql.db(abs);
      const r = kind === "query" ? await handle.query(text, params) : await handle.execute(text, params);
      if (!r.ok) return mapNodeError(r.error);
      return kind === "query"
        ? { ok: true, columns: r.data.columns, rows: r.data.rows, rowCount: r.data.rowCount }
        : { ok: true, changes: r.data.changes, lastInsertRowId: r.data.lastInsertRowId };
    });
  };

  // Nothing the app passes in may make a bridge call throw or reject.
  const safe = (fn) => (...a) =>
    new Promise((resolve) => {
      try {
        Promise.resolve(fn(...a)).then(resolve, (e) => resolve(err("INTERNAL", String(e?.message ?? e).slice(0, 500))));
      } catch (e) {
        resolve(err("INTERNAL", String(e?.message ?? e).slice(0, 500)));
      }
    });

  const bridge = {
    kv: {
      get: safe((key) =>
        kvOp("get", "get", key, { key }, async (abs) => {
          const r = await tc.kv.get(abs, { binary: true });
          if (!r.ok) return mapNodeError(r.error);
          const d = r.data.data;
          const bytes = d instanceof Uint8Array ? d : typeof d === "string" ? new TextEncoder().encode(d) : Uint8Array.from(Object.values(d));
          return { ok: true, bytes, contentType: r.data.headers?.contentType };
        }),
      ),
      put: safe((key, body, rawOpts) => {
        if (typeof body !== "string" && !(body instanceof Uint8Array)) return err("BAD_REQUEST", "body must be a string or Uint8Array.");
        const opts = cleanPutOpts(rawOpts);
        if (opts === null) return err("BAD_REQUEST", "opts must be { contentType?: string, ifNoneMatch?: true }.");
        return kvOp("put", "put", key, { key, body, opts }, async (abs) => {
          const r = await tc.kv.put(abs, body, {
            contentType: opts.contentType ?? (typeof body === "string" ? "text/plain" : "application/octet-stream"),
            ...(opts.ifNoneMatch ? { ifNoneMatch: "*" } : {}),
          });
          return r.ok ? { ok: true } : mapNodeError(r.error);
        });
      }),
      list: safe((prefixRel = "") =>
        kvOp("list", "list", prefixRel, { prefix: prefixRel }, async (abs) => {
          const r = await tc.kv.list({ prefix: abs });
          if (!r.ok) return mapNodeError(r.error);
          return { ok: true, keys: r.data.keys.map(relative), truncated: Boolean(r.data.truncated) };
        }),
      ),
      del: safe((key) =>
        kvOp("del", "del", key, { key }, async (abs) => {
          const r = await tc.kv.delete(abs);
          return r.ok ? { ok: true } : mapNodeError(r.error);
        }),
      ),
    },
    sql: {
      query: safe((db, text, params = []) => sqlOp("query", db, text, params, "query")),
      execute: safe((db, text, params = []) => sqlOp("execute", db, text, params, "execute")),
    },
    // ---- dev/test handles (never part of the app-facing contract) ----
    node: tc,
    inFlight: () => inFlight,
    /**
     * Test-only faults: for the next `times` calls where `match(req)` is true, answer
     * TIMEOUT. phase "after" (default): the call WAS applied, its response is lost.
     * phase "before": the call is dropped and NOT applied.
     */
    injectFault(match, { times = 1, code = "TIMEOUT", phase = "after" } = {}) {
      faults.push({ match, times, code, phase });
    },
    close() {
      globalThis[SLOT] = undefined;
    },
  };
  globalThis[SLOT] = bridge;
  return bridge;
}

const current = () => globalThis[SLOT];

/** App-facing module surface (what `import { sql, kv } from "@tinycloud/app"` gives). */
export const kv = {
  get: (...a) => current()?.kv.get(...a) ?? Promise.resolve(notConnected()),
  put: (...a) => current()?.kv.put(...a) ?? Promise.resolve(notConnected()),
  list: (...a) => current()?.kv.list(...a) ?? Promise.resolve(notConnected()),
  del: (...a) => current()?.kv.del(...a) ?? Promise.resolve(notConnected()),
};

export const sql = {
  query: (...a) => current()?.sql.query(...a) ?? Promise.resolve(notConnected()),
  execute: (...a) => current()?.sql.execute(...a) ?? Promise.resolve(notConnected()),
};
