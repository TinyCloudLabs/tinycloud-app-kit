---
type: "SQLite Table"
title: purchase
description: "Table purchase: id, material_id, project_id, bought_on, qty, cost_cents, ... (7 columns)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: purchase
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Table `purchase` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `material_id` | TEXT | not null; references [material](/tables/material.md) `(id)` | - |
| `project_id` | TEXT | references [project](/tables/project.md) `(id)` on delete set null | - |
| `bought_on` | TEXT | not null | - |
| `qty` | REAL | not null; check `qty > 0` | - |
| `cost_cents` | INTEGER | not null; check `cost_cents >= 0` | - |
| `currency` | TEXT | not null; default `'USD'`; one of `USD`, `EUR`, `GBP`, `CAD` | - |

# Indexes

* `purchase_by_material` on `(material_id)`

# Read by views

* [project_spend](/views/project_spend.md)
* [monthly_species_spend](/views/monthly_species_spend.md)

# Access

The manifest grants `read`, `write`, `schema`.
