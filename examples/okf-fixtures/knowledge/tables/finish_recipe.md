---
type: "SQLite Table"
title: finish_recipe
description: "Table finish_recipe: name, coats, cure_hours, steps (4 columns)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: finish_recipe
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Table `finish_recipe` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `name` | TEXT | primary key | - |
| `coats` | INTEGER | not null; default `1` | - |
| `cure_hours` | REAL | - | - |
| `steps` | TEXT | not null | JSON array of strings, one per step |

# Access

The manifest grants `read`, `write`, `schema`.
