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
   `tinycloud.sql/schema`. Schema setup is read-first: check with a read and
   write only when a migration is pending. SDK 3.1.0-beta.2+ `migrations.apply`
   does this; on older SDKs, probe `__tinycloud_sql_migrations` first. Never put
   a write (including `CREATE TABLE IF NOT EXISTS`) in front of a list or get.
8. Treat missing `defaults` as `true`; document implicit app-scoped KV and
   SQLite resources so authors do not over-request baseline access.
9. Plan for storage full (`STORAGE_QUOTA_EXCEEDED` 402,
   `STORAGE_LIMIT_REACHED` 413). Reads keep working; on the first rejection
   show the "Storage full: read-only." banner with a Manage storage link,
   keep reads enabled, word failed saves with the canonical copy, say exactly
   what was stored on a partial save, and stop bulk loops. Detect by code
   (typed code anywhere in the `cause` chain beats text), with a text fallback
   for older SDKs. See `guides/sql-schema-and-migrations.md` "Storage Full".

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
- In knowledge files, tell agents that reads still work when storage is full,
  not to retry storage rejections, and to report partial saves as partial.
- Say "storage", never "quota", in user-facing copy.
