---
type: "SQLite View"
title: low_stock
description: "Materials at or under their reorder level."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: low_stock
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Materials at or under their reorder level.

View `low_stock` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `id` |
| `name` |
| `unit` |
| `on_hand` |
| `reorder_at` |

# Reads

* [material](/tables/material.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS low_stock AS
SELECT id, name, unit, on_hand, reorder_at
FROM material
WHERE reorder_at IS NOT NULL AND on_hand <= reorder_at
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
