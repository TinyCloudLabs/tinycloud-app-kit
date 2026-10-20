---
type: "SQLite Table"
title: project
description: "Table project: id, title, status, started_on, finished_on, budget_cents, ... (7 columns)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: project
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Table `project` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `title` | TEXT | not null | - |
| `status` | TEXT | not null; default `'idea'`; one of `idea`, `planned`, `building`, `finishing`, `done`, `shelved` | - |
| `started_on` | TEXT | - | ISO date the first session happened |
| `finished_on` | TEXT | - | - |
| `budget_cents` | INTEGER | check `budget_cents >= 0` | - |
| `notes` | TEXT | - | - |

# Read by views

* [project_hours](/views/project_hours.md)
* [project_spend](/views/project_spend.md)
* [project_overview](/views/project_overview.md)

# Access

The manifest grants `read`, `write`, `schema`.
