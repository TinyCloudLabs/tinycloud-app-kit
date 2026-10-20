---
type: "SQLite Table"
title: note_index
description: "Table note_index: id, title, updated_at, summary (4 columns)."
resource: tinycloud.sql:applications:com.example.notes/main
table: note_index
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.notes
  service: sql
  sensitivity: derived
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Table `note_index` in SQLite database `com.example.notes/main` (space `applications`). Search and indexing metadata.

# Schema

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | TEXT | primary key | - |
| `title` | TEXT | not null | - |
| `updated_at` | TEXT | not null | - |
| `summary` | TEXT | - | - |

# Indexes

* `idx_note_index_updated_at` on `(updated_at)`

# Access

The manifest grants `read`, `write`.
