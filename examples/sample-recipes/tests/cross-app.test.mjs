// Cross-app permission proof on a real local tinycloud-node: the Recipes app may
// READ the Health Log's data (manifest.json grants it) and may not WRITE it.
//
// Two layers are checked separately:
//   1. the bridge (what `import { sql, kv } from "@tinycloud/app"` sees): the parent
//      refuses a call the manifest does not allow, before it reaches the node;
//   2. the NODE, with the call forced past the parent through the app's own
//      signer-less session: the node still refuses. This is the backstop that
//      matters, because the parent is not the only thing between an app and the data.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { nodeSkipReason } from "./lib/node.mjs";
import { freshStack, HEALTH_DB, healthManifest, RECIPES_DB } from "./lib/stack.mjs";

const skip = nodeSkipReason();
describe("cross-app permissions on a local node", { skip }, () => {
  const HEALTH = healthManifest.app_id;
  const HEALTH_ABS_DB = `/${HEALTH_DB}`; // leading "/": absolute path, reachable via skipPrefix grants
  let stack;
  let mealId;

  before(async () => {
    stack = await freshStack();
    await stack.provisionHealth();
    mealId = await stack.writeHealthMeal({ day: "2026-10-20", slot: "lunch", name: "Lentil soup", kcal: 420, protein_g: 24 });
    stack.must(await stack.health.kv.put("knowledge/index.md", "# Health Log\n", { contentType: "text/markdown" }), "seed health knowledge");
    stack.must(await stack.health.kv.put("prefs/goals.json", '{"kcal":2000}', { contentType: "application/json" }), "seed health prefs");
  });
  after(async () => {
    await stack?.stop();
  });

  const refusedByNode = (r) => {
    assert.equal(r.ok, false, `the node accepted a write it must refuse: ${JSON.stringify(r.data)}`);
    assert.match(`${r.error.code} ${r.error.message}`, /AUTH_UNAUTHORIZED|Unauthorized|401|403/i);
  };
  const healthMeals = async () => {
    const r = await stack.health.sql.query("healthlog", "SELECT id, name, kcal FROM meal ORDER BY id");
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.rows;
  };

  describe("reads are allowed", () => {
    test("SQL: the Recipes app reads the Health Log's meal table", async () => {
      const r = await stack.recipes.sql.query(HEALTH_ABS_DB, "SELECT id, name, kcal FROM meal WHERE id = ?", [mealId]);
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.deepEqual(r.rows, [[mealId, "Lentil soup", 420]]);
    });

    test("SQL: it can read the Health Log's views too (same database grant)", async () => {
      const r = await stack.recipes.sql.query(HEALTH_ABS_DB, "SELECT day, kcal, meals FROM day_card");
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.deepEqual(r.rows, [["2026-10-20", 420, 1]]);
    });

    test("KV: it reads and lists the Health Log's knowledge/ prefix", async () => {
      const got = await stack.recipes.kv.get(`/${HEALTH}/knowledge/index.md`);
      assert.equal(got.ok, true, JSON.stringify(got.error));
      assert.equal(new TextDecoder().decode(got.bytes), "# Health Log\n");
      const list = await stack.recipes.kv.list(`/${HEALTH}/knowledge/`);
      assert.equal(list.ok, true, JSON.stringify(list.error));
      assert.deepEqual(list.keys, [`/${HEALTH}/knowledge/index.md`]);
    });
  });

  describe("writes are refused", () => {
    test("bridge: INSERT / UPDATE / DELETE / DDL into the Health Log database -> PERMISSION_DENIED", async () => {
      for (const text of [
        "INSERT INTO meal (op_id, day, slot, name, kcal, logged_at) VALUES ('x', '2026-10-20', 'snack', 'Cake', 400, 'now')",
        "UPDATE meal SET kcal = 1",
        "DELETE FROM meal",
        "DROP TABLE meal",
        "CREATE TABLE sneaky (a)",
      ]) {
        const r = await stack.recipes.sql.execute(HEALTH_ABS_DB, text);
        assert.equal(r.ok, false, text);
        assert.equal(r.error.code, "PERMISSION_DENIED", text);
      }
    });

    test("bridge: a write dressed up as a query is refused too", async () => {
      const r = await stack.recipes.sql.query(HEALTH_ABS_DB, "DELETE FROM meal");
      assert.equal(r.ok, false);
    });

    test("bridge: KV put / delete under the Health Log prefix -> PERMISSION_DENIED", async () => {
      const put = await stack.recipes.kv.put(`/${HEALTH}/knowledge/interop.md`, "hello");
      assert.equal(put.error?.code, "PERMISSION_DENIED");
      const del = await stack.recipes.kv.del(`/${HEALTH}/knowledge/index.md`);
      assert.equal(del.error?.code, "PERMISSION_DENIED");
    });

    test("bridge: reading a Health Log prefix the manifest does not name -> PERMISSION_DENIED", async () => {
      const r = await stack.recipes.kv.get(`/${HEALTH}/prefs/goals.json`);
      assert.equal(r.error?.code, "PERMISSION_DENIED");
    });

    test("NODE: the same writes forced past the bridge are refused by the node", async () => {
      const db = stack.recipesNode.sql.db(HEALTH_DB);
      refusedByNode(await db.execute("INSERT INTO meal (op_id, day, slot, name, kcal, logged_at) VALUES ('x', '2026-10-20', 'snack', 'Cake', 400, 'now')"));
      refusedByNode(await db.execute("UPDATE meal SET kcal = 1"));
      refusedByNode(await db.execute("DELETE FROM meal"));
      refusedByNode(await db.execute("DROP TABLE meal"));
      refusedByNode(await db.execute("CREATE TABLE sneaky (a)"));
      assert.deepEqual(await healthMeals(), [[mealId, "Lentil soup", 420]], "the Health Log's data is untouched");
    });

    test("NODE: KV writes under the Health Log prefix are refused, even in the one prefix it may read", async () => {
      refusedByNode(await stack.recipesNode.kv.put(`${HEALTH}/knowledge/interop.md`, "hello"));
      refusedByNode(await stack.recipesNode.kv.put(`${HEALTH}/prefs/goals.json`, '{"kcal":1}'));
      refusedByNode(await stack.recipesNode.kv.delete(`${HEALTH}/knowledge/index.md`));
      const still = await stack.health.kv.get("knowledge/index.md");
      assert.equal(new TextDecoder().decode(still.bytes), "# Health Log\n");
      const prefs = await stack.health.kv.get("prefs/goals.json");
      assert.equal(new TextDecoder().decode(prefs.bytes), '{"kcal":2000}');
    });

    test("NODE: reads outside what the manifest names are refused too", async () => {
      refusedByNode(await stack.recipesNode.kv.get(`${HEALTH}/prefs/goals.json`));
      refusedByNode(await stack.recipesNode.sql.db(`${HEALTH}/other`).query("SELECT 1"));
      refusedByNode(await stack.recipesNode.sql.db("xyz.tinycloud.sample.someone-else/db").query("SELECT 1"));
    });
  });

  describe("the grant is one-way", () => {
    test("NODE: the Health Log's session cannot read the Recipes database", async () => {
      refusedByNode(await stack.healthNode.sql.db(RECIPES_DB).query("SELECT 1"));
    });

    test("the Recipes app still reads and writes its own database", async () => {
      const w = await stack.recipes.sql.execute("recipes", "CREATE TABLE IF NOT EXISTS scratch (a TEXT)");
      assert.equal(w.ok, true, JSON.stringify(w.error));
      const r = await stack.recipes.sql.query("recipes", "SELECT COUNT(*) FROM scratch");
      assert.deepEqual(r.rows, [[0]]);
    });
  });
});
