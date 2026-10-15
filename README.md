# PM Local

A local-only API client that looks and works like the Postman desktop app — no account, no cloud,
no AI. Collections live as plain JSON files in a folder you choose, so they can be versioned with git.

Design: [`docs/superpowers/specs/2026-10-15-pm-local-design.md`](docs/superpowers/specs/2026-10-15-pm-local-design.md)

## Run it

Requires Node.js 24.

```sh
npm install
npm start
```

`npm start` builds the app and opens it. For development with hot reload use `npm run dev`.

### On a company network (Nexus, proxy)

`npm install` downloads packages from your npm registry and the Electron runtime (~100 MB) from GitHub.
If GitHub is blocked, point both at your mirror before installing:

```sh
npm config set registry https://<nexus-host>/repository/<npm-group>/
# Windows (PowerShell):  $env:ELECTRON_MIRROR = "https://<nexus-host>/repository/<electron-raw>/"
# macOS/Linux:           export ELECTRON_MIRROR=https://<nexus-host>/repository/<electron-raw>/
npm install
```

If Electron did not download (the app fails with "Electron failed to install correctly"), run
`node node_modules/electron/install.js`.

## Workspace layout

```
<workspace>/
  workspace.json
  collections/<Collection>/collection.json
  collections/<Collection>/<Folder>/folder.json
  collections/<Collection>/<Folder>/<Request>.request.json   # one Postman v2.1 item each
  .pmlocal/                                                  # local-only state, git-ignored
```

## Tests

```sh
npm run typecheck
npm test            # unit + integration (Vitest)
npm run test:e2e    # drives the real Electron app (Playwright)
```

## Status

M1 done: workspace folders, collections/folders/requests tree, request tabs, method/URL/headers/raw
body, send via `postman-runtime` in a separate engine process, response viewer (pretty/raw/headers).
Next: M2 — auth, all body types, scripts/tests, environments/variables, cookies, console, history,
import/export, corporate proxy and certificates.
