---
type: "SQLite View"
title: project_hours
description: "Hours per project, from the work_session rows."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: project_hours
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Hours per project, from the work_session rows.

View `project_hours` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `project_id` |
| `title` |
| `hours` |
| `sessions` |

# Reads

* [project](/tables/project.md)
* [work_session](/tables/work_session.md)

# Read by views

* [project_overview](/views/project_overview.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS project_hours AS
SELECT p.id AS project_id,
       p.title,
       COALESCE(SUM(s.minutes), 0) / 60.0 AS hours,
       COUNT(s.id) AS sessions
FROM project p LEFT JOIN work_session s ON s.project_id = p.id
GROUP BY p.id
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
