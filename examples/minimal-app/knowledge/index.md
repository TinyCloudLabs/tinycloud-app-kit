---
type: TinyCloud App
title: Minimal App
description: A TinyCloud app with one app-scoped KV namespace.
tinycloud:
  app: com.example.minimal
  profile: tinycloud.app.v1
  containsSecretValue: false
---

# Minimal App

Minimal App stores user preferences in KV under `settings/*`.

## Resources

- [KV](kv.md) - User preference documents.

## Agent Notes

- Preserve unknown JSON fields in settings documents.
- Do not delete settings unless the user explicitly asks.
