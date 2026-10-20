---
description: A small recipe book. Shelves group recipes; a recipe can be started from a meal in the Health Log sample app.
---

# What it holds

* One SQLite database, `xyz.tinycloud.sample.recipes/recipes`: `recipe`, `shelf`, `recipe_shelf` (which recipe is on which shelf) and `meal_link` (which Health Log meal a recipe was started from). The `recipe_card` and `shelf_overview` views are what the screens read.
* Settings in KV under `prefs/`. The installed app (`app.jsx`, `manifest.json`, `schema.sql`) is under `app/`.
* It reads the Health Log's `meal` table (`xyz.tinycloud.sample.healthlog/healthlog`). That is another app's data and this app has read access only.

# Working rules

* Ids are text the writer makes up with a prefix: `rcp_`, `shf_`, `lnk_`, then the time in base 36 and a few random characters. Reusing an id never creates a second row.
* Set `created_at` and `updated_at` as ISO 8601 UTC text. Set `updated_at` on every change to a recipe: the list is sorted by it.
* `ingredients_json` is a JSON array of `{"qty": "200 g", "item": "flour"}` (`qty` is free text and may be empty). `steps_json` is a JSON array of strings in order. Both default to `[]`.
* Nutrition is per serving. If you set any of `kcal`, `protein_g`, `carbs_g` or `fat_g`, also set `nutrition_basis` (`label`, `estimate` or `copied_from_meal`). The schema does not enforce that pairing; the app does.
* Foreign keys are declared but the node does not enforce them. To delete a recipe, delete its `recipe_shelf` and `meal_link` rows first, then the `recipe` row. To delete a shelf, delete its `recipe_shelf` rows first; its recipes stay.
* `origin = 'from_meal'` means the recipe was started from a Health Log meal. Copy that meal's macros into the recipe, set `nutrition_basis = 'copied_from_meal'`, and add a `meal_link` row with `health_meal_id` set to the meal's `id` and the `meal_day`, `meal_name` and `meal_kcal` snapshot. One meal can be linked to a recipe only once.
* Never write to `xyz.tinycloud.sample.healthlog/`. The grant is read only and the node refuses writes there. If a meal is missing, tell the user to log it in the Health Log.
* Before you read the Health Log's data, read its own knowledge: `xyz.tinycloud.sample.healthlog/knowledge/index.md`. This app has no KV grant there, so an agent needs its own grant to read it.
* If you change a table's columns, update that table's concept and add a dated line to `log.md`.
