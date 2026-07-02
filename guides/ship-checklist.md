# From Manifest to Running App

This checklist connects the app package contract in this repo to a deployed app.
It assumes the target architecture in
[Build TinyCloud Mini Apps](build-mini-apps.md).

## 1. Validate the contract

Author the manifest and knowledge bundle, then validate them:

```bash
npm run lint
```

The linter checks manifest JSON, `knowledge` pointers, and SQL migration
capabilities. Fix every error before moving on.

## 2. Scaffold and implement

Use [`tinyboilerplate`](https://github.com/TinyCloudLabs/tinyboilerplate) for a
runnable starter, scaffold command, and full-stack example:

```bash
bun install
bun run build
bun run generate-key
bun run dev:app-starter
```

Implement the frontend, backend, and agent behavior your manifest declares.

## 3. Verify locally

Working locally is sufficient to prove the app before deploying:

- Sign in with [openkey.so](https://openkey.so).
- Grant the delegation the frontend requests.
- Probe app data to confirm reads and writes go through delegated TinyCloud
  access.

## 4. Deploy

Blessed deployment targets:

- **Frontend** → Cloudflare Pages.
- **Backend** → Phala (TEE), so attestation can prove what it runs.
- Apps use the **canonical TinyCloud host**, not self-run nodes.

See tinyboilerplate's
[`DEPLOYMENT.md`](https://github.com/TinyCloudLabs/tinyboilerplate/blob/main/DEPLOYMENT.md)
for the deploy steps and production environment details.
