---
type: "KV Prefix"
title: com.example.lumberyard/catalog/
description: "Read the lumberyard app's catalog entries."
resource: tinycloud.kv:applications:com.example.lumberyard/catalog/
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: com.example.workshop
  service: kv
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Read the lumberyard app's catalog entries. Read only.

# Keys

Every key beginning with `com.example.lumberyard/catalog/` in space `applications`.

This path belongs to another app (the app whose id is `com.example.lumberyard`). Read its own knowledge bundle before relying on the layout.

# Access

The manifest grants `get`, `list`. This app only reads here: do not write to it. The data belongs to another app.
