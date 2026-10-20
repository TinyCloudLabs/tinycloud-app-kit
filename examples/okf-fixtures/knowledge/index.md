---
okf_version: "0.2"
---

# App

* [Workshop Log](app.md) - A woodworking shop log kept in SQLite plus project photos in KV.

# Tables

* [project](tables/project.md) - Table project: id, title, status, started_on, finished_on, budget_cents, ... (7 columns).
* [tool](tables/tool.md) - Hand and power tools the shop owns.
* [material](tables/material.md) - Stock the shop keeps: boards, sheets and consumables.
* [work_session](tables/work_session.md) - One block of time spent on a project.
* [purchase](tables/purchase.md) - Table purchase: id, material_id, project_id, bought_on, qty, cost_cents, ... (7 columns).
* [cut_item](tables/cut_item.md) - Parts to cut for a project.
* [finish_recipe](tables/finish_recipe.md) - Table finish_recipe: name, coats, cure_hours, steps (4 columns).
* [maintenance_event](tables/maintenance_event.md) - Table maintenance_event: id, tool_id, done_on, kind, cost_cents (5 columns).
* [project_photo](tables/project_photo.md) - A photo of a project; the image bytes are in KV under photos/, at kv_key.

# Views

* [project_hours](views/project_hours.md) - Hours per project, from the work_session rows.
* [project_spend](views/project_spend.md) - What each project has cost so far, from purchases.
* [project_overview](views/project_overview.md) - One row per project: status, hours and spend together.
* [low_stock](views/low_stock.md) - Materials at or under their reorder level.
* [tool_service_due](views/tool_service_due.md) - Tools whose last upkeep is older than their service interval (or that never had any).
* [weekly_hours](views/weekly_hours.md) - View weekly_hours: week, sessions, hours (3 columns).
* [cut_progress](views/cut_progress.md) - Cut progress per project: how many parts are in each state.
* [monthly_species_spend](views/monthly_species_spend.md) - Monthly spend per material species, using the purchase and material tables.

# KV prefixes

* [photos/](kv/photos.md) - Project photos, referenced from project_photo rows.
* [exports/latest.json](kv/exports-latest-json.md) - The most recent full export of the log, as one JSON document.
* [knowledge/](kv/knowledge.md) - This app's OKF knowledge bundle.
* [com.example.lumberyard/catalog/](kv/com-example-lumberyard-catalog.md) - Read the lumberyard app's catalog entries.

# History

* [Update log](log.md) - Dated history of changes to this bundle.
