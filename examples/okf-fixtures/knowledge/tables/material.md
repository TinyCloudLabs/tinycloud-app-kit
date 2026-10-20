---
type: "SQLite Table"
title: material
description: "Stock the shop keeps: boards, sheets and consumables."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: material
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Stock the shop keeps: boards, sheets and consumables. on_hand is in the material's own unit.

Table `material` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `name` | TEXT | not null | - |
| `species` | TEXT | - | - |
| `unit` | TEXT | not null; one of `board_ft`, `sheet`, `piece`, `liter`, `kg` | - |
| `on_hand` | REAL | not null; default `0`; check `on_hand >= 0` | - |
| `reorder_at` | REAL | - | - |

# Read by views

* [low_stock](/views/low_stock.md)
* [monthly_species_spend](/views/monthly_species_spend.md)

# Access

The manifest grants `read`, `write`, `schema`.
