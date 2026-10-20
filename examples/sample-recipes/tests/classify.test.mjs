// The app against the hardened bridge shim's SQL class check, without a node: a recording stand-in for the node
// client lets us see exactly which statements leave the shim and in which class. Needs ../sample-healthlog installed
// (it owns the shim); no TC_NODE_BIN needed.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadApp, ROOT } from "../dev/build.mjs";
import { loadShim, sharedSkipReason } from "./lib/shared.mjs";

const skip = sharedSkipReason();
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const schema = readFileSync(join(ROOT, "schema.sql"), "utf8");

/** Stand-in for a node-sdk client: records every call, answers with empty successes. */
function recorder() {
  const calls = [];
  const sqlHandle = (db) => ({
    query: async (text, params) => {
      calls.push({ op: "sql.query", db, text, params });
      // An aggregate always returns one row; everything else answers "no rows".
      return /AS next\b/.test(text) ? { ok: true, data: { columns: ["next"], rows: [[1]], rowCount: 1 } } : { ok: true, data: { columns: ["id"], rows: [], rowCount: 0 } };
    },
    execute: async (text, params) => (calls.push({ op: "sql.execute", db, text, params }), { ok: true, data: { changes: 1, lastInsertRowId: 1 } }),
  });
  return {
    calls,
    node: {
      sql: { db: sqlHandle },
      kv: {
        get: async (key) => (calls.push({ op: "kv.get", key }), { ok: true, data: { data: new TextEncoder().encode(schema), headers: {} } }),
        put: async (key) => (calls.push({ op: "kv.put", key }), { ok: true, data: {} }),
        list: async () => ({ ok: true, data: { keys: [] } }),
        delete: async () => ({ ok: true, data: {} }),
      },
    },
  };
}

describe("the app's SQL against the shim's statement classes", { skip }, () => {
  test("every statement the app sends is one the shim accepts, in the class it must be (reads via query, writes via execute)", async () => {
    const { classifySql, connect } = await loadShim();
    const app = await loadApp();
    const { calls, node } = recorder();
    const bridge = await connect({ manifest, node });
    try {
      const form = { ...app.blankForm(), title: "Soup", kcal: "100", nutrition_basis: "estimate" };
      const fields = app.validateForm(form).fields;
      await app.ensureSchema(); // probe read, then the schema statements from the installed app/schema.sql
      await app.loadPrefs();
      await app.savePrefs({ sort: "title" });
      await app.listShelves();
      for (const opts of [{}, { shelfId: "s", search: "50%_", favoritesOnly: true, sort: "title" }]) await app.listRecipes(opts); // recipe_card
      await app.listHealthMeals(); // the cross-app read
      await app.linkedMealIds();
      await app.saveRecipe({ fields, shelfIds: ["s"], links: [{ health_meal_id: 1, meal_day: "2026-10-20", meal_name: "x", meal_kcal: 1 }] });
      await app.saveRecipe({ id: "rcp_1", fields, shelfIds: [], links: [] });
      await app.loadRecipe("rcp_1");
      await app.setFavorite("rcp_1", true);
      await app.createShelf("Soups");
      await app.renameShelf("s", "Soups 2");
      await app.deleteShelf("s");
      await app.deleteRecipe("rcp_1");

      const sqlCalls = calls.filter((c) => c.op.startsWith("sql."));
      assert.ok(sqlCalls.length > 25, `expected the whole data layer to run, saw ${sqlCalls.length} SQL calls`);
      for (const c of sqlCalls) {
        const cls = classifySql(c.text);
        assert.ok(c.op === "sql.query" ? cls === "read" : cls === "write" || cls === "schema", `${c.op} sent a ${cls} statement: ${c.text.slice(0, 80)}`);
      }
      assert.ok(sqlCalls.some((c) => /FROM recipe_card/.test(c.text)), "the recipe_card read ran");
      assert.ok(sqlCalls.some((c) => /FROM shelf_overview/.test(c.text)), "the shelf_overview read ran");
      assert.ok(sqlCalls.some((c) => c.op === "sql.execute" && classifySql(c.text) === "schema"), "schema statements ran from the installed app/schema.sql");
      assert.ok(sqlCalls.some((c) => c.db.startsWith("xyz.tinycloud.sample.healthlog/") && /FROM meal/.test(c.text)), "the cross-app meal read ran");
      // The only thing the app ever sends to the Health Log's database is reads.
      assert.deepEqual([...new Set(sqlCalls.filter((c) => c.db.startsWith("xyz.tinycloud.sample.healthlog/")).map((c) => c.op))], ["sql.query"]);
    } finally {
      bridge.close();
    }
  });

  test("the cross-app read passes the class check and every write toward the Health Log is refused by the shim before it leaves", async () => {
    const { connect } = await loadShim();
    const { calls, node } = recorder();
    const bridge = await connect({ manifest, node });
    try {
      const HEALTH = "/xyz.tinycloud.sample.healthlog/healthlog";
      const read = await bridge.sql.query(HEALTH, "SELECT id, day, slot, name, kcal FROM meal ORDER BY day DESC LIMIT 40");
      assert.equal(read.ok, true, JSON.stringify(read.error));
      const before = calls.length;
      for (const text of [
        "INSERT INTO meal (op_id) VALUES ('x')",
        "WITH x AS (SELECT 1) INSERT INTO meal (op_id) SELECT 'x' FROM x",
        "DROP TABLE meal",
      ]) {
        const w = await bridge.sql.execute(HEALTH, text);
        assert.equal(w.error?.code, "PERMISSION_DENIED", text);
      }
      for (const text of ["SELECT 1; DELETE FROM meal", "WITH x AS (SELECT 1) DELETE FROM meal", "PRAGMA writable_schema = 1", "ATTACH DATABASE 'x' AS y", "VACUUM"]) {
        const w = await bridge.sql.query(HEALTH, text);
        assert.equal(w.ok, false, text);
      }
      assert.equal(calls.length, before, "no refused statement reached the node client");
    } finally {
      bridge.close();
    }
  });
});
