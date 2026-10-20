---
type: "SQLite Table"
title: work_session
description: "One block of time spent on a project."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
table: work_session
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

One block of time spent on a project.

Table `work_session` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `project_id` | TEXT | not null; references [project](/tables/project.md) `(id)` on delete cascade | - |
| `worked_on` | TEXT | not null | - |
| `minutes` | INTEGER | not null; check `minutes > 0` | - |
| `summary` | TEXT | - | what got done, one or two lines |

# Indexes

* `work_session_by_project` on `(project_id, worked_on)`

# Read by views

* [project_hours](/views/project_hours.md)
* [weekly_hours](/views/weekly_hours.md)

# Access

The manifest grants `read`, `write`, `schema`.
