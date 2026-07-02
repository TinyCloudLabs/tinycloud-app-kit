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

## Target Architecture

This is the architecture a full TinyCloud app is working toward. Simpler apps
are subsets of it (frontend-only, or frontend plus backend). See
[protocol.tinycloud.xyz](https://protocol.tinycloud.xyz) for the canonical
long-form version.

A full app has up to three components, and **each has its own DID**:

1. **Frontend** — the user-facing browser app.
2. **Backend** — a server-side component deployed inside a TEE (Phala) so it is
   verifiable: attestation proves it runs the software it claims to run.
3. **Agent** — runs on the TinyCloud agent service.

**TinyCloud is both the datastore and the communication substrate.** All three
components store data in TinyCloud and communicate through TinyCloud shared
spaces, not through bespoke channels:

- The frontend usually receives communication from the backend.
- The backend receives communication from the agent.
- The frontend can also talk directly to the agent.

**Permission and delegation flow:** the frontend asks the user for every
permission the app needs in a single consent — its own, plus what the backend
requests, plus what the agent requests. The frontend then delegates the
backend-requested subset to the backend's DID and the agent-requested subset to
the agent's DID.

## Recommended Builder Path

1. Scaffold a runnable app from `tinyboilerplate`.
2. Keep the generated manifest explicit and app-scoped.
3. Add or update the knowledge bundle for every resource category the app uses.
4. Validate the manifest, knowledge links, and SQL migration capabilities.
5. Run smoke tests for build/routes/browser shell.
6. Run a human-in-loop real-auth check before claiming OpenKey/WebAuthn and
   TinyCloud delegation work end to end.

See [From Manifest to Running App](ship-checklist.md) for the end-to-end
checklist from `npm run lint` through deployment.

## What This Repo Owns

- Manifest schema.
- Knowledge frontmatter schema.
- Minimal and SQLite package examples.
- Manifest and knowledge authoring guidance.
- Review guidance for installability, operability, and secret safety.

Runtime SDKs, CLIs, templates, and app examples should consume these contracts
instead of maintaining parallel manifest definitions.
