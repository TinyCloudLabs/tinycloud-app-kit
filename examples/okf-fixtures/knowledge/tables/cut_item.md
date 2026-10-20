---
type: "SQLite Table"
title: cut_item
description: "Parts to cut for a project."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: cut_item
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Parts to cut for a project. A part name is unique within its project.

Table `cut_item` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `project_id` | TEXT | part of primary key; not null | - |
| `part` | TEXT | part of primary key; not null | - |
| `qty` | INTEGER | not null; default `1`; check `qty > 0` | - |
| `length_mm` | INTEGER | not null | - |
| `width_mm` | INTEGER | not null | - |
| `thickness_mm` | INTEGER | not null | - |
| `material_id` | TEXT | - | - |
| `status` | TEXT | not null; default `'todo'`; one of `todo`, `cut`, `assembled` | - |
| `area_mm2` | INTEGER | generated as `length_mm * width_mm` | - |

# Table constraints

* Primary key: `(project_id, part)`
* Foreign key `(project_id)` references [project](/tables/project.md) `(id)` on delete cascade
* Foreign key `(material_id)` references [material](/tables/material.md) `(id)`
* Check: `length_mm > 0 AND width_mm > 0 AND thickness_mm > 0`
* Table options: `WITHOUT ROWID`

# Read by views

* [cut_progress](/views/cut_progress.md)

# Access

The manifest grants `read`, `write`, `schema`.
