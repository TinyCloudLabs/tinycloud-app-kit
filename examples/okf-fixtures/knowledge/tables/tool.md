---
type: "SQLite Table"
title: tool
description: "Hand and power tools the shop owns."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: tool
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Hand and power tools the shop owns.

Table `tool` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `name` | TEXT | not null; unique | - |
| `kind` | TEXT | not null; one of `hand`, `power`, `measuring`, `clamp`, `other` | - |
| `bought_on` | TEXT | - | - |
| `status` | TEXT | not null; default `'ok'`; one of `ok`, `needs_service`, `retired` | - |
| `service_every_days` | INTEGER | - | NULL: no fixed service interval |

# Read by views

* [tool_service_due](/views/tool_service_due.md)

# Access

The manifest grants `read`, `write`, `schema`.
