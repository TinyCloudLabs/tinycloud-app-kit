// Local dev server: a throwaway native node + the shim, with the app in a real browser.
//   node dev/serve.mjs [--port 5174] [--seed] [--long]
//   --long adds one recipe with very long unbroken text, to look at wrapping.
// Stands up both apps for one owner: the Health Log (its data is read across apps) and
// this one. The browser only talks to this server's /bridge endpoint; the server holds the
// manifest-scoped sessions, so the page never sees a key.
// Add ?theme=dark or ?theme=light to the URL to force a colour scheme (default: the browser's).
import { build } from "esbuild";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApp, SHARED } from "./build.mjs";
import { freshStack } from "../tests/lib/stack.mjs";
import { stopAllNodes } from "../tests/lib/node.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 5174;
const seed = args.includes("--seed");
const long = args.includes("--long");

// Cleanup first, then start anything: the handlers exist before the node child does, so a signal at any point
// (including while the node is still starting) stops the child this process started, by handle, and removes its
// temp dir. `stop` is idempotent.
let server;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    server?.close();
    await stopAllNodes();
  } finally {
    process.exit(code);
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));
process.on("uncaughtException", (e) => (console.error(e), stop(1)));
process.on("unhandledRejection", (e) => (console.error(e), stop(1)));

// Nothing is started if the port is taken.
await new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
}).catch((e) => {
  console.error(`port ${port} is not available (${e.code ?? e.message}); nothing was started`);
  process.exit(1);
});

const stack = await freshStack();
try {
await stack.install();
const bridge = stack.recipes;

if (seed) {
  const day = (ago) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
  await stack.provisionHealth();
  const meals = {};
  for (const [ago, slot, name, kcal, p, c, f] of [
    [3, "dinner", "Salmon, rice and broccoli", 650, 42, 60, 24],
    [2, "lunch", "Lentil soup", 420, 24, 58, 9],
    [1, "dinner", "Veg curry with rice", 610, 19, 84, 21],
    [0, "breakfast", "Oats with berries", 310, 11, 52, 6],
    [0, "lunch", "Chicken burrito bowl", 790, 41, 92, 25],
  ]) {
    meals[name] = await stack.writeHealthMeal({ day: day(ago), slot, name, kcal, protein_g: p, carbs_g: c, fat_g: f });
  }

  const app = await loadApp();
  await app.ensureSchema();
  for (const name of ["Weeknight dinners", "Breakfasts", "Soups and stews"]) await app.createShelf(name);
  const [dinners, breakfasts, soups] = (await app.listShelves()).map((s) => s.id);
  const make = (over) => {
    const v = app.validateForm({ ...app.blankForm(), ...over });
    if (v.error) throw new Error(v.error);
    return v.fields;
  };
  const kcalOf = { "Salmon, rice and broccoli": [3, 650], "Oats with berries": [0, 310] };
  const link = (name) => ({ health_meal_id: meals[name], meal_day: day(kcalOf[name][0]), meal_name: name, meal_kcal: kcalOf[name][1] });
  await app.saveRecipe({
    fields: make({
      title: "Salmon, rice and broccoli",
      origin: "from_meal",
      summary: "Started from a dinner you logged: roast salmon over rice with steamed broccoli.",
      servings: "1",
      prep_min: "10",
      cook_min: "20",
      ingredients: [{ qty: "150 g", item: "salmon fillet" }, { qty: "1 cup", item: "cooked rice" }, { qty: "1 head", item: "broccoli" }],
      steps: "Roast the salmon at 200 C for 12 minutes.\nSteam the broccoli.\nServe on the rice.",
      kcal: "650", protein_g: "42", carbs_g: "60", fat_g: "24", nutrition_basis: "copied_from_meal", favorite: true,
    }),
    shelfIds: [dinners], links: [link("Salmon, rice and broccoli")],
  });
  await app.saveRecipe({
    fields: make({
      title: "Red lentil soup",
      summary: "Thick, warming, freezes well.",
      servings: "4", prep_min: "10", cook_min: "25",
      ingredients: [{ qty: "1 cup", item: "red lentils" }, { qty: "1", item: "onion, diced" }, { qty: "1 tsp", item: "cumin" }, { qty: "1 l", item: "vegetable stock" }],
      steps: "Sweat the onion with the cumin.\nAdd lentils and stock.\nSimmer for 20 minutes, then blend half.",
      kcal: "420", protein_g: "24", carbs_g: "58", fat_g: "9", nutrition_basis: "estimate",
    }),
    shelfIds: [dinners, soups], links: [],
  });
  await app.saveRecipe({
    fields: make({
      title: "Overnight oats",
      origin: "from_meal",
      summary: "Oats, yogurt and berries, ready when you wake up.",
      servings: "1", prep_min: "5",
      ingredients: [{ qty: "50 g", item: "rolled oats" }, { qty: "120 g", item: "yogurt" }, { qty: "a handful", item: "berries" }],
      steps: "Stir everything together.\nChill overnight.",
      kcal: "310", protein_g: "11", carbs_g: "52", fat_g: "6", nutrition_basis: "copied_from_meal",
    }),
    shelfIds: [breakfasts], links: [link("Oats with berries")],
  });
  if (long) {
    await app.createShelf("H".repeat(80));
    await app.saveRecipe({
      fields: make({ title: "T".repeat(190), summary: "S".repeat(300), ingredients: [{ qty: "Q".repeat(60), item: "I".repeat(120) }], steps: "P".repeat(400), kcal: "100", nutrition_basis: "estimate" }),
      shelfIds: [dinners], links: [],
    });
  }
  await app.saveRecipe({ fields: make({ title: "Plain pancakes", origin: "adapted", summary: "Fluffy, from a friend's recipe, with less sugar.", servings: "2" }), shelfIds: [breakfasts], links: [] });
}

const bundle = await build({
  entryPoints: [join(ROOT, "dev/browser-entry.jsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: { "@tinycloud/app": join(SHARED, "dev/browser-bridge.mjs") },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const appJs = bundle.outputFiles[0].text;
const tailwind = readFileSync(join(ROOT, "node_modules/@tailwindcss/browser/dist/index.global.js"));
const token = randomBytes(24).toString("hex");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="bridge-token" content="${token}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recipes</title>
<script>{const t = new URLSearchParams(location.search).get("theme"); if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");}</script>
<style type="text/tailwindcss">@custom-variant dark (&:where(.dark, .dark *));</style>
<script src="/tailwind.js"></script></head><body class="bg-stone-50 dark:bg-stone-950"><div id="root"></div><script src="/app.js"></script></body></html>`;

// The /bridge endpoint drives a node session, so it is not open to arbitrary web pages: it is bound to
// 127.0.0.1, answers only for this server's own Host/Origin, and needs a per-run random token that only
// the served page can read (same-origin; no CORS headers are ever sent). Same rules as the Health Log.
const ownHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const tokenOk = (given) => {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};
const MAX_BODY = 2_000_000;

server = createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  if (!ownHosts.has(req.headers.host ?? "")) return send(403, "text/plain", "forbidden host"); // DNS rebinding
  const path = (req.url ?? "").split("?")[0];
  if (req.method === "GET" && path === "/") return send(200, "text/html", html);
  if (req.method === "GET" && path === "/app.js") return send(200, "text/javascript", appJs);
  if (req.method === "GET" && path === "/tailwind.js") return send(200, "text/javascript", tailwind);
  if (req.method === "POST" && path === "/bridge") {
    const origin = req.headers.origin;
    if (origin !== undefined && ![...ownHosts].some((h) => origin === `http://${h}`)) return send(403, "text/plain", "forbidden origin");
    if (!tokenOk(req.headers["x-bridge-token"])) return send(403, "text/plain", "bad token");
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(415, "text/plain", "json only");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, "text/plain", "too large");
    }
    let op, a;
    try {
      ({ op, args: a } = JSON.parse(raw));
      if (typeof op !== "string" || a === null || typeof a !== "object") throw new Error("shape");
    } catch {
      return send(400, "text/plain", "bad request");
    }
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
server.once("error", (e) => {
  console.error(`cannot serve on 127.0.0.1:${port}: ${e.code ?? e.message}`);
  stop(1);
});
server.listen(port, "127.0.0.1", () => console.log(`recipes dev server: http://127.0.0.1:${port}/`));
} catch (e) {
  console.error(e);
  await stop(1);
}
