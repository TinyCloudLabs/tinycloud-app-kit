---
type: "KV Prefix"
title: xyz.tinycloud.sample.healthlog/knowledge/
description: "Read the Health Log's knowledge bundle to learn how its data is laid out."
resource: tinycloud.kv:applications:xyz.tinycloud.sample.healthlog/knowledge/
generated: { by: tinycloud-app-kit/okf }
tinycloud:
  app: xyz.tinycloud.sample.recipes
  service: kv
  profile: tinycloud.app.v1
  containsSecretValue: false
---

Read the Health Log's knowledge bundle to learn how its data is laid out. Read only.

# Keys

Every key beginning with `xyz.tinycloud.sample.healthlog/knowledge/` in space `applications`.

This path belongs to another app (the app whose id is `xyz.tinycloud.sample.healthlog`). Read its own knowledge bundle before relying on the layout.

# Access

The manifest grants `get`, `list`. This app only reads here: do not write to it. The data belongs to another app.
