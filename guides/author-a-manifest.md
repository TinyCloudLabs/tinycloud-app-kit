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

## Sessions and renewal

When browser sign-in requests renewal, the owner chooses whether to allow it
during OpenKey approval. OpenKey supplies the checkbox and its text. The app
leaves that choice there. The session ends at its signed expiry unless the
owner approved renewal and the node extends it. Renewal preserves the original
permissions, so the manifest should request only the access the app uses.

For ongoing access to ordinary KV or SQL data, OpenKey starts with renewal
selected and suggests 90 days or less if the request asks for less. For access
to secrets or decryption, renewal starts off and the owner must confirm to
turn it on. The owner can stop renewal under **Renewing permissions** in
OpenKey Settings. Access then ends at its original signed expiry or immediately
if that time has passed.

Starting with `@tinycloud/web-sdk` 3.12, browser sign-in raises
`AccountSetupRequiredError` when the owner has no account registry record and
the app's origin is outside the SDK's first-party list. Authors whose apps
need to sign in these owners should ask the TinyCloud team to list their origin.

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

## Forks

An app copied from another app records its origin with `forked_from`:

```json
{
  "forked_from": {
    "app_id": "com.example.notes",
    "source": "https://example.com/notes.git",
    "commit": "4f2a9c1d0e7b3a5c6d8e9f001a2b3c4d5e6f7a8b"
  }
}
```

All three fields are required strings. `scripts/okf.mjs generate` copies it into
`app.md`.

## Review Checklist

- `app_id` is stable and namespace-like.
- `description` explains what the app does, not just what it is called.
- `knowledge` is either `true` or a `knowledge/*.md` root path.
- `node scripts/okf.mjs check knowledge/ --manifest` passes.
- The author understands what default KV/SQL capabilities already grant.
- Secret resources describe references only.
- Resource descriptions are specific enough for an agent to avoid guessing.
- SQL resources that create or alter schema declare migrations and `schema`.
- Rebuildable SQLite indexes are documented as derived caches, not sources of
  truth.
