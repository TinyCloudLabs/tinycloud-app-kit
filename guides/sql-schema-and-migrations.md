# SQL Schema and Migrations

TinyCloud SQL exposes SQLite. Schema setup should use the SDK migration
primitive, not ad hoc `CREATE TABLE` calls in hot request paths.

## Terms

- Schema: the desired database shape.
- Migration: a versioned change that moves a database from one schema state to
  another.
- Migration apply API: the TinyCloud runtime primitive that applies migrations
  idempotently and signs the required SQL actions.

## App Pattern

```ts
await tc.sql.db("main").migrations.apply({
  namespace: "com.example.notes",
  migrations: [
    {
      id: "001_initial_note_index",
      sql: [
        "CREATE TABLE IF NOT EXISTS note_index (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL)",
        "CREATE INDEX IF NOT EXISTS idx_note_index_updated_at ON note_index(updated_at)"
      ],
    },
  ],
});
```

Use a stable namespace. Use ordered, stable migration ids. Keep migrations
idempotent when SQLite allows it.

## Manifest Requirements

The app manifest must describe the database and include `ddl` when migrations
create or alter schema.

```json
{
  "resources": {
    "sql": [
      {
        "name": "main",
        "engine": "sqlite",
        "capabilities": ["tinycloud.sql/read", "tinycloud.sql/write", "tinycloud.sql/ddl"],
        "migrations": [
          {
            "id": "001_initial",
            "sql": ["CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY)"]
          }
        ]
      }
    ]
  }
}
```

The permission path must match the database name used at runtime. The SDK
shortcut `tc.sql.execute(...)` uses the SQLite database named `default`; it is
equivalent to `tc.sql.db("default").execute(...)`.

## Footguns

- Do not run cold DDL in hot user paths.
- Do not assume `write` permission includes manifest-visible schema setup;
  declare `ddl`.
- Do not treat materialized SQLite indexes as canonical data. They should be
  rebuildable from KV, capabilities, or another source of truth.
- Do not hide missing-table errors as empty states. Surface setup failures and
  retryable migration errors.
- Do not copy app-specific `ensureSchema` helpers between apps. Use the shared
  migration primitive.

## Materialized Indexes

If a SQLite table is a cache, say so in `knowledge/sql.md`.

```md
| Table | Purpose | Agent Notes |
| --- | --- | --- |
| `note_index` | Search metadata for KV notes. | Rebuildable from `documents/*`. |
```

Missing cache tables should be treated as setup drift or cache misses, not data
loss.
