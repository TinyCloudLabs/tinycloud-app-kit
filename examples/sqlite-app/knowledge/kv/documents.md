---
type: "KV Prefix"
title: documents
description: "User-authored note documents."
resource: tinycloud.kv:applications:com.example.notes/documents/
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.notes
  service: kv
  sensitivity: user-data
  profile: tinycloud.app.v1
  containsSecretValue: false
---

User-authored note documents.

# Keys

Every key beginning with `com.example.notes/documents/` in space `applications`.

# Access

The manifest grants `get`, `put`, `del`, `list`, `metadata`.

<!-- keep -->
Agent notes:

* Preserve unknown JSON fields.
* Do not delete documents unless the user explicitly asks.
<!-- /keep -->
