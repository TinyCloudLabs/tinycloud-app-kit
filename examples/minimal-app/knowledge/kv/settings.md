---
type: "KV Prefix"
title: settings
description: "User preferences stored as JSON documents."
resource: tinycloud.kv:applications:com.example.minimal/settings/
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.minimal
  service: kv
  sensitivity: user-data
  profile: tinycloud.app.v1
  containsSecretValue: false
---

User preferences stored as JSON documents.

# Keys

Every key beginning with `com.example.minimal/settings/` in space `applications`.

# Access

The manifest grants `get`, `put`, `del`, `list`, `metadata`.
