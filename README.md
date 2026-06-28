# TinyCloud App Kit

Schemas, examples, guides, and skills for TinyCloud app manifests and
agent-readable app packages.

TinyCloud apps ship a runtime manifest plus a concise knowledge bundle:

```text
my-app/
  manifest.json
  knowledge/
    index.md
    resources.md
    sql.md
    kv.md
    secrets.md
    operations.md
```

The manifest declares what the app needs. The knowledge bundle explains what
the app's resources mean so humans and agents can operate on them safely.

## Contents

```text
schemas/
  tinycloud-app-manifest.v1.schema.json
  tinycloud-app-knowledge-frontmatter.v1.schema.json
examples/
  minimal-app/
  sqlite-app/
guides/
  author-a-manifest.md
  generate-knowledge.md
  sql-schema-and-migrations.md
skills/
  tinycloud-app-authoring/SKILL.md
  tinycloud-manifest-review/SKILL.md
```

## Package Rules

- Keep small app knowledge bundles flat.
- Add nested directories only when a category is large enough to reduce
  traversal cost.
- Document secret references, never secret values.
- Keep capability details inline with the resources that require them.
- Treat `manifest.json` as the install/runtime contract and `knowledge/` as the
  operational contract.
- Use `knowledge: true` for the default `knowledge/index.md` root, or provide a
  `knowledge/*.md` root path.
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
migrations that forgot `tinycloud.sql/schema`.
