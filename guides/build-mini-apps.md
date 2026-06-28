# Build TinyCloud Mini Apps

This repo defines the app package contract. Start here when you need to know
what a TinyCloud mini app must declare, validate, and explain.

For a runnable app, start from
[`tinyboilerplate`](https://github.com/TinyCloudLabs/tinyboilerplate). It
contains the scaffold command, blank starter, first real example app, backend
delegation flow, OpenAPI contracts, and verification scripts.

## Mental Model

A TinyCloud mini app has three parts:

1. `manifest.json` declares what the app is and what TinyCloud capabilities it
   needs.
2. App code implements the browser experience, backend routes, storage, and
   delegation behavior.
3. `knowledge/` explains app resources, schemas, secrets, and operations for
   humans and agents.

The browser owns user identity and consent. The backend operates on user data
only through delegated TinyCloud access. The app serves `/api/manifest` as its
runtime capability contract and `/api/server-info` as the backend delegation
policy.

## Recommended Builder Path

1. Scaffold a runnable app from `tinyboilerplate`.
2. Keep the generated manifest explicit and app-scoped.
3. Add or update the knowledge bundle for every resource category the app uses.
4. Validate the manifest, knowledge links, and SQL migration capabilities.
5. Run smoke tests for build/routes/browser shell.
6. Run a human-in-loop real-auth check before claiming OpenKey/WebAuthn and
   TinyCloud delegation work end to end.

## What This Repo Owns

- Manifest schema.
- Knowledge frontmatter schema.
- Minimal and SQLite package examples.
- Manifest and knowledge authoring guidance.
- Review guidance for installability, operability, and secret safety.

Runtime SDKs, CLIs, templates, and app examples should consume these contracts
instead of maintaining parallel manifest definitions.
