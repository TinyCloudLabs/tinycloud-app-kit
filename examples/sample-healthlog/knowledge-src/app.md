---
tags: [health, food, weight]
---

The user logs meals (slot, name, kcal, protein/carbs/fat) and body weight. The
app shows a **today card** (from `day_card`) and a **last 7 days** chart (from `week_rollup`). It has no network
access, no other storage and no side effects beyond the resources listed below. It is original work, not a fork.

# How to operate it (rules for agents)

1. Read this file, then only the concept you need. To see today: `SELECT * FROM day_card WHERE day = '<YYYY-MM-DD>'`.
2. **Every write carries an operation id.** Make a fresh unique `op_id` (for example `op_<time>_<random>`) per
   logical entry. Write with `INSERT ... ON CONFLICT(op_id) DO NOTHING`, then **read the row back** with
   `SELECT ... WHERE op_id = ?`. If the write times out, read back before retrying and reuse the same `op_id`.
   Never insert without an `op_id`.
3. Agents set `source = 'agent'`. `day` is the user's local calendar date (`YYYY-MM-DD`), not the UTC date: ask
   when unsure. `logged_at` is an ISO 8601 UTC instant.
4. Write only `meal` and `weight`. `day_card` and `week_rollup` are views and update by themselves.
5. Values: `slot` is one of `breakfast|lunch|dinner|snack`; `kcal` is a whole number 0 to 5000; macros are grams
   (>= 0); `weight_kg` is 20 to 500. The schema enforces these with CHECK constraints.
6. Do not delete or edit the user's rows unless the user asked. Never touch other apps' prefixes.
7. The user's copy is theirs: if the user asks you to change the app you may rewrite it (`app/`). Then update the
   affected concepts here and add a dated entry to `log.md`.

# Reading from the command line

```
tinycloud sql query "SELECT * FROM day_card WHERE day = ?" --db xyz.tinycloud.sample.healthlog/healthlog --space applications --params '["2026-10-20"]'
tinycloud kv get xyz.tinycloud.sample.healthlog/knowledge/index.md --space applications
```

The capability to request for a concept is its `resource:` value plus actions (`read,write` for SQL,
`get,put,list` for KV).
