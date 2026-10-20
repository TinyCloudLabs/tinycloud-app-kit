---
type: "TinyCloud App"
title: Notes
description: "Notes with KV documents and SQLite search metadata."
generated: { by: tinycloud-app-kit/okf }
tinycloud: { app: com.example.notes, profile: tinycloud.app.v1, containsSecretValue: false }
---

Notes with KV documents and SQLite search metadata.

# Operations

## Install

1. Validate `manifest.json`.
2. Apply migrations to the `main` SQLite database.
3. Create KV documents lazily when users save notes.

Do not run cold DDL in request paths. Use migrations during install, startup, or
app registration, then use cheap readiness checks.

## Repair

The SQL index is derived from KV documents. If the index is corrupt, rebuild it
from `documents/*`.

## Secrets

If the optional `model-api-key` secret is missing, disable summaries instead of
blocking note editing. Never write plaintext secret values into this bundle.

# Resources

* Tables: [note_index](/tables/note_index.md)
* KV prefixes: [documents](/kv/documents.md)

# Permissions

Space `applications`, app prefix `com.example.notes`. Each resource below is in the form the CLI `--cap` flag takes (add `:<actions>`).

| Resource | Actions | Why |
| --- | --- | --- |
| `tinycloud.kv:applications:com.example.notes/` | get, put, del, list, metadata | Default app-scoped grant. |
| `tinycloud.sql:applications:com.example.notes/` | read, write | Default app-scoped grant. |

# Secrets

Names only. Secret values are never stored in this bundle.

* `model-api-key` (optional; used by `agent.summarizer`): Optional provider key used for note summaries.

# Getting access

An agent needs a delegation from the owner that covers the resources it touches. Ask for one with `tinycloud auth request --cap <resource>:<actions> --grant`, for example `--cap tinycloud.kv:applications:com.example.notes/:get,put,del,list,metadata`.

<!-- keep -->
Hand-written notes for agents go here. Text between the keep markers survives regeneration.
<!-- /keep -->
