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
  "knowledge": true
}
```

`knowledge: true` means the app ships the default knowledge root at
`knowledge/index.md`. Use a string when the root differs:

```json
{
  "knowledge": "knowledge/index.md"
}
```

## Defaults

`defaults` is optional and defaults to `true`. That gives the app an app-scoped
baseline grant in the default `applications` space:

| Implicit Resource | Scope | Capabilities |
| --- | --- | --- |
| App KV | `<app_id>/*` | `tinycloud.kv/get`, `put`, `del`, `list`, `metadata` |
| App SQLite | `<app_id>/*` | `tinycloud.sql/read`, `write` |
| Capability Introspection | app session | `tinycloud.capabilities/read` |

Think of these as invisible default resources. A manifest author does not need
to request them again just to use ordinary app-scoped KV or SQLite reads/writes.
Only add explicit permissions or resources when the app needs:

- a different space
- a path outside the default app prefix
- non-default actions such as `tinycloud.sql/schema`
- human/agent documentation for a specific resource

Use `defaults: false` when every permission should be explicit.

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
        "capabilities": ["tinycloud.sql/read", "tinycloud.sql/write", "tinycloud.sql/schema"],
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

Use `schema` when the app applies schema migrations. The manifest permission must
name the same database path the app uses at runtime. In TinyCloud SQL, shortcut
calls target a SQLite database named `default`; `tc.sql.execute(...)` and
`tc.sql.db("default").execute(...)` refer to the same database.

The default SQL grant covers `read` and `write`, but not schema changes. Apps
that run migrations still need `tinycloud.sql/schema`.

## Review Checklist

- `app_id` is stable and namespace-like.
- `description` explains what the app does, not just what it is called.
- `knowledge` is either `true` or a `knowledge/*.md` root path.
- The author understands what default KV/SQL capabilities already grant.
- Secret resources describe references only.
- Resource descriptions are specific enough for an agent to avoid guessing.
- SQL resources that create or alter schema declare migrations and `schema`.
- Rebuildable SQLite indexes are documented as derived caches, not sources of
  truth.
