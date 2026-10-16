# PM Local

A local-only API client that looks and works like the Postman desktop app — no account, no cloud,
no AI. Collections live as plain JSON files in a folder you choose, so you can keep them in git.

Design: [`docs/superpowers/specs/2026-10-15-pm-local-design.md`](docs/superpowers/specs/2026-10-15-pm-local-design.md) ·
Visual reference: [`docs/reference/README.md`](docs/reference/README.md)

## Get it on Windows

**Portable app (no install, no admin):** open the latest successful
[CI run](https://github.com/wildkevin/pm-pirated/actions) → *Artifacts* → **PM-Local-windows**. It contains:

- `PM-Local-<version>-portable.exe` — a single file; double-click to run (it unpacks itself to a temp
  folder, so the first start takes a few seconds).
- `PM-Local-<version>-win-x64.zip` — unzip anywhere and run `PM Local.exe`; starts instantly. Use this if
  your company blocks programs that run from the temp folder.

On Windows, closing the window keeps PM Local running in the system tray. Click its tray icon,
choose **Show PM Local**, or open the exe again to restore your window and drafts. Choose **Exit**
from the tray menu to quit and stop background requests, mocks, and capture.

Windows SmartScreen may warn because the app is not code-signed: *More info* → *Run anyway*.

**From source:** requires Node.js 24.

```sh
npm install
npm start            # builds and opens the app
npm run dev          # development with hot reload
npm run dist:win     # build the portable exe + zip into dist/ (on Windows)
```

### On a company network (Nexus, proxy)

`npm install` downloads packages from your npm registry and the Electron runtime (~100 MB) from GitHub.
If GitHub is blocked, point both at your mirror first:

```sh
npm config set registry https://<nexus-host>/repository/<npm-group>/
# PowerShell:   $env:ELECTRON_MIRROR = "https://<nexus-host>/repository/<electron-raw>/"
npm install
```

If Electron did not download ("Electron failed to install correctly"), run `node node_modules/electron/install.js`.

In the app, **Settings → Proxy** uses the Windows proxy (including PAC files) by default, and
**Settings → Certificates** trusts the Windows certificate store, so corporate root certificates work.

## What it does

| Area | Features |
|---|---|
| Requests | Tabs (with unsaved drafts restored after restart), method/URL with `{{variable}}` highlighting, Params ⇄ URL sync, path variables, headers (bulk edit), bodies (raw JSON/XML/HTML/Text/JS, form-data with files, urlencoded, binary, GraphQL), per-request settings |
| Auth | Inherit, No Auth, Basic, Bearer, JWT, Digest, OAuth 1.0, OAuth 2.0 (“Get New Access Token”: auth code, PKCE, implicit, password, client credentials), Hawk, AWS SigV4, NTLM, API Key, Akamai EdgeGrid, ASAP |
| Scripts | Pre-request and Tests scripts (`pm.*` API, Postman's sandbox and snippets) on requests, folders and collections; Test Results; Console |
| Variables | Globals, environments (with active-environment quick look), collection variables, initial vs current values, secret values (encrypted with Windows DPAPI, never written to the workspace) |
| Responses | Pretty/Raw/Preview, headers, cookies, test results, save to file, save as example |
| Organise | Collections & folders (auth/scripts/variables per collection), history, cookies manager, import (Postman v2.0/2.1 collections, environments, globals, cURL — also by pasting cURL into the URL bar), export (v2.1), code snippets (cURL, PowerShell, Python, C#, JS, Go, Java, …) |
| Collection Runner | Collections or folders, iterations, CSV/JSON data files, delay, stop on error, live results, saved runs (credentials redacted), export |
| Mock servers | Serve saved examples on `127.0.0.1:<port>` with Postman-like matching, dynamic variables, delay, request log; LAN access and CORS are opt-in |
| Capture | HTTP(S) capture proxy on `127.0.0.1`; optional HTTPS decryption with a per-user trusted PM Local CA; Windows system-proxy switch (restored on stop/quit/crash); captured requests to History or a collection |
| Performance | Virtual users with fixed / ramp-up / spike / peak profiles, live throughput and latency percentiles, per-request stats, saved results |

Not included, by design: accounts, sync, sharing, AI, MCP, monitors, auto-update.

## Where things are stored

```
<workspace>/                     ← the folder you open (put it in git)
  workspace.json
  collections/<Collection>/collection.json
  collections/<Collection>/<Folder>/folder.json
  collections/<Collection>/<Folder>/<Request>.request.json   # one Postman v2.1 item each
  environments/<Name>.env.json   globals.json                # initial values only
  mocks/<Name>.mock.json
  .pmlocal/                      ← local only, git-ignored: current values, history, cookies,
                                   open tabs, runner and performance results
%APPDATA%\pm-local\              ← settings, encrypted secrets, capture CA (key encrypted)
```

## Security notes

- The window has no Node.js access; it talks to the app through a fixed, validated list of calls.
- Requests cannot read files outside the workspace unless you allow it in Settings (like Postman), so a
  shared collection cannot upload files from elsewhere on your computer.
- Local servers (mocks, capture proxy) listen on 127.0.0.1 unless you explicitly allow LAN access.

## Tests

```sh
npm run typecheck
npm test            # unit + integration (Vitest)
npm run test:e2e    # drives the real Electron app (Playwright)
PM_LOCAL_EXE="dist/win-unpacked/PM Local.exe" npx playwright test e2e/packaged.spec.ts   # packaged app
PM_LOCAL_GALLERY=1 npx playwright test e2e/gallery.spec.ts   # screenshots of every screen → docs/screenshots/ (not committed)
```
