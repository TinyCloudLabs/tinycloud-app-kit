---
type: "TinyCloud App"
title: "Workshop Log"
description: "A woodworking shop log kept in SQLite plus project photos in KV."
forked_from: { app_id: com.example.workshop-upstream, source: https://example.com/apps/workshop-log.git, commit: "4f2a9c1d0e7b3a5c6d8e9f001a2b3c4d5e6f7a8b" }
generated: { by: tinycloud-app-kit/okf }
tinycloud: { app: com.example.workshop, profile: tinycloud.app.v1, containsSecretValue: false }
---

A woodworking shop log: projects, work sessions, materials, purchases, cut lists, tool maintenance and project photos.

Forked from `com.example.workshop-upstream` (https://example.com/apps/workshop-log.git at 4f2a9c1d0e7b).

# Working rules

* Costs are integer cents; hours are derived in views, never stored.
* A project is `done` only when `finished_on` is set.
* Photos are KV objects under `photos/`; a `project_photo` row points at the key.
* Another app's price book and catalog are read only: never write to them.

# Resources

* Tables: [project](/tables/project.md), [tool](/tables/tool.md), [material](/tables/material.md), [work_session](/tables/work_session.md), [purchase](/tables/purchase.md), [cut_item](/tables/cut_item.md), [finish_recipe](/tables/finish_recipe.md), [maintenance_event](/tables/maintenance_event.md), [project_photo](/tables/project_photo.md)
* Views: [project_hours](/views/project_hours.md), [project_spend](/views/project_spend.md), [project_overview](/views/project_overview.md), [low_stock](/views/low_stock.md), [tool_service_due](/views/tool_service_due.md), [weekly_hours](/views/weekly_hours.md), [cut_progress](/views/cut_progress.md), [monthly_species_spend](/views/monthly_species_spend.md)
* KV prefixes: [photos/](/kv/photos.md), [exports/latest.json](/kv/exports-latest-json.md), [knowledge/](/kv/knowledge.md), [com.example.lumberyard/catalog/](/kv/com-example-lumberyard-catalog.md)

# Permissions

Space `applications`, app prefix `com.example.workshop`. Each resource below is in the form the CLI `--cap` flag takes (add `:<actions>`).

| Resource | Actions | Why |
| --- | --- | --- |
| `tinycloud.sql:applications:com.example.workshop/shop_log` | read, write, schema | The shop log database: projects, sessions, materials, purchases, cut lists and tool upkeep. |
| `tinycloud.kv:applications:com.example.workshop/photos/` | get, put, list | Project photos, referenced from project_photo rows. |
| `tinycloud.kv:applications:com.example.workshop/exports/latest.json` | get, put | The most recent full export of the log, as one JSON document. |
| `tinycloud.kv:applications:com.example.workshop/knowledge/` | get, put, list | This app's OKF knowledge bundle. |
| `tinycloud.sql:applications:com.example.lumberyard/price_book` | read | Read the lumberyard app's price book to fill in purchase costs. Read only. |
| `tinycloud.kv:applications:com.example.lumberyard/catalog/` | get, list | Read the lumberyard app's catalog entries. Read only. |

# Other apps' data

These grants point at data owned by other apps:

* `tinycloud.sql:applications:com.example.lumberyard/price_book`: read (read only)
* `tinycloud.kv:applications:com.example.lumberyard/catalog/`: get, list (read only)

# Getting access

An agent needs a delegation from the owner that covers the resources it touches. Ask for one with `tinycloud auth request --cap <resource>:<actions> --grant`, for example `--cap tinycloud.sql:applications:com.example.workshop/shop_log:read,write,schema`.

<!-- keep -->
Hand-written notes for agents go here. Text between the keep markers survives regeneration.
<!-- /keep -->
