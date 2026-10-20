# TinyCloud App Kit

Schemas, examples, guides, and skills for TinyCloud app manifests and
agent-readable app packages.

## TinyCloud Mini Apps

A TinyCloud mini app is a small product surface with three inspectable parts:

- `manifest.json` declares the app identity and the TinyCloud capabilities it
  needs.
- App code implements the browser, backend, storage, and delegation behavior.
- `knowledge/` explains the app's resources so humans and agents can operate on
  them safely.

The browser owns identity and consent. Backends, workers, and agents should
touch user data only through delegated TinyCloud access. `/api/manifest` is the
runtime app contract; `/api/server-info` is the backend delegation policy.

Use this repo as the contract reference. Use
[`tinyboilerplate`](https://github.com/TinyCloudLabs/tinyboilerplate) when you
want a runnable starter, scaffold command, or full-stack example. See
[protocol.tinycloud.xyz](https://protocol.tinycloud.xyz) for the protocol
concepts and how apps work.

TinyCloud apps ship a runtime manifest plus a concise knowledge bundle:

```text
my-app/
  manifest.json
  knowledge/
    index.md          links only; root carries okf_version
    app.md
    tables/<table>.md
    views/<view>.md
    kv/<prefix>.md
    log.md
```

The manifest declares what the app needs. The knowledge bundle is an
[OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
directory that explains what the app's resources mean, one concept per SQLite
table, view and KV prefix, each bound to its TinyCloud path, so humans and
agents can operate on them safely. `scripts/okf.mjs` generates and checks it
([guide](guides/generate-knowledge.md)).

## Contents

```text
schemas/
  tinycloud-app-manifest.v1.schema.json
  tinycloud-app-knowledge-frontmatter.v1.schema.json
examples/
  minimal-app/
  sqlite-app/
  okf-fixtures/        invented larger app: tables, views, CHECK sets, grants
scripts/
  lint.mjs
  okf.mjs              OKF knowledge bundle generator and checker
tests/okf/broken/      deliberately non-conformant bundle used by npm test
guides/
  build-mini-apps.md
  ship-checklist.md
  author-a-manifest.md
  generate-knowledge.md
  sql-schema-and-migrations.md
skills/
  tinycloud-app-authoring/SKILL.md
  tinycloud-manifest-review/SKILL.md
```

## Package Rules

- One concept per SQLite table, view and KV permission prefix; `index.md` lists
  concepts and holds no prose.
- Put hand-written rules in `knowledge-src/app.md` or between
  `<!-- keep -->` markers so regeneration preserves them.
- Document secret references, never secret values.
- Keep capability details inline with the resources that require them.
- Treat `manifest.json` as the install/runtime contract and `knowledge/` as the
  operational contract.
- Use `knowledge: true` for the default `knowledge/index.md` root, or provide a
  `knowledge/*.md` root path.
- A copy of an app records where it came from in `forked_from`
  (`{app_id, source, commit}`).
- Document implicit default KV and SQLite resources when defaults are enabled.
- Use `sql.db(name).migrations.apply(...)` for SQLite schema setup instead of
  running cold DDL in hot user paths.

## Status

This repo is the canonical home for app package schemas and authoring assets.
Runtime SDK and CLI implementations should consume these schemas rather than
maintaining parallel manifest definitions.

## Validation

```bash
npm run lint
```

The linter is dependency-free. It parses schema/example JSON, checks
`knowledge` pointers, verifies example knowledge roots exist, and catches SQL
migrations that forgot `tinycloud.sql/schema`. Knowledge bundles are checked with
`npm run okf:check` and the generator's own tests run with `npm test`.
