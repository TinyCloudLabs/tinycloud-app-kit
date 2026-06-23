---
name: tinycloud-manifest-review
description: Review TinyCloud manifests and app knowledge bundles for installability, operability, and secret safety.
---

# TinyCloud Manifest Review

Use this skill to review a TinyCloud app package before it ships.

## Findings First

Prioritize:

1. Missing or invalid manifest fields.
2. Capabilities that do not match declared resources.
3. Secret values committed to manifest or knowledge files.
4. SQL/KV resources without enough agent operating context.
5. Excessive nesting that makes the bundle hard to traverse.
6. SQLite schema setup that bypasses the migration primitive.

## Checks

- `manifest.json` validates against the v1 schema.
- `knowledge` is either `true` or a `knowledge/*.md` root path.
- `knowledge/index.md` explains the app without requiring traversal.
- Missing `defaults` is treated as `true`; explicit permissions do not duplicate
  default app-scoped KV/SQLite grants without a reason.
- Category files exist only for categories in use.
- Secret files document references, consumers, and rotation, not values.
- SQL files identify databases, tables, derived state, and mutation rules.
- KV files identify prefixes, value shape, lifecycle, and deletion policy.
- SQL resources that run `CREATE`, `ALTER`, `DROP`, or index DDL request
  `tinycloud.sql/ddl`.
- The database named in the manifest matches the database used by SDK calls.
- `tc.sql` shortcut usage is understood as database `default`.
- Materialized indexes read through or rebuild from canonical data.
