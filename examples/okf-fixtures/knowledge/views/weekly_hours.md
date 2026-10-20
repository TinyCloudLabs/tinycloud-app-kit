---
type: "SQLite View"
title: weekly_hours
description: "View weekly_hours: week, sessions, hours (3 columns)."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: weekly_hours
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

View `weekly_hours` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `week` |
| `sessions` |
| `hours` |

# Reads

* [work_session](/tables/work_session.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS weekly_hours AS
SELECT strftime('%Y-%W', worked_on) AS week,
       COUNT(*) AS sessions,
       SUM(minutes) / 60.0 AS hours
FROM work_session
GROUP BY week
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
