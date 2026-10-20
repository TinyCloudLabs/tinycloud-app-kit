// Shim-driven app logic against a real local tinycloud-node (native, no Docker):
// Health Log rows -> a recipe started from one of those meals -> read back.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadApp } from "../dev/build.mjs";
import { nodeSkipReason } from "./lib/node.mjs";
import { sharedSkipReason } from "./lib/shared.mjs";
import { freshStack } from "./lib/stack.mjs";

const skip = nodeSkipReason() ?? sharedSkipReason();
describe("recipes app logic on a local node", { skip }, () => {
  let stack;
  let app;
  const meals = {};

  before(async () => {
    app = await loadApp();
    stack = await freshStack();
    await stack.install();
    await stack.provisionHealth();
    meals.salmon = await stack.writeHealthMeal({ day: "2026-10-19", slot: "dinner", name: "Salmon, rice and broccoli", kcal: 650, protein_g: 42, carbs_g: 60, fat_g: 24 });
    meals.oats = await stack.writeHealthMeal({ day: "2026-10-20", slot: "breakfast", name: "Oats with berries", kcal: 310, protein_g: 11, carbs_g: 52, fat_g: 6 });
  });
  after(async () => {
    await stack?.stop();
  });

  const rows = async (text, params = []) => {
    const r = await stack.recipes.sql.query("recipes", text, params);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.rows;
  };

  const fill = (over = {}) => ({ ...app.blankForm(), title: "Plain pancakes", ...over });
  const valid = (form) => {
    const v = app.validateForm(form);
    assert.equal(v.error, undefined);
    return v.fields;
  };

  describe("schema", () => {
    test("ensureSchema creates every object from the installed app/schema.sql, then is a no-op", async () => {
      assert.equal(await app.ensureSchema(), true);
      const names = (await rows("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r[0]);
      for (const wanted of app.REQUIRED_OBJECTS) assert.ok(names.includes(wanted), `${wanted} was not created`);
      assert.equal(await app.ensureSchema(), false);
    });

    test("a database with only some of the objects is completed, not skipped", async () => {
      // Fresh db name is not possible (the app owns one); drop a view and re-open.
      const drop = await stack.recipes.sql.execute("recipes", "DROP VIEW shelf_overview");
      assert.equal(drop.ok, true, JSON.stringify(drop.error));
      assert.equal(await app.ensureSchema(), true);
      assert.equal((await app.listShelves()).length, 0);
    });
  });

  describe("health meals are readable across apps", () => {
    test("listHealthMeals returns what the Health Log wrote, newest first", async () => {
      const list = await app.listHealthMeals();
      assert.deepEqual(list.map((m) => m.name), ["Oats with berries", "Salmon, rice and broccoli"]);
      assert.equal(list[1].id, meals.salmon);
      assert.equal(list[1].kcal, 650);
    });
  });

  describe("a recipe started from a meal", () => {
    let recipeId;

    test("meal -> form -> validate -> save creates a from_meal recipe linked to that meal id; read it back", async () => {
      const meal = (await app.listHealthMeals()).find((m) => m.id === meals.salmon);
      const form = app.formFromMeal(meal);
      assert.equal(form.origin, "from_meal");
      form.ingredients = [
        { qty: "150 g", item: "salmon fillet" },
        { qty: "1 cup", item: "cooked rice" },
        { qty: "", item: "broccoli" },
      ];
      form.steps = "Roast the salmon.\nSteam the broccoli.\n\nServe on the rice.";
      recipeId = await app.saveRecipe({ fields: valid(form), shelfIds: [], links: form.links });

      const back = await app.loadRecipe(recipeId);
      assert.equal(back.title, "Salmon, rice and broccoli");
      assert.equal(back.origin, "from_meal");
      assert.equal(back.nutrition_basis, "copied_from_meal");
      assert.equal(back.kcal, 650);
      assert.equal(back.protein_g, 42);
      assert.deepEqual(back.ingredients, [
        { qty: "150 g", item: "salmon fillet" },
        { qty: "1 cup", item: "cooked rice" },
        { qty: "", item: "broccoli" },
      ]);
      assert.deepEqual(back.steps, ["Roast the salmon.", "Steam the broccoli.", "Serve on the rice."]);
      assert.equal(back.links.length, 1);
      assert.equal(back.links[0].health_meal_id, meals.salmon);
      assert.equal(back.links[0].meal_day, "2026-10-19");
      assert.equal(back.links[0].meal_kcal, 650);
    });

    test("the recipe_card view and raw tables agree", async () => {
      const [card] = await app.listRecipes({});
      assert.equal(card.id, recipeId);
      assert.equal(card.meal_count, 1);
      assert.equal(card.shelf_count, 0);
      assert.deepEqual(await rows("SELECT health_meal_id FROM meal_link WHERE recipe_id = ?", [recipeId]), [[meals.salmon]]);
    });

    test("the picker marks a meal that already has a recipe", async () => {
      const linked = await app.linkedMealIds();
      assert.equal(linked.has(meals.salmon), true);
      assert.equal(linked.has(meals.oats), false);
    });

    test("editing does not duplicate the meal link", async () => {
      const recipe = await app.loadRecipe(recipeId);
      const form = app.formFromRecipe(recipe);
      form.title = "Salmon bowl";
      await app.saveRecipe({ id: recipeId, fields: valid(form), shelfIds: form.shelfIds, links: form.links });
      const back = await app.loadRecipe(recipeId);
      assert.equal(back.title, "Salmon bowl");
      assert.equal(back.links.length, 1);
      assert.ok(back.updated_at >= back.created_at);
    });

    test("the same meal cannot be linked to the same recipe twice (UNIQUE)", async () => {
      const recipe = await app.loadRecipe(recipeId);
      const form = app.formFromRecipe(recipe);
      const dup = { health_meal_id: meals.salmon, meal_day: "2026-10-19", meal_name: "x", meal_kcal: 1 };
      await assert.rejects(app.saveRecipe({ id: recipeId, fields: valid(form), shelfIds: [], links: [dup] }), (e) => {
        assert.match(e.message, /The recipe was saved, but its shelves or meal link were not/);
        assert.equal(e.partialId, recipeId);
        return true;
      });
    });
  });

  describe("shelves", () => {
    let dinners;
    let pancakes;

    test("create, list with counts, rename", async () => {
      await app.createShelf("Weeknight dinners");
      await app.createShelf("Breakfasts");
      let shelves = await app.listShelves();
      assert.deepEqual(shelves.map((s) => [s.name, s.recipe_count]), [["Weeknight dinners", 0], ["Breakfasts", 0]]);
      dinners = shelves[0].id;
      await app.renameShelf(dinners, "Dinners");
      shelves = await app.listShelves();
      assert.equal(shelves[0].name, "Dinners");
    });

    test("shelf names are unique", async () => {
      await assert.rejects(app.createShelf("Breakfasts"), /UNIQUE|constraint/i);
    });

    test("a recipe on shelves is found by shelf, favorite and title search", async () => {
      const breakfasts = (await app.listShelves()).find((s) => s.name === "Breakfasts").id;
      pancakes = await app.saveRecipe({ fields: valid(fill({ summary: "Fluffy", kcal: "280", protein_g: "8", nutrition_basis: "estimate", favorite: true })), shelfIds: [breakfasts, dinners], links: [] });
      const salmon = (await app.listRecipes({})).find((r) => r.origin === "from_meal").id;
      await app.saveRecipe({ id: salmon, fields: valid(app.formFromRecipe(await app.loadRecipe(salmon))), shelfIds: [dinners], links: [] });

      assert.deepEqual((await app.listRecipes({ shelfId: dinners })).map((r) => r.title).sort(), ["Plain pancakes", "Salmon bowl"]);
      assert.deepEqual((await app.listRecipes({ shelfId: breakfasts })).map((r) => r.title), ["Plain pancakes"]);
      assert.deepEqual((await app.listRecipes({ favoritesOnly: true })).map((r) => r.title), ["Plain pancakes"]);
      assert.deepEqual((await app.listRecipes({ search: "SALMON" })).map((r) => r.title), ["Salmon bowl"]);
      assert.deepEqual((await app.listRecipes({ search: "50%_" })).map((r) => r.title), [], "LIKE wildcards in the search box are literal");
      assert.deepEqual((await app.listRecipes({ sort: "title" })).map((r) => r.title), ["Plain pancakes", "Salmon bowl"]);
      const shelves = await app.listShelves();
      assert.deepEqual(shelves.map((s) => [s.name, s.recipe_count]), [["Dinners", 2], ["Breakfasts", 1]]);
    });

    test("deleting a shelf keeps its recipes", async () => {
      await app.deleteShelf(dinners);
      assert.equal((await app.listRecipes({})).length, 2);
      assert.deepEqual((await app.listShelves()).map((s) => s.name), ["Breakfasts"]);
      assert.equal((await app.loadRecipe(pancakes)).shelves.length, 1);
    });

    test("favorite toggles and deleting a recipe removes its shelf rows and meal links", async () => {
      await app.setFavorite(pancakes, false);
      assert.equal((await app.loadRecipe(pancakes)).favorite, 0);
      const salmon = (await app.listRecipes({})).find((r) => r.origin === "from_meal").id;
      await app.deleteRecipe(salmon);
      await app.deleteRecipe(pancakes);
      assert.equal(await app.loadRecipe(salmon), null);
      assert.deepEqual(await rows("SELECT COUNT(*) FROM recipe_shelf"), [[0]]);
      assert.deepEqual(await rows("SELECT COUNT(*) FROM meal_link"), [[0]]);
      assert.deepEqual(await rows("SELECT COUNT(*) FROM recipe"), [[0]]);
    });
  });

  describe("form validation", () => {
    const bad = (over, pattern) => {
      const v = app.validateForm(fill(over));
      assert.match(v.error ?? "", pattern);
      assert.equal(v.fields, undefined);
    };

    test("rejects what the schema would reject, before any write", () => {
      bad({ title: "   " }, /title/i);
      bad({ servings: "0" }, /Servings/);
      bad({ servings: "lots" }, /Servings/);
      bad({ kcal: "9000", nutrition_basis: "estimate" }, /Calories/);
      bad({ kcal: "12.5", nutrition_basis: "estimate" }, /Calories/);
      bad({ protein_g: "-1", nutrition_basis: "estimate" }, /Protein/);
      bad({ prep_min: "ten" }, /Prep/);
      bad({ kcal: "300" }, /where the nutrition numbers come from/);
      bad({ servings: "1001" }, /Servings must be a number from 0 to 1000/);
      bad({ servings: "9".repeat(25) }, /Servings/);
      bad({ prep_min: "10081" }, /Prep minutes must be a whole number from 0 to 10080/);
      bad({ cook_min: "1e3" }, /Cook minutes/);
      bad({ protein_g: "10001", nutrition_basis: "estimate" }, /Protein must be a number from 0 to 10000/);
      bad({ carbs_g: "9".repeat(25), nutrition_basis: "estimate" }, /Carbs/);
      bad({ fat_g: "0x10", nutrition_basis: "estimate" }, /Fat/);
      bad({ summary: "x".repeat(1001) }, /summary is limited to 1000/);
      bad({ steps: "x".repeat(20001) }, /steps are limited to 20000/);
    });

    test("the bounds themselves are accepted, and the node enforces the same bounds if the app is bypassed", async () => {
      const f = valid(fill({ servings: "1000", prep_min: "10080", cook_min: "0", kcal: "5000", protein_g: "10000", carbs_g: "0.5", fat_g: ".5", nutrition_basis: "label" }));
      assert.equal(f.servings, 1000);
      assert.equal(f.fat_g, 0.5);
      for (const [column, value] of [["servings", 1001], ["prep_min", 10081], ["cook_min", -1], ["protein_g", 10001], ["carbs_g", 10001], ["fat_g", -0.1]]) {
        const r = await stack.recipes.sql.execute("recipes", `INSERT INTO recipe (id, title, ${column}, created_at, updated_at) VALUES ('b', 'b', ?, 'now', 'now')`, [value]);
        assert.equal(r.ok, false, `${column}=${value} was accepted by the node`);
      }
      const long = await stack.recipes.sql.execute("recipes", "INSERT INTO recipe (id, title, summary, created_at, updated_at) VALUES ('b', 'b', ?, 'now', 'now')", ["x".repeat(1001)]);
      assert.equal(long.ok, false);
    });

    test("blank optional numbers become NULL and blank ingredient rows are dropped", () => {
      const f = valid(fill({ ingredients: [{ qty: "", item: "" }, { qty: "2", item: "eggs" }], steps: " \n mix \n" }));
      assert.equal(f.kcal, null);
      assert.equal(f.nutrition_basis, null);
      assert.equal(f.prep_min, null);
      assert.deepEqual(f.ingredients, [{ qty: "2", item: "eggs" }]);
      assert.deepEqual(f.steps, ["mix"]);
    });

    test("the node still enforces the CHECK sets if the app is bypassed", async () => {
      const r = await stack.recipes.sql.execute(
        "recipes",
        "INSERT INTO recipe (id, title, origin, created_at, updated_at) VALUES ('x', 'x', 'invented', 'now', 'now')",
      );
      assert.equal(r.ok, false);
    });
  });
});
