---
type: "TinyCloud App"
title: "Minimal App"
description: "A TinyCloud app with one app-scoped KV namespace."
generated: { by: tinycloud-app-kit/okf }
tinycloud: { app: com.example.minimal, profile: tinycloud.app.v1, containsSecretValue: false }
---

A TinyCloud app with one app-scoped KV namespace.

# Agent notes

* Preserve unknown JSON fields in settings documents.
* Do not delete settings unless the user explicitly asks.

# Resources

* KV prefixes: [settings](/kv/settings.md)

# Permissions

Space `applications`, app prefix `com.example.minimal`. Each resource below is in the form the CLI `--cap` flag takes (add `:<actions>`).

| Resource | Actions | Why |
| --- | --- | --- |
| `tinycloud.kv:applications:com.example.minimal/` | get, put, del, list, metadata | Default app-scoped grant. |
| `tinycloud.sql:applications:com.example.minimal/` | read, write | Default app-scoped grant. |

# Getting access

An agent needs a delegation from the owner that covers the resources it touches. Ask for one with `tinycloud auth request --cap <resource>:<actions> --grant`, for example `--cap tinycloud.kv:applications:com.example.minimal/:get,put,del,list,metadata`.

<!-- keep -->
Hand-written notes for agents go here. Text between the keep markers survives regeneration.
<!-- /keep -->
