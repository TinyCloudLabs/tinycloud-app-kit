---
name: tinycloud-app-authoring
description: Author TinyCloud app manifests and concise agent-readable knowledge bundles.
---

# TinyCloud App Authoring

Use this skill when creating or updating a TinyCloud app package.

## Workflow

1. Read `manifest.json`.
2. Validate the app identity, permissions, resources, and `knowledge`.
3. Keep generated knowledge flat unless a category is large.
4. Document SQL, KV, DuckDB, secrets, and operations only when present.
5. Keep capability details near the resource that requires them.
6. Never write secret values into app knowledge files.
7. For SQLite schema setup, use `sql.db(name).migrations.apply(...)` and require
   `tinycloud.sql/ddl`.
8. Treat missing `defaults` as `true`; document implicit app-scoped KV and
   SQLite resources so authors do not over-request baseline access.

## Output Shape

```text
manifest.json
knowledge/
  index.md
  resources.md
  sql.md
  kv.md
  secrets.md
  operations.md
```

## Style

- Be concise.
- Prefer tables for capabilities and schemas.
- Put agent-specific preservation rules under `Agent notes`.
- Do not generate empty category files.
- When `knowledge` is `true`, use `knowledge/index.md`.
- Mark materialized SQL indexes as rebuildable when they are caches.
- Do not place cold DDL in hot request paths.
