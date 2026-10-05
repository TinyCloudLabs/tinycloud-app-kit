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

## Read First, Write Only When Pending

Reads never depend on writes. Opening the app, listing, viewing, copying, and
exporting must work when the owner's TinyCloud storage is full, and the node
refuses writes that would grow storage on a full account. So schema setup must
check with a read and write only when a migration is pending:

- With `@tinycloud/*` SDK 3.1.0-beta.2 or later, `migrations.apply` already
  does this: it reads the applied ids with a `SELECT` and sends no write when
  nothing is pending. Calling it on open is safe.
- Older SDKs write on every `migrations.apply` call (a `CREATE TABLE IF NOT
  EXISTS __tinycloud_sql_migrations` plus an `INSERT OR REPLACE`), even when
  everything is applied. Either upgrade or probe first and call `apply` only
  when something is missing (`migrations` is the same array as above):

  ```ts
  import type { IDatabaseHandle } from "@tinycloud/sdk-services";

  // Returns the SDK result instead of throwing, so the caller can classify the
  // error. SDK calls return `{ ok: false, error }` rather than throwing.
  async function applyPendingMigrations(db: IDatabaseHandle) {
    const applied = await db.query(
      "SELECT id FROM __tinycloud_sql_migrations WHERE namespace = ?",
      ["com.example.notes"],
    );
    // "No such table" or database-not-found means nothing is applied yet.
    const nothingApplied =
      !applied.ok &&
      (applied.error.code === "SQL_DATABASE_NOT_FOUND" ||
        /no such table|database not found/i.test(applied.error.message));
    if (!applied.ok && !nothingApplied) return applied;
    const appliedIds = new Set(applied.ok ? applied.data.rows.map((row) => row[0]) : []);
    if (migrations.every((migration) => appliedIds.has(migration.id))) return { ok: true };
    return db.migrations.apply({ namespace: "com.example.notes", migrations });
  }

  const schema = await applyPendingMigrations(tc.sql.db("main"));
  if (!schema.ok) {
    // Pass the SDK error on unchanged so its code (or, on older SDKs, the
    // node's 402 text) reaches the storage-full check in "Detecting It".
    if (isStorageFull(schema.error)) enterReadOnly(schema.error);
    else throw new Error(`Schema setup failed: ${schema.error.message}`, { cause: schema.error });
  }
  // On storage full, carry on: load and show whatever can be read.
  ```

  `isStorageFull` and `enterReadOnly` are the app's own storage-full check and
  read-only state (see "Storage Full" below). Do not wrap the error in a new
  message without keeping it as `cause`; the check needs its code.

- Apps that create their schema lazily, on the first save, instead of on open
  must keep list and get paths free of DDL. Run the `SELECT`, and treat a
  missing table on a database that was never set up as "no data yet".

If the schema cannot be written because storage is full, keep showing whatever
can be read and enter the read-only state below. Do not block the read view on
a migration that cannot run.

## Manifest Requirements

The app manifest must describe the database and include `schema` when migrations
create or alter schema.

```json
{
  "resources": {
    "sql": [
      {
        "name": "main",
        "engine": "sqlite",
        "capabilities": ["tinycloud.sql/read", "tinycloud.sql/write", "tinycloud.sql/schema"],
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

- Do not run cold DDL in hot user paths, and never put a write in front of a
  read. `CREATE TABLE IF NOT EXISTS` and other schema setup are writes: they
  may grow storage, and a full account may reject them. Newer nodes allow
  schema writes that change nothing, but older nodes refuse every non-read
  statement on a full account, so do not rely on it.
- Do not assume `write` permission includes manifest-visible schema setup;
  declare `schema`.
- Do not treat materialized SQLite indexes as canonical data. They should be
  rebuildable from KV, capabilities, or another source of truth.
- Do not hide setup failures as empty states. A missing table is an empty
  state only when the database has never been set up; otherwise surface setup
  failures and migration errors. A storage-full rejection is neither: it puts
  the app in the read-only state.
- Do not copy app-specific `ensureSchema` helpers between apps. Use the shared
  migration primitive.
- Do not retry storage rejections. They stay true until the owner frees space
  or upgrades.

## Storage Full: Reads Keep Working

TinyCloud storage is one budget shared by every app on the owner's account.
When it is full, the node refuses writes that would grow storage and keeps
serving reads. Deletes free space and must stay available. Every app follows
four rules:

1. **Never put a write in front of a read.** Check the schema with a read and
   write only when a migration is pending (see above). If the schema can't be
   written because storage is full, keep showing whatever can be read.
2. **On the first storage rejection, enter a read-only state.**
   - Show one persistent banner (copy below) with a "Manage storage" link to
     `https://account.tinycloud.xyz/billing`.
   - Keep read actions enabled.
   - Let write actions fail with the save message, not raw node text.
   - Clear the state after the next successful write. Scope it to the account
     that hit it; a different signed-in account does not inherit it.
3. **Be honest about partial saves.** If part of a split SQL/KV write was
   stored and the rest was not, say exactly which part. Do not say "nothing was
   saved" when something was.
4. **Stop bulk loops at the first storage rejection.** Imports, syncs, and
   batch edits stop there and report what was and was not saved.

### Detecting It

Detect by error code, not by HTTP status or text alone:

| Code | Meaning | Node status |
| --- | --- | --- |
| `STORAGE_QUOTA_EXCEEDED` | Storage is full. | 402 |
| `STORAGE_LIMIT_REACHED` | This write is larger than what is left. | 413 on uploads |

SDK 3.1.0-beta.2 and later raise these codes for KV, SQL, and DuckDB, carry
`meta.usedBytes`/`meta.limitBytes`, and export `isStorageFullError()`. Older
SDKs report a SQL 402 as `NETWORK_ERROR` with the node's text, so keep a text
fallback (`/storage quota exceeded|write exceeds remaining storage/i`). When an
error is wrapped, check for a typed code anywhere in the `cause` chain before
falling back to text: the node's generic "Storage quota exceeded" sentence can
accompany `STORAGE_LIMIT_REACHED`. A backend that relays the rejection should
keep the code and status (402/413) rather than answering 500.

### Words

Say "storage", never "quota" (transcription and LLM credits already use
"quota"). Never show `Limit: 0 bytes`, "network error", "permission", "try
again", or a space name as the thing that is full. Storage is account-wide, so
talk about "your TinyCloud storage".

| Situation | Text |
| --- | --- |
| Write rejected, storage full | Your TinyCloud storage is full, so this change was not saved. Reading still works. Free up space or upgrade your plan to save again. |
| Write too large for what's left | This change is larger than the TinyCloud storage you have left, so it was not saved. Reading still works. Free up space or upgrade your plan to save it. |
| Read-only banner | **Storage full: read-only.** Your TinyCloud storage, shared by all your TinyCloud apps, is full. You can still view and copy your data. Saving changes is paused until you free up space or upgrade your plan. [Manage storage] |
| Nearly full (≥ 90%) | TinyCloud storage almost full: 92 MB of 100 MB used. [Manage storage] |
| Partial save | The secret was saved, but its details were not, because your TinyCloud storage is full. (Name the parts for your app.) |

`[Manage storage]` links to `https://account.tinycloud.xyz/billing`.

## Materialized Indexes

If a SQLite table is a cache, say so in `knowledge/sql.md`.

```md
| Table | Purpose | Agent Notes |
| --- | --- | --- |
| `note_index` | Search metadata for KV notes. | Rebuildable from `documents/*`. |
```

Missing cache tables should be treated as setup drift or cache misses, not data
loss.
