// Local dev server: a throwaway native node + the shim, with the app in a real browser.
//   node dev/serve.mjs [--port 5173] [--seed]
// The browser only talks to this server's /bridge endpoint; the server holds the session.
import { build } from "esbuild";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./shim.mjs";
import { loadApp } from "./build.mjs";
import { startNode } from "../tests/lib/node.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 5173;
const seed = args.includes("--seed");

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const node = await startNode();
const bridge = await connect({ manifest, host: node.host, privateKey: randomBytes(32).toString("hex") });
await bridge.node.kv.put(`${manifest.app_id}/app/schema.sql`, readFileSync(join(ROOT, "schema.sql"), "utf8"), { contentType: "text/plain" });

if (seed) {
  const { ensureSchema, logMeal, logWeight, addDays, localDay } = await loadApp();
  await ensureSchema();
  const today = localDay();
  const meals = [
    [6, "breakfast", "Oats and berries", 380, 14, 62, 8], [6, "dinner", "Chicken stir fry", 720, 48, 65, 26],
    [5, "lunch", "Tuna sandwich", 510, 32, 55, 17], [5, "dinner", "Pasta bolognese", 880, 38, 105, 30],
    [4, "breakfast", "Yogurt and granola", 340, 18, 44, 9], [4, "lunch", "Lentil soup", 420, 24, 58, 9], [4, "dinner", "Salmon and rice", 650, 42, 60, 24],
    [2, "lunch", "Burrito bowl", 790, 41, 92, 25], [2, "dinner", "Veg curry", 610, 19, 84, 21],
    [1, "breakfast", "Eggs and toast", 450, 26, 33, 22], [1, "lunch", "Caesar salad", 520, 29, 22, 34], [1, "dinner", "Pizza", 940, 36, 112, 38],
    [0, "breakfast", "Greek yogurt", 180, 17, 9, 8], [0, "lunch", "Lentil soup", 420, 24, 58, 9],
  ];
  for (const [ago, slot, name, kcal, p, c, f] of meals) {
    await logMeal({ slot, name, kcal, protein_g: p, carbs_g: c, fat_g: f }, { day: addDays(today, -ago), now: new Date(), source: "import" });
  }
  for (const [ago, kg] of [[6, 82.1], [4, 81.8], [2, 81.5], [1, 81.6], [0, 81.2]]) {
    await logWeight({ weight_kg: kg }, { day: addDays(today, -ago), now: new Date(), source: "import" });
  }
}

const bundle = await build({
  entryPoints: [join(ROOT, "dev/browser-entry.jsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: { "@tinycloud/app": join(ROOT, "dev/browser-bridge.mjs") },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const appJs = bundle.outputFiles[0].text;
const tailwind = readFileSync(join(ROOT, "node_modules/@tailwindcss/browser/dist/index.global.js"));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Health Log (sample)</title><script src="/tailwind.js"></script></head><body class="bg-neutral-50 dark:bg-neutral-950"><div id="root"></div><script src="/app.js"></script></body></html>`;

const server = createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
  if (req.method === "GET" && req.url === "/") return send(200, "text/html", html);
  if (req.method === "GET" && req.url === "/app.js") return send(200, "text/javascript", appJs);
  if (req.method === "GET" && req.url === "/tailwind.js") return send(200, "text/javascript", tailwind);
  if (req.method === "POST" && req.url === "/bridge") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { op, args: a } = JSON.parse(raw);
    const [svc, fn] = op.split(".");
    let out;
    if (svc === "kv" && fn === "get") out = await bridge.kv.get(a.key);
    else if (svc === "kv" && fn === "put") out = await bridge.kv.put(a.key, a.body?.b64 ? Buffer.from(a.body.b64, "base64") : a.body, a.opts);
    else if (svc === "kv" && fn === "list") out = await bridge.kv.list(a.prefix);
    else if (svc === "kv" && fn === "del") out = await bridge.kv.del(a.key);
    else if (svc === "sql" && fn === "query") out = await bridge.sql.query(a.db, a.text, a.params);
    else if (svc === "sql" && fn === "execute") out = await bridge.sql.execute(a.db, a.text, a.params);
    else out = { ok: false, error: { code: "BAD_REQUEST", message: "unknown op" } };
    if (out.ok && out.bytes) out = { ...out, bytes: undefined, bytesB64: Buffer.from(out.bytes).toString("base64") };
    return send(200, "application/json", JSON.stringify(out));
  }
  return send(404, "text/plain", "not found");
});
server.listen(port, "127.0.0.1", () => console.log(`health log dev server: http://127.0.0.1:${port}/`));

async function shutdown() {
  server.close();
  bridge.close();
  await node.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
