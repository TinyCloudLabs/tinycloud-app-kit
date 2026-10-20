---
type: "SQLite View"
title: cut_progress
description: "Cut progress per project: how many parts are in each state."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: cut_progress
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Cut progress per project: how many parts are in each state.

View `cut_progress` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `project_id` |
| `todo` |
| `cut` |
| `assembled` |

# Reads

* [cut_item](/tables/cut_item.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS cut_progress AS
SELECT project_id,
       SUM(CASE WHEN status = 'todo' THEN qty ELSE 0 END) AS todo,
       SUM(CASE WHEN status = 'cut' THEN qty ELSE 0 END) AS cut,
       SUM(CASE WHEN status = 'assembled' THEN qty ELSE 0 END) AS assembled
FROM cut_item
GROUP BY project_id
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
