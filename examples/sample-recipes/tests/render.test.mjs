// jsdom render tests: the real app.jsx (esbuild-bundled, React 19) talking through the
// dev shim to a real local node. Covers the recipe list and the flows around it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadApp } from "../dev/build.mjs";
import { button, click, field, mount, set, submit, text, waitFor } from "./lib/dom.mjs";
import { nodeSkipReason } from "./lib/node.mjs";
import { sharedSkipReason } from "./lib/shared.mjs";
import { freshStack } from "./lib/stack.mjs";

const skip = nodeSkipReason() ?? sharedSkipReason();
describe("jsdom render on a local node", { skip }, () => {
  let stack;
  let app;
  let view;

  before(async () => {
    app = await loadApp();
    stack = await freshStack();
    await stack.install();
    await stack.provisionHealth();
    trackConcurrency(stack.recipes);
    await stack.writeHealthMeal({ day: "2026-10-19", slot: "dinner", name: "Salmon, rice and broccoli", kcal: 650, protein_g: 42, carbs_g: 60, fat_g: 24 });
    await stack.writeHealthMeal({ day: "2026-10-20", slot: "breakfast", name: "Oats with berries", kcal: 310, protein_g: 11, carbs_g: 52, fat_g: 6 });

    // Seed through the app's own write path.
    await app.ensureSchema();
    await app.createShelf("Weeknight dinners");
    await app.createShelf("Breakfasts");
    const [dinners, breakfasts] = (await app.listShelves()).map((s) => s.id);
    const make = (over) => {
      const v = app.validateForm({ ...app.blankForm(), ...over });
      assert.equal(v.error, undefined);
      return v.fields;
    };
    await app.saveRecipe({
      fields: make({ title: "Lentil soup", summary: "Thick and warming.", kcal: "420", protein_g: "24", nutrition_basis: "estimate", favorite: true, ingredients: [{ qty: "1 cup", item: "red lentils" }, { qty: "", item: "onion" }], steps: "Sweat the onion.\nSimmer the lentils." }),
      shelfIds: [dinners],
      links: [],
    });
    await app.saveRecipe({ fields: make({ title: "Plain pancakes", origin: "adapted" }), shelfIds: [breakfasts], links: [] });
  });
  after(async () => {
    await view?.unmount();
    await stack?.stop();
  });

  // The app promises the bridge to keep itself to 3 concurrent calls (cap is 4; the 5th is refused).
  const peak = { now: 0, max: 0 };
  function trackConcurrency(bridge) {
    for (const [group, name] of [["kv", "get"], ["kv", "put"], ["kv", "list"], ["kv", "del"], ["sql", "query"], ["sql", "execute"]]) {
      const original = bridge[group][name];
      bridge[group][name] = async (...args) => {
        peak.max = Math.max(peak.max, ++peak.now);
        try {
          return await original(...args);
        } finally {
          peak.now -= 1;
        }
      };
    }
  }

  const titles = () => [...document.querySelectorAll("ul[aria-label='Recipe list'] > li button > div > span:first-child")].map((e) => e.textContent);

  describe("recipe list", () => {
    test("renders the recipes with macros, origin, shelf and favorite marks", async () => {
      view = await mount(app.default);
      await waitFor(() => titles().length === 2, { what: "two recipe cards" });
      assert.deepEqual(titles().sort(), ["Lentil soup", "Plain pancakes"]);

      const soup = [...document.querySelectorAll("ul[aria-label='Recipe list'] > li")].find((li) => li.textContent.includes("Lentil soup"));
      assert.match(soup.textContent, /Thick and warming\./);
      assert.match(soup.textContent, /420 kcal · 24 g protein/);
      assert.match(soup.textContent, /Mine · on 1 shelf/);
      assert.ok(soup.querySelector("[aria-label='Favorite']"), "favorite star");

      const pancakes = [...document.querySelectorAll("ul[aria-label='Recipe list'] > li")].find((li) => li.textContent.includes("Plain pancakes"));
      assert.match(pancakes.textContent, /No nutrition entered/);
      assert.match(pancakes.textContent, /Adapted/);
      assert.equal(pancakes.querySelector("[aria-label='Favorite']"), null);
    });

    test("shelf chips show counts and filter the list", async () => {
      assert.ok(button(/^Weeknight dinners\s*1$/), "chip with count");
      await click(button(/^Weeknight dinners/));
      await waitFor(() => titles().length === 1, { what: "filtered list" });
      assert.deepEqual(titles(), ["Lentil soup"]);
      assert.equal(button(/^Weeknight dinners/).getAttribute("aria-pressed"), "true");
      await click(button("All recipes"));
      await waitFor(() => titles().length === 2, { what: "unfiltered list" });
    });

    test("search and favorites-only narrow the list; no match shows the empty state", async () => {
      await set(field("Search recipes"), "pan");
      await waitFor(() => titles().length === 1 && titles()[0] === "Plain pancakes", { what: "search result" });
      await set(field("Search recipes"), "zzz");
      await waitFor(() => /No recipes here yet/.test(text()), { what: "empty state" });
      await set(field("Search recipes"), "");
      await click(field("Favorites only"));
      await waitFor(() => titles().length === 1 && titles()[0] === "Lentil soup", { what: "favorites only" });
      await click(field("Favorites only"));
      await waitFor(() => titles().length === 2, { what: "all again" });
    });

    test("the sort choice is saved as a preference in the app's own KV prefix", async () => {
      await set(field("Sort"), "title");
      const prefs = await waitFor(
        async () => {
          const r = await stack.recipes.kv.get("prefs/ui.json");
          const saved = r.ok ? JSON.parse(new TextDecoder().decode(r.bytes)) : null;
          return saved?.sort === "title" ? saved : null;
        },
        { what: "prefs/ui.json with sort=title" },
      );
      assert.equal(prefs.sort, "title");
      await waitFor(() => titles().join("|") === "Lentil soup|Plain pancakes", { what: "list sorted by title" });
    });
  });

  describe("detail, edit and delete", () => {
    test("opening a recipe shows ingredients, steps, shelves and nutrition", async () => {
      await click([...document.querySelectorAll("ul[aria-label='Recipe list'] button")].find((b) => b.textContent.includes("Lentil soup")));
      await waitFor(() => document.querySelector("article[aria-label='Lentil soup']"), { what: "detail" });
      const t = text();
      assert.match(t, /1 cup red lentils/);
      assert.match(t, /Sweat the onion\./);
      assert.match(t, /Weeknight dinners/);
      assert.match(t, /Per serving: 420 kcal · 24 g protein \(My estimate\)/);
    });

    test("edit saves changes and shows them", async () => {
      await click(button("Edit"));
      await waitFor(() => field("Title"), { what: "edit form" });
      assert.equal(field("Title").value, "Lentil soup");
      await set(field("Title"), "Red lentil soup");
      await click(button("Add ingredient"));
      await set(field("Ingredient 3 name"), "cumin");
      await submit(document.querySelector("form[aria-label='Edit recipe']"));
      await waitFor(() => document.querySelector("article[aria-label='Red lentil soup']"), { what: "saved detail" });
      assert.match(text(), /cumin/);
    });

    test("an invalid form shows the message and writes nothing", async () => {
      await click(button("Edit"));
      await waitFor(() => field("Title"));
      await set(field("Title"), "");
      await submit(document.querySelector("form[aria-label='Edit recipe']"));
      await waitFor(() => /Give the recipe a title\./.test(text()), { what: "validation message" });
      const r = await stack.recipes.sql.query("recipes", "SELECT title FROM recipe WHERE title = ''");
      assert.deepEqual(r.rows, []);
      await click(button("Cancel"));
      await waitFor(() => document.querySelector("article[aria-label='Red lentil soup']"));
    });

    test("delete asks first, then removes the recipe", async () => {
      await click(button("Delete"));
      assert.ok(button("Keep it"));
      await click(button("Keep it"));
      assert.ok(document.querySelector("article[aria-label='Red lentil soup']"));
      await click(button("Delete"));
      await click(button("Yes, delete it"));
      await waitFor(() => titles().length === 1, { what: "list after delete" });
      assert.deepEqual(titles(), ["Plain pancakes"]);
    });
  });

  describe("from a health-log entry", () => {
    test("lists the Health Log's meals (read across apps), prefilled form, save links the meal", async () => {
      await click(button("From a health-log entry"));
      await waitFor(() => /Oats with berries/.test(text()), { what: "meal list" });
      assert.match(text(), /2026-10-20 · breakfast · 310 kcal/);
      assert.match(text(), /Salmon, rice and broccoli/);
      assert.match(text(), /only reads your health log/);

      await click(button("Use Oats with berries on 2026-10-20"));
      await waitFor(() => field("Title"), { what: "prefilled form" });
      assert.equal(field("Title").value, "Oats with berries");
      assert.equal(field("Calories").value, "310");
      assert.equal(field("Numbers come from").value, "copied_from_meal");
      assert.equal(field("Kind").value, "from_meal");
      assert.match(text(), /Linked to your health log: Oats with berries \(2026-10-20\)/);

      await set(field("Ingredient 1 amount"), "1 cup");
      await set(field("Ingredient 1 name"), "rolled oats");
      await submit(document.querySelector("form[aria-label='Add recipe']"));
      await waitFor(() => document.querySelector("article[aria-label='Oats with berries']"), { what: "saved detail" });
      assert.match(text(), /Health-log meals/);
      assert.match(text(), /Oats with berries on 2026-10-20 · 310 kcal/);

      const links = await stack.recipes.sql.query("recipes", "SELECT health_meal_id, meal_name FROM meal_link");
      assert.equal(links.rows.length, 1);
      assert.equal(links.rows[0][1], "Oats with berries");
    });

    test("the picker notes meals that already have a recipe", async () => {
      await click(button("Back to recipes"));
      await click(button("From a health-log entry"));
      await waitFor(() => /already has a recipe/.test(text()), { what: "linked marker" });
      const items = [...document.querySelectorAll("section[aria-label='Start from a health-log entry'] li")];
      assert.match(items.find((li) => li.textContent.includes("Oats")).textContent, /already has a recipe/);
      assert.doesNotMatch(items.find((li) => li.textContent.includes("Salmon")).textContent, /already has a recipe/);
      await click(button("Back to recipes"));
    });
  });

  describe("invalid numbers are surfaced, never dropped", () => {
    test("a malformed number shows an alert, keeps the form and writes nothing", async () => {
      await click(button("Add recipe"));
      await waitFor(() => field("Title"), { what: "add form" });
      await set(field("Title"), "Number check");
      const before = await stack.recipes.sql.query("recipes", "SELECT COUNT(*) FROM recipe");
      for (const [label, value, message] of [
        ["Calories", "1e3", /Calories must be a whole number/],
        ["Protein (g)", "0x10", /Protein must be a number/],
        ["Servings", "two", /Servings must be a number more than 0/],
        ["Prep minutes", "-5", /Prep minutes must be a whole number/],
      ]) {
        const before = field(label).value;
        await set(field("Numbers come from"), "estimate");
        await set(field(label), value);
        await submit(document.querySelector("form[aria-label='Add recipe']"));
        const alert = await waitFor(() => document.querySelector("[role='alert']"), { what: `alert for ${label}` });
        assert.match(alert.textContent, message, `${label}=${value}`);
        assert.equal(field("Title").value, "Number check", "the form keeps what was typed");
        assert.equal(field(label).value, value, "the bad value is still there, not silently dropped");
        await set(field(label), before);
      }
      const after = await stack.recipes.sql.query("recipes", "SELECT COUNT(*) FROM recipe");
      assert.deepEqual(after.rows, before.rows, "nothing was written");
      await click(button("Cancel"));
    });
  });

  describe("shelves screen", () => {
    test("add, rename and delete a shelf", async () => {
      await click(button("Manage shelves"));
      await waitFor(() => field("New shelf name"));
      await set(field("New shelf name"), "Soups");
      await click(button("Add shelf"));
      await waitFor(() => /Soups/.test(text()), { what: "new shelf" });
      await click(button("Rename Soups"));
      await set(field("New name for Soups"), "Soups and stews");
      await click(button("Save"));
      await waitFor(() => /Soups and stews/.test(text()), { what: "renamed shelf" });
      await click(button("Delete shelf Soups and stews"));
      await waitFor(() => !/Soups and stews/.test(text()), { what: "deleted shelf" });
      await click(button("Back to recipes"));
    });
  });

  describe("failure states", () => {
    test("a full account shows the read-only banner and the list still renders", async () => {
      const original = stack.recipes.sql.execute;
      stack.recipes.sql.execute = async () => ({ ok: false, error: { code: "INTERNAL", message: "Storage quota exceeded. Used: 10 bytes, Limit: 10 bytes" } });
      try {
        await click(button("Manage shelves"));
        await waitFor(() => field("New shelf name"));
        await set(field("New shelf name"), "Blocked");
        await click(button("Add shelf"));
        await waitFor(() => /Storage full: read-only\./.test(text()), { what: "banner" });
        assert.doesNotMatch(text(), /Storage quota exceeded/, "raw node text is not shown");
        await click(button("Back to recipes"));
        await waitFor(() => titles().length >= 1, { what: "list still readable" });
        assert.match(text(), /Storage full: read-only\./);
      } finally {
        stack.recipes.sql.execute = original;
      }
    });
  });

  describe("bridge discipline", () => {
    test("the app never had more than 3 calls in flight through the whole run", () => {
      assert.ok(peak.max >= 1);
      assert.ok(peak.max <= 3, `peak in-flight calls was ${peak.max}`);
    });
  });
});
