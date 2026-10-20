---
type: "SQLite View"
title: tool_service_due
description: "Tools whose last upkeep is older than their service interval (or that never had any)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: tool_service_due
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Tools whose last upkeep is older than their service interval (or that never had any).

View `tool_service_due` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `tool_id` |
| `name` |
| `last_service` |
| `service_every_days` |

# Reads

* [tool](/tables/tool.md)
* [maintenance_event](/tables/maintenance_event.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS tool_service_due AS
SELECT t.id AS tool_id,
       t.name,
       MAX(e.done_on) AS last_service,
       t.service_every_days
FROM tool t LEFT JOIN maintenance_event e ON e.tool_id = t.id
WHERE t.status != 'retired' AND t.service_every_days IS NOT NULL
GROUP BY t.id
HAVING last_service IS NULL OR julianday('now') - julianday(last_service) > t.service_every_days
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
