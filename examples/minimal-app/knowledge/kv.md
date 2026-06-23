---
type: TinyCloud KV
title: KV
description: App-scoped KV resources.
tinycloud:
  app: com.example.minimal
  service: kv
  profile: tinycloud.app.v1
  sensitivity: user-data
  containsSecretValue: false
---

# KV

## Settings

Prefix: `settings/*`

Purpose: User preferences stored as JSON documents.

Access:

| Capability | Why |
| --- | --- |
| `tinycloud.kv/get` | Read preferences. |
| `tinycloud.kv/put` | Save preference changes. |
| `tinycloud.kv/list` | List known preference keys. |
