---
type: "SQLite View"
title: project_spend
description: "What each project has cost so far, from purchases."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: project_spend
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

What each project has cost so far, from purchases.

View `project_spend` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `project_id` |
| `spent_cents` |
| `budget_cents` |
| `remaining_cents` |

# Reads

* [project](/tables/project.md)
* [purchase](/tables/purchase.md)

# Read by views

* [project_overview](/views/project_overview.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS project_spend AS
SELECT p.id AS project_id,
       COALESCE(SUM(u.cost_cents), 0) AS spent_cents,
       p.budget_cents,
       p.budget_cents - COALESCE(SUM(u.cost_cents), 0) AS remaining_cents
FROM project p LEFT JOIN purchase u ON u.project_id = p.id
GROUP BY p.id
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
