---
type: "SQLite Table"
title: maintenance_event
description: "Table maintenance_event: id, tool_id, done_on, kind, cost_cents (5 columns)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: maintenance_event
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Table `maintenance_event` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `tool_id` | TEXT | not null; references [tool](/tables/tool.md) `(id)` | - |
| `done_on` | TEXT | not null | - |
| `kind` | TEXT | not null; one of `sharpen`, `lubricate`, `calibrate`, `replace_part` | - |
| `cost_cents` | INTEGER | default `0` | - |

# Read by views

* [tool_service_due](/views/tool_service_due.md)

# Access

The manifest grants `read`, `write`, `schema`.
