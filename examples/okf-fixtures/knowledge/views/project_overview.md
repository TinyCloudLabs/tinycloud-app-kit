---
type: "SQLite View"
title: project_overview
description: "One row per project: status, hours and spend together."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: project_overview
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

One row per project: status, hours and spend together.

View `project_overview` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `project_id` |
| `title` |
| `status` |
| `hours` |
| `sessions` |
| `spent_cents` |
| `remaining_cents` |

# Reads

* [project_hours](/views/project_hours.md)
* [project](/tables/project.md)
* [project_spend](/views/project_spend.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS project_overview AS
SELECT h.project_id, h.title, p.status, h.hours, h.sessions, s.spent_cents, s.remaining_cents
FROM project_hours h
JOIN project p ON p.id = h.project_id
JOIN project_spend s ON s.project_id = h.project_id
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
