---
type: "SQLite Table"
title: project_photo
description: "A photo of a project; the image bytes are in KV under photos/, at kv_key."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: project_photo
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

A photo of a project; the image bytes are in KV under photos/, at kv_key.

Table `project_photo` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `project_id` | TEXT | not null; references [project](/tables/project.md) `(id)` on delete cascade | - |
| `kv_key` | TEXT | not null | - |
| `taken_on` | TEXT | - | - |
| `caption` | TEXT | - | - |

# Access

The manifest grants `read`, `write`, `schema`.
