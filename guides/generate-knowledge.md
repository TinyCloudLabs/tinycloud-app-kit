# Generate App Knowledge

Generated app knowledge should stay concise. The goal is to make an app
operable, not to produce a large wiki.

## Default Output

```text
knowledge/
  index.md
  resources.md
  sql.md
  kv.md
  secrets.md
  operations.md
```

Only emit files for categories present in the manifest.

## Expansion Rule

Use one file per category by default. Create directories only when they reduce
traversal cost:

- multiple independent SQLite databases
- large SQL schemas
- unrelated KV namespaces with different semantics
- complex secret rotation or consumer rules
- many operational playbooks

## Generator Requirements

1. Validate `manifest.json`.
2. Emit `knowledge/index.md`.
3. Emit category files only when relevant.
4. Keep capability details inline with resources.
5. Never include secret values.
6. Preserve hand-written sections when possible.
7. Validate frontmatter and links.
8. Format Markdown.
