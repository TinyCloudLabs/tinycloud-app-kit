---
type: "SQLite View"
title: monthly_species_spend
description: "Monthly spend per material species, using the purchase and material tables."
resource: tinycloud.sql:applications:com.example.workshop/shop_log
view: monthly_species_spend
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: sql
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Monthly spend per material species, using the purchase and material tables.

View `monthly_species_spend` in SQLite database `com.example.workshop/shop_log` (space `applications`).

# Schema

| Column |
| --- |
| `month` |
| `species` |
| `cost_cents` |

# Reads

* [purchase](/tables/purchase.md)
* [material](/tables/material.md)

# Definition

```sql
CREATE VIEW IF NOT EXISTS monthly_species_spend AS
SELECT strftime('%Y-%m', u.bought_on) AS month, m.species, SUM(u.cost_cents) AS cost_cents
FROM purchase u JOIN material m ON m.id = u.material_id
GROUP BY month, m.species
```

# Access

Query it with the `read` action; the manifest grants `read`, `write`, `schema`.
