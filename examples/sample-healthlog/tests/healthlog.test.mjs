// Shim-driven app logic against a real local tinycloud-node (native, no Docker).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadApp } from "../dev/build.mjs";
import { freshStack, manifest } from "./lib/env.mjs";
import { nodeSkipReason } from "./lib/node.mjs";
import { sql, kv } from "../dev/shim.mjs";

const SKIP = nodeSkipReason(); // no prebuilt tinycloud-node binary: every suite below is reported as skipped, with the reason
if (SKIP) console.warn(`SKIP: ${SKIP}`);

const DAY = "2026-10-20";
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00Z`);

let stack;
let app;

before(async () => {
  if (SKIP) return;
  app = await loadApp();
  stack = await freshStack();
  await stack.install();
});
after(async () => {
  await stack?.stop();
});

const count = async (table, where = "1=1", params = []) =>
  (await sql.query("healthlog", `SELECT COUNT(*) FROM ${table} WHERE ${where}`, params)).rows[0][0];

describe("provision + day_card", { skip: SKIP }, () => {
  test("ensureSchema creates tables and views from the installed app/schema.sql, then is a no-op", async () => {
    const first = await app.ensureSchema();
    assert.deepEqual(first, { ok: true, created: true });
    const names = (await sql.query("healthlog", "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map((r) => r[0]);
    assert.deepEqual(names.filter((n) => ["day_card", "meal", "week_rollup", "weight"].includes(n)), ["day_card", "meal", "week_rollup", "weight"]);
    assert.deepEqual(await app.ensureSchema(), { ok: true, created: false });
  });

  test("log a meal + a weight -> day_card reflects both", async () => {
    const meal = await app.logMeal(
      { slot: "lunch", name: "Lentil soup", kcal: "420", protein_g: "24", carbs_g: "58", fat_g: "9" },
      { now: at("12:30"), day: DAY },
    );
    assert.equal(meal.ok, true);
    assert.equal(meal.duplicate, false);
    assert.equal(meal.row.name, "Lentil soup");
    assert.equal(meal.row.kcal, 420);

    const w = await app.logWeight({ weight_kg: "81.4" }, { now: at("07:10"), day: DAY });
    assert.equal(w.ok, true);
    assert.equal(w.row.weight_kg, 81.4);

    const raw = await sql.query("healthlog", "SELECT day, kcal, protein_g, carbs_g, fat_g, meals, weight_kg FROM day_card WHERE day = ?", [DAY]);
    assert.deepEqual(raw.rows, [[DAY, 420, 24, 58, 9, 1, 81.4]]);

    const today = await app.loadToday(DAY);
    assert.equal(today.ok, true);
    assert.equal(today.card.kcal, 420);
    assert.equal(today.card.weight_kg, 81.4);
    assert.equal(today.meals.length, 1);
  });

  test("day_card sums several meals and uses the latest weight of the day", async () => {
    await app.logMeal({ slot: "dinner", name: "Salmon and rice", kcal: 650, protein_g: 42, carbs_g: 60, fat_g: 24 }, { now: at("19:00"), day: DAY });
    await app.logWeight({ weight_kg: 81.0 }, { now: at("21:00"), day: DAY });
    const today = await app.loadToday(DAY);
    assert.equal(today.card.kcal, 1070);
    assert.equal(today.card.protein_g, 66);
    assert.equal(today.card.meals, 2);
    assert.equal(today.card.weight_kg, 81.0);
    assert.deepEqual(today.meals.map((m) => m.slot), ["lunch", "dinner"]);
  });
});

describe("last 7 days (week_rollup)", { skip: SKIP }, () => {
  test("gap-fills missing days and computes trailing averages", async () => {
    await app.logMeal({ slot: "breakfast", name: "Oats", kcal: 300 }, { now: at("08:00"), day: "2026-10-18" });
    await app.logMeal({ slot: "dinner", name: "Pasta", kcal: 900 }, { now: at("19:00"), day: "2026-10-16" });
    await app.logWeight({ weight_kg: 82.0 }, { now: at("07:00"), day: "2026-10-16" });
    const week = await app.loadWeek(DAY);
    assert.equal(week.ok, true);
    assert.deepEqual(week.rows.map((r) => r.day), ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
    assert.deepEqual(week.rows.map((r) => r.kcal), [0, 0, 900, 0, 300, 0, 1070]);
    assert.deepEqual(week.rows.map((r) => r.label), ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"]);
    const today = week.rows.at(-1);
    // average over days that have meals: (900 + 300 + 1070) / 3
    assert.equal(today.kcal_avg7, Math.round((900 + 300 + 1070) / 3));
    assert.equal(today.weight_avg7, 81.5); // (82.0 + 81.0) / 2
  });
});

describe("operation id + read-back", { skip: SKIP }, () => {
  test("replaying the same op id never creates a second row", async () => {
    const opId = app.newOpId();
    const a = await app.logMeal({ slot: "snack", name: "Apple", kcal: 95 }, { opId, now: at("15:00"), day: DAY });
    const b = await app.logMeal({ slot: "snack", name: "Apple", kcal: 95 }, { opId, now: at("15:00"), day: DAY });
    assert.equal(a.ok && b.ok, true);
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.row.id, b.row.id);
    assert.equal(await count("meal", "op_id = ?", [opId]), 1);
  });

  test("a write whose response is lost (applied) is not duplicated and is reported as success", async () => {
    const opId = app.newOpId();
    stack.bridge.injectFault((req) => req.op === "sql.execute" && /INSERT INTO meal/.test(req.args.text), { phase: "after" });
    const r = await app.logMeal({ slot: "snack", name: "Banana", kcal: 105 }, { opId, now: at("16:00"), day: DAY });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.duplicate, false);
    assert.equal(await count("meal", "op_id = ?", [opId]), 1);
  });

  test("a write that is dropped (not applied) is retried once with the same op id", async () => {
    const opId = app.newOpId();
    stack.bridge.injectFault((req) => req.op === "sql.execute" && /INSERT INTO meal/.test(req.args.text), { phase: "before" });
    const r = await app.logMeal({ slot: "snack", name: "Pear", kcal: 100 }, { opId, now: at("16:05"), day: DAY });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(await count("meal", "op_id = ?", [opId]), 1);
  });

  test("a permanent failure is reported as failed and nothing is stored", async () => {
    const before = await count("meal");
    // the client does not validate `day`; the schema CHECK (day = date(day)) rejects it
    const r = await app.logMeal({ slot: "snack", name: "Plum", kcal: 10 }, { now: at("16:10"), day: "2026-02-31" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "SQL_ERROR");
    assert.equal(await count("meal"), before);
    const bad = await app.logMeal({ slot: "brunch", name: "Plum", kcal: 10 }, { now: at("16:10"), day: DAY });
    assert.equal(bad.error.code, "INVALID");
  });

  test("the schema itself rejects bad rows even if the client check is bypassed", async () => {
    const r = await sql.execute("healthlog", "INSERT INTO meal (op_id, day, slot, name, kcal, logged_at) VALUES ('z', ?, 'brunch', 'x', 1, 't')", [DAY]);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "SQL_ERROR");
    const r2 = await sql.execute("healthlog", "INSERT INTO weight (op_id, day, weight_kg, logged_at) VALUES ('z', '2026-02-31', 80, 't')");
    assert.equal(r2.ok, false);
  });
});

describe("settings in KV (prefs/)", { skip: SKIP }, () => {
  test("goals default, save and load", async () => {
    assert.deepEqual(await app.loadGoals(), { kcal: 2000 });
    assert.equal((await app.saveGoals({ kcal: 2300 })).ok, true);
    assert.deepEqual(await app.loadGoals(), { kcal: 2300 });
    for (const bad of [3, 20000, 2300.5, "2300", NaN, null, undefined]) {
      const r = await app.saveGoals({ kcal: bad });
      assert.equal(r.ok, false, String(bad));
      assert.equal(r.error.message, app.GOAL_MESSAGE);
    }
    // the invalid saves left the stored value alone
    const raw = await stack.bridge.node.kv.get(`${manifest.app_id}/prefs/goals.json`, { raw: true });
    assert.equal(raw.data.data, '{"kcal":2300}');
  });

  test("a stored target that is not usable (0, text, broken JSON) falls back to the default", async () => {
    const node = stack.bridge.node;
    for (const stored of ['{"kcal":0}', '{"kcal":"lots"}', '{"kcal":-5}', "not json"]) {
      await node.kv.put(`${manifest.app_id}/prefs/goals.json`, stored, { contentType: "application/json" });
      assert.deepEqual(await app.loadGoals(), { kcal: 2000 }, stored);
    }
  });

  test("kv.put with null options is treated as {} and works", async () => {
    assert.equal((await kv.put("prefs/null-opts", "1", null)).ok, true);
    assert.equal(new TextDecoder().decode((await kv.get("prefs/null-opts")).bytes), "1");
    assert.equal((await kv.put("prefs/null-opts", "2", { ifNoneMatch: true })).error.code, "PRECONDITION_FAILED");
  });
});

describe("timezone in KV (settings/)", { skip: SKIP }, () => {
  test("saveTimezone stores the IANA zone at settings/timezone; an unusable zone is refused and leaves it alone", async () => {
    assert.equal((await app.saveTimezone("Pacific/Kiritimati")).ok, true);
    const raw = await stack.bridge.node.kv.get(`${manifest.app_id}/settings/timezone`, { raw: true });
    assert.equal(raw.data.data, "Pacific/Kiritimati");
    assert.equal((await app.saveTimezone(null)).ok, false);
    const again = await stack.bridge.node.kv.get(`${manifest.app_id}/settings/timezone`, { raw: true });
    assert.equal(again.data.data, "Pacific/Kiritimati");
  });

  test("browserTimeZone reports the runtime's zone and saveTimezone defaults to it", async () => {
    const zone = app.browserTimeZone();
    assert.equal(zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal((await app.saveTimezone()).ok, true);
    const raw = await stack.bridge.node.kv.get(`${manifest.app_id}/settings/timezone`, { raw: true });
    assert.equal(raw.data.data, zone);
  });
});

describe("the bridge enforces the app's own manifest", { skip: SKIP }, () => {
  const denied = (r) => {
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "PERMISSION_DENIED");
  };

  test("kv outside the granted prefixes is refused before it reaches the node", async () => {
    denied(await kv.get("secret/x"));
    denied(await kv.put("other/x", "1"));
    denied(await kv.list(""));
    denied(await kv.get("/foo/bar"));
  });

  test("the app can read but not write its own installed code", async () => {
    assert.equal((await kv.get("app/schema.sql")).ok, true);
    denied(await kv.put("app/app.jsx", "// replaced"));
    denied(await kv.del("app/schema.sql"));
  });

  test("another database in the same space is refused", async () => {
    denied(await sql.query("other", "SELECT 1"));
    denied(await sql.execute("other", "CREATE TABLE t (a)"));
  });

  test("the node enforces the same boundary when the parent check is bypassed", async () => {
    const node = stack.bridge.node;
    const r = await node.sql.db(`${manifest.app_id}/other`).execute("CREATE TABLE t (a)");
    assert.equal(r.ok, false);
    assert.match(r.error.code, /UNAUTHORIZED|PERMISSION/);
  });

  test("statement classes: query is read-only, execute needs write/schema", async () => {
    const q = await sql.query("healthlog", "DELETE FROM meal");
    assert.equal(q.error.code, "BAD_REQUEST");
    const p = await sql.execute("healthlog", "PRAGMA writable_schema = 1");
    assert.equal(p.error.code, "BAD_REQUEST");
  });

  test("bad paths are rejected", async () => {
    assert.equal((await kv.get("../x")).error.code, "BAD_REQUEST");
    assert.equal((await kv.get("")).error.code, "BAD_REQUEST");
  });
});

describe("bridge caps", { skip: SKIP }, () => {
  test("over 1 MB in one call -> TOO_LARGE", async () => {
    const r = await kv.put("prefs/big", "x".repeat(1_000_001));
    assert.equal(r.error.code, "TOO_LARGE");
  });

  test("at most 4 calls in flight; extra calls are refused with BUSY", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => sql.query("healthlog", "SELECT COUNT(*) FROM meal")));
    assert.equal(results.filter((r) => r.ok).length, 4);
    assert.equal(results.filter((r) => !r.ok && r.error.code === "BUSY").length, 2);
    assert.equal(stack.bridge.inFlight(), 0);
  });

  test("the app never needs more than 4 concurrent calls (loadToday + loadWeek + loadGoals)", async () => {
    const results = await Promise.all([app.loadToday(DAY), app.loadWeek(DAY), app.loadGoals()]);
    assert.equal(results[0].ok && results[1].ok, true);
  });
});
