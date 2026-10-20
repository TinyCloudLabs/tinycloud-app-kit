// Browser-side stand-in for "@tinycloud/app" used by dev/serve.mjs: forwards each call to the
// local dev server (which holds the node-sdk session). Same result shapes as dev/shim.mjs.
const b64 = {
  enc: (u8) => btoa(String.fromCharCode(...u8)),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function call(op, args) {
  const wire = { ...args };
  if (wire.body instanceof Uint8Array) wire.body = { b64: b64.enc(wire.body) };
  const token = document.querySelector('meta[name="bridge-token"]')?.content ?? "";
  const res = await fetch("/bridge", { method: "POST", headers: { "content-type": "application/json", "x-bridge-token": token }, body: JSON.stringify({ op, args: wire }) });
  if (!res.ok) return { ok: false, error: { code: "INTERNAL", message: `dev server answered ${res.status}` } };
  const out = await res.json();
  if (out.ok && out.bytesB64 !== undefined) {
    out.bytes = b64.dec(out.bytesB64);
    delete out.bytesB64;
  }
  return out;
}

export const kv = {
  get: (key) => call("kv.get", { key }),
  put: (key, body, opts = {}) => call("kv.put", { key, body, opts }),
  list: (prefix = "") => call("kv.list", { prefix }),
  del: (key) => call("kv.del", { key }),
};
export const sql = {
  query: (db, text, params = []) => call("sql.query", { db, text, params }),
  execute: (db, text, params = []) => call("sql.execute", { db, text, params }),
};
