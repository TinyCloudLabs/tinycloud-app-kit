# Author a TinyCloud Manifest

TinyCloud manifests describe app identity, requested capabilities, resource
intent, and the optional agent-readable knowledge bundle.

## Minimal Shape

```json
{
  "manifest_version": 1,
  "app_id": "com.example.notes",
  "name": "Notes",
  "description": "Notes with user-owned storage.",
  "knowledge": {
    "format": "okf",
    "profile": "tinycloud.app.v1",
    "root": "knowledge/index.md"
  }
}
```

## Resource Declarations

Use `resources` to describe the app's high-level data surfaces. These
declarations are used by generators and review tools; the SDK capability
composer still resolves concrete permissions from the manifest.

```json
{
  "resources": {
    "kv": [
      {
        "name": "documents",
        "prefix": "documents/*",
        "description": "User-authored note documents.",
        "capabilities": ["tinycloud.kv/get", "tinycloud.kv/put"]
      }
    ],
    "sql": [
      {
        "name": "main",
        "engine": "sqlite",
        "schema": "schema.sql",
        "capabilities": ["tinycloud.sql/read", "tinycloud.sql/write", "tinycloud.sql/ddl"],
        "migrations": [
          {
            "id": "001_initial",
            "sql": ["CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)"]
          }
        ]
      }
    ]
  }
}
```

Use `ddl` when the app applies schema migrations. The manifest permission must
name the same database path the app uses at runtime. In TinyCloud SQL, shortcut
calls target a SQLite database named `default`; `tc.sql.execute(...)` and
`tc.sql.db("default").execute(...)` refer to the same database.

## Review Checklist

- `app_id` is stable and namespace-like.
- `description` explains what the app does, not just what it is called.
- `knowledge.root` points at `knowledge/index.md`.
- Secret resources describe references only.
- Resource descriptions are specific enough for an agent to avoid guessing.
- SQL resources that create or alter schema declare migrations and `ddl`.
- Rebuildable SQLite indexes are documented as derived caches, not sources of
  truth.
