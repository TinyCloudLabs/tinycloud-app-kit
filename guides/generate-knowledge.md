# Generate App Knowledge

An app's knowledge bundle is an [Open Knowledge Format (OKF) v0.2][okf]
directory: markdown files with YAML frontmatter. It tells an agent what the app
stores, where, and how to use it, without reading the app's code. The goal is to
make an app operable, not to produce a large wiki.

The bundle ships with the app as a starting point. The living copy is in the
user's TinyCloud, under `<app_id>/knowledge/`, and belongs to the user.

[okf]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

## Layout

```text
knowledge/
  index.md          links only; the root index carries okf_version
  app.md            type: TinyCloud App
  tables/<t>.md     type: SQLite Table, one per CREATE TABLE
  views/<v>.md      type: SQLite View, one per CREATE VIEW
  kv/<prefix>.md    type: KV Prefix, one per KV permission prefix
  log.md            dated change history, newest first
```

The minimum bundle is `index.md` + `app.md`. Concepts exist only for resources
the app has: no empty category files.

Rules (OKF §8, §9, §11):

- Every concept `.md` has frontmatter with a non-empty `type`.
- `index.md` and `log.md` are reserved. `index.md` holds headings and
  `* [title](path) - description` entries only, with no prose. Only the root
  `index.md` has frontmatter, and only `okf_version: "0.2"`.
- `log.md` headings are `## YYYY-MM-DD`.

## Resources bind to TinyCloud paths

Each table, view and KV concept carries `resource:` in the form the CLI
`--cap` flag takes, without actions and relative to the space (so a bundle is
the same for every user):

```text
tinycloud.<service>:<space>:<path>

tinycloud.sql:applications:com.example.notes/main        # with `table: note_index`
tinycloud.kv:applications:com.example.notes/documents/
```

An agent pastes it into a request by appending actions:
`tinycloud auth request --cap tinycloud.kv:applications:com.example.notes/documents/:get,list --grant`.
`<path>` is the grant path after the manifest's `prefix` and `skipPrefix` rules
are applied. The SQL path is the database; the concept's `table:` or `view:` key
names the object inside it.

## Generate

```bash
node scripts/okf.mjs generate manifest.json --sql schema.sql --out knowledge/
```

| Option | Meaning |
| --- | --- |
| `--sql <file>` | DDL to document. Optional when the manifest's `resources.sql[]` names a `schema` file (or has `migrations`). |
| `--db <path>` | Database the DDL belongs to (a manifest grant path such as `<app_id>/<name>`). Only needed when it cannot be inferred. |
| `--out <dir>` | Bundle directory. |
| `--src <dir>` | Hand-written sources. Default: `knowledge-src/` next to the manifest. |
| `--date YYYY-MM-DD` | Date for new `log.md` entries. Default: today. |

What the generator does:

1. Reads `manifest.json` and resolves grants the way the SDK does: `prefix`,
   `skipPrefix`, `space`, and the `defaults` tier (implicit app-scoped KV and
   SQLite grants are listed in `app.md`).
2. Parses the DDL: columns, types, `NOT NULL`, defaults, `CHECK (col IN (...))`
   sets, primary and foreign keys, indexes, and the `--` / `/* */` comments
   beside each table, view and column. Views list their columns (when the
   `SELECT` names them), the tables and views they read, and their definition.
   Statements it does not model (triggers, virtual tables) are reported, not
   guessed.
3. Emits one concept per table, view and KV permission prefix (including prefixes
   that belong to other apps, flagged read only when the manifest grants no write
   action), `app.md`, `index.md` and `log.md`.
4. Never writes secret values. `resources.secrets` appears in `app.md` as names,
   consumers and rotation only.

`app.md` is the manifest `description`, then the body of `knowledge-src/app.md`
if present (put the app's write rules and what not to touch there), then the
generated resource list, permissions table, other-app grants and secret names.
Frontmatter keys in `knowledge-src/app.md` (for example `description`) override
the generated ones.

## Keep hand-written text

Regeneration rewrites generated text and keeps:

- Anything between `<!-- keep -->` and `<!-- /keep -->` in a concept file. A block
  stays after the generated line it followed; if that line is gone it moves to the
  end of the file and the generator warns. `app.md` is created with an empty block
  for notes. An unterminated block aborts the run instead of overwriting.
- Frontmatter keys the generator does not own (`tags`, `verified`, `status`,
  `stale_after`, `sources`, ...).
- Existing `log.md` entries. New entries are added under today's date only when a
  file was created or changed.

Files no longer produced by the schema are left in place with a warning; delete
them yourself.

## Check

```bash
node scripts/okf.mjs check knowledge/ --manifest
```

Without `--manifest`, `check` enforces the OKF rules above. With it (the manifest
defaults to `<dir>/../manifest.json`; pass `--manifest=<file>` to point
elsewhere), it also requires `app.md`, checks `tinycloud.app` against `app_id`,
and fails any `resource:` that no manifest permission covers. Each finding is
printed with a named code, for example `[missing-type]`, `[index-prose]`,
`[index-link-dangling]`, `[resource-uncovered]`. Exit code 1 means errors;
warnings (an unlisted concept, a dangling link inside a concept) do not fail.

Run `npm run okf:check` for every example and `npm test` for the tool's own tests,
including a deliberately broken bundle in `tests/okf/broken/`.

## Authoring rules

- Keep it concise; prefer tables for schemas and capabilities.
- Put agent-specific rules (what to preserve, what not to delete, how to write
  safely) in `knowledge-src/app.md` or a keep block next to the resource.
- Mark materialized indexes as rebuildable when they are caches.
- Say that reads still work when storage is full and that storage rejections
  should not be retried.
- Validate the manifest first: `npm run lint`.
