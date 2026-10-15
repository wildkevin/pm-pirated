# PM Local — design spec

Date: 2026-10-15
Status: approved in conversation, awaiting written-spec review

## 1. Goal

A local-only desktop API client for the user's Windows company laptop that looks and behaves very
much like the Postman desktop app (reference: Postman 12.32.3 for macOS, statically analysed on
2026-10-15), minus everything cloud-related.

- **For whom:** the user, for daily API work, as a replacement for Postman.
- **Success:** the user's existing Postman v2.1 collections import, look familiar, and run with the
  same results as in Postman — on a corporate network, without admin rights.
- **Working name:** "PM Local" (window title, app-data folder `%APPDATA%/pm-local`). Repo:
  `wildkevin/pm-pirated` (private).

### Out of scope (permanently)

Accounts/login, cloud sync, workspaces-in-the-cloud, teams, Postman Vault cloud integrations,
AI (Postbot, Agent Mode, LLM requests), MCP (client and servers), Flows, monitors, API
governance, telemetry/analytics/crash reporting, auto-update, installers (MSI/NSIS setup), code signing,
`pm.require` cloud packages, plugin auto-install.

### Deferred (later versions, not v1)

WebSocket, Socket.IO, gRPC, MQTT, SSE request types; GraphQL schema introspection UI; OpenAPI
import; Interceptor browser extension; browser-tab recorder.

## 2. Reference findings that shape the design

From static analysis of the shipped `app.asar` (563 files, integrity-verified):

- Postman's main UI is **not** in the install — it is loaded from `https://desktop.postman.com`.
  The offline "Scratch Pad" UI bundle (`js/scratchpad/`) is local and carries the design tokens.
- The request engine is open source (Apache-2.0) and reusable unchanged: `postman-runtime`
  (7.56.1 shipped), `postman-collection`, `postman-sandbox`, `postman-request`,
  `postman-code-generators`.
- Postman's own app code (minified main process, UI bundles, icon sprite, logo) is proprietary:
  used **only** as a behavioural/visual reference, never copied.
- Weaknesses deliberately not reproduced: Node-enabled renderer with `contextIsolation:false`
  and `@electron/remote`; local servers listening on all interfaces; unauthenticated localhost
  services; always-on remote debugging port.

## 3. Constraints

- **Runs on a Windows company laptop:** corporate HTTP proxy (possibly PAC), custom corporate
  root CAs, no admin rights, npm packages via the company Nexus mirror.
- **Development and early use: `npm install` + `npm start`.** End state (M7): a portable Windows
  `PM Local.exe` that runs on double-click with nothing installed — electron-builder `portable`
  target (single self-extracting exe) plus a zipped unpacked folder (`win-unpacked`, instant start;
  fallback if policy blocks executables extracted to temp). Built on GitHub Actions
  `windows-latest` and published as workflow artifacts. Unsigned; no installer, no auto-update.
  App data stays in `%APPDATA%/pm-local` (DPAPI-encrypted secrets are bound to the Windows user).
- **No native Node modules** (nothing needing node-gyp/prebuild downloads). All dependencies must
  be pure JS/WASM and resolvable from Nexus.
- **Electron binary download:** `npm install` downloads Electron from GitHub by default; the
  README documents `ELECTRON_MIRROR` (and `.npmrc` registry) settings for Nexus.
- Development happens on macOS; tests also run on `windows-latest` in GitHub Actions.

## 4. Architecture

Stack: Electron + TypeScript + React. Electron, React and all libraries are pinned at the start
of M1 to the then-current stable versions; Node APIs used must work on the Node bundled with that
Electron.

```
Renderer (React)  — sandbox:true, contextIsolation:true, nodeIntegration:false
   │  window.api  (one contextBridge object; typed, allowlisted channels only)
Main process      — workspace store, settings, secrets (safeStorage/DPAPI), file watcher,
   │                proxy/CA discovery, child-process supervision
   ├─ utilityProcess: engine      — postman-runtime: send, Collection Runner, scripts
   ├─ utilityProcess: load-test   — worker threads, one runtime run per virtual user
   ├─ utilityProcess: mocks       — all mock servers
   └─ utilityProcess: proxy       — capture proxy (HTTP + HTTPS interception)
```

### 4.1 Units and interfaces

| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/ipc-contract` | TypeScript types + channel names for every renderer↔main and main↔child message | — |
| `main/workspace` | read/write/watch workspace folders; split/join v2.1 collections | `shared/format` |
| `shared/format` | pure functions: folder tree ⇄ v2.1 collection; stable JSON serialisation | `postman-collection` |
| `main/secrets` | encrypt/decrypt secret variable values via `safeStorage` | Electron |
| `main/netconfig` | system proxy resolution (`session.resolveProxy`), Windows root CAs, user overrides | Electron, `node:tls` |
| `main/supervisor` | start/stop/restart child processes, crash notices | Electron `utilityProcess` |
| `engine/*` | build runtime options, run single request or collection, stream events | `postman-runtime`, `postman-sandbox` |
| `mocks/*` | route matching, response rendering, request log | `postman-collection`, `node:http` |
| `proxy/*` | CONNECT handling, certificate minting, recording | `node-forge`, `node:http(s)`, `node:net` |
| `loadtest/*` | load-shape scheduler, VU workers, metrics aggregation | `postman-runtime`, `worker_threads` |
| `renderer/*` | all UI | React, Monaco, `window.api` |

The renderer never touches the filesystem or network directly. Every IPC handler validates its
payload (zod schemas from `shared/ipc-contract`) and checks the sender frame is the app's own
window.

### 4.2 Network configuration (corporate)

For each request the engine receives an effective config computed by `main/netconfig`:
1. Per-request/collection overrides (proxy, client certificates, CA file, SSL verification).
2. App Settings → Proxy (custom proxy URL, credentials, bypass list) if set.
3. Otherwise the system proxy for that URL from `session.resolveProxy` (handles PAC/WPAD).
4. Trusted CAs = Node bundled roots + Windows certificate store (`tls.getCACertificates('system')`,
   available in the Node bundled with current Electron) + optional user CA file.

## 5. Workspace on disk

A workspace is a folder the user opens (recent workspaces remembered).

```
<workspace>/
  workspace.json                     # { "name", "formatVersion": 1 }
  collections/<Collection name>/
    collection.json                  # v2.1 collection minus `item`, plus "order": [...]
    <Folder>/folder.json             # v2.1 folder minus `item`, plus "order": [...]
    <Folder>/<Name>.request.json     # one v2.1 item (request, event scripts, responses)
  environments/<Name>.env.json       # v2.1 environment format
  mocks/<Name>.mock.json             # mock server definitions (section 8)
  globals.json
  .pmlocal/                          # created with its own .gitignore ("*")
    state.json                       # open tabs, layout, selected env
    current-values.json              # current values of non-secret variables
    history.ndjson                   # capped, default 1000 entries
    cookies.json
    runs/<timestamp>-<name>.json     # Collection Runner results
    perf/<timestamp>-<name>.ndjson   # load-test samples + summary
```

- File/folder names are sanitised from item names (Windows-reserved chars and names replaced,
  length capped at 100 chars); the real name lives inside the JSON, and collisions get ` (2)`.
- JSON written with 2-space indent, stable key order, LF newlines, trailing newline.
- All writes are atomic: write `*.tmp` in the same directory, then rename.
- **Secrets:** variables of type `secret` are saved with `"value": ""`. Real values are stored
  in `%APPDATA%/pm-local/secrets.json`, each value encrypted with `safeStorage`, keyed by
  `<workspace absolute path>::<scope>::<variable key>`.
- **Initial vs current values:** files hold initial values (shareable); current values live in
  `.pmlocal/current-values.json`. The runtime uses current when present, else initial.
- **External changes:** a watcher (`fs.watch` recursive, which is supported on Windows) reloads
  changed files. If the changed request has unsaved edits in a tab, the user chooses "keep mine"
  or "load theirs". Malformed files show a red badge with the JSON error and are never rewritten
  automatically.
- **Import:** Postman v2.1 collection/environment/globals files, and cURL commands → written into
  the folder layout. **Export:** join back into a single v2.1 file. Round-trip import→export must
  produce an equivalent collection (verified by tests on real exports).

## 6. Core client (M1–M2)

### 6.1 Layout (visual parity with Postman)

- Dark header bar; left icon rail (Collections, Environments, History, Mock servers, Proxy, Load
  tests); resizable sidebar tree; request tabs strip (drag to reorder, unsaved dot, close
  confirmation); request editor over response pane, toggle to side-by-side; bottom status bar
  (Console, Cookies, Runner); environment selector + quick-look "eye" at top right.
- Visual tokens taken from measurements of Postman's Scratch Pad CSS and reference captures:
  base text 12px, control height 32px, radius 4px, background `#FFFFFF`/`#F7F7F7`/`#EBEBEB`,
  content `#1A1A1A`/`#666666`/`#999999`, header `#262626`, brand highlight `#FF4F0F`. Fonts:
  Inter (UI) and IBM Plex Mono (code), both OFL, bundled. Light and dark themes.
- Icons from an open-licence set chosen for a similar look; own app icon. No Postman assets.
- Reference captures: at M1 start, with the user's OK, screenshots/layout of the running
  Postman (sidebar, request builder, response, environments, runner, console) are captured via
  its local remote-debugging port and stored in `docs/reference/` (git-ignored if they contain
  personal data).

### 6.2 Request builder

- Method selector (standard verbs + custom), URL bar with `{{var}}` highlighting and
  hover-to-show value, unresolved variables shown in red.
- Tabs: Params (two-way sync with URL, path variables), Authorization, Headers (auto-generated
  headers shown read-only, hideable), Body, Scripts (Pre-request, Post-response), Settings
  (SSL verification, redirects, timeout, encode URL, strip auth on redirect, etc. — the
  `protocolProfileBehavior` options).
- Body: none, form-data (text + file), x-www-form-urlencoded, raw (JSON/XML/Text/HTML/JS with
  beautify), binary (file), GraphQL (query + variables, sent as HTTP POST).
- Auth: all `postman-runtime` authorizers — noauth, inherit, apikey, basic, bearer, digest,
  oauth1, oauth2, hawk, aws4 (SigV4), ntlm, edgegrid, jwt, asap. OAuth 2.0 "Get New Access
  Token" supports authorization code (+PKCE), implicit, client credentials, password grants; the
  browser-based grants open a dedicated `BrowserWindow` (own partition, no preload) and capture
  the redirect. Tokens are stored per collection as secrets.
- Scripts: Monaco editor with `pm.*` type definitions and Postman-style snippet list; executed
  by `postman-sandbox` in the engine process; `console.*` goes to the app Console.

### 6.3 Response pane

Status, time (hover: DNS/TCP/TLS/TTFB/download breakdown from runtime timings), size; Body
(Pretty with JSON/XML/HTML formatting and folding, Raw, Preview in sandboxed iframe, Visualize
for `pm.visualizer`); Headers; Cookies; Test Results with pass/fail filter. Actions: save as
example, save body to file, search in body, copy.

### 6.4 Variables, cookies, console, history

- Scopes: globals, collection, environment, data, local — resolved by `postman-runtime`
  (local > data > environment > collection > globals). Dynamic variables (`{{$guid}}` etc.)
  supported via `postman-collection`.
- Cookie jar persisted per workspace; Cookies manager dialog (view/edit/delete per domain).
- Console: every executed request as sent (resolved URL, headers, body), response summary,
  script `console.*` output, network errors; filter and clear.
- History: grouped by day, search, click to open in a new tab, clear.

## 7. Collection Runner and code snippets (M3)

- Runner config: collection or folder, environment, request selection and order, iterations,
  delay, data file (CSV/JSON), persist responses, stop on error, keep variable values.
- Live results per iteration/request with test pass/fail, filter, request/response detail.
- Results saved to `.pmlocal/runs/`, exportable as JSON. Run can be stopped mid-way.
- Code snippets: `postman-code-generators` for at least cURL, PowerShell (RestMethod),
  Python (requests), C# (HttpClient), JavaScript (fetch, axios), Node (axios), Java (OkHttp),
  Go (native), with the library's per-language options.

## 8. Mock servers (M4)

- A mock is defined per collection (or folder): name, port, bind address (`127.0.0.1` default;
  `0.0.0.0` only via an explicit "Allow LAN access" toggle), delay, auto-start on workspace open.
  Mock definitions saved in `<workspace>/mocks/<name>.mock.json`.
- Responses come from saved examples. Matching (Postman-like):
  1. Method + path; `{{var}}` and `:param` path segments act as wildcards.
  2. Highest score on query params, then headers/body if the example defines them.
  3. Headers `x-mock-response-name` / `x-mock-response-code` force a specific example.
- Response bodies resolve dynamic variables. Live request log shows the matched example and the
  reason; unmatched requests return 404 with an explanation.
- All mocks run in one child process; editing examples hot-reloads routes.

## 9. Capture proxy (M5)

- Listens on `127.0.0.1:<port>` (default 5555). HTTP forwarded; HTTPS `CONNECT` either tunnelled
  (host-only record) or intercepted when "Decrypt HTTPS" is on.
- Interception: app root CA (RSA 2048, SHA-256, `node-forge`) stored in
  `%APPDATA%/pm-local/proxy/`; per-host leaf certificates minted on demand and cached.
- "Trust certificate": `certutil -user -addstore Root <ca.crt>` (no admin; Windows shows its
  own confirmation). "Remove certificate": `certutil -user -delstore Root <thumbprint>`.
- "Set as system proxy": saves current HKCU `Internet Settings` values (`ProxyEnable`,
  `ProxyServer`, `ProxyOverride`, `AutoConfigURL`) to a marker file, then points them at the
  capture proxy (via `reg.exe`). Restored on stop/quit; a leftover marker file at next launch
  triggers restore. The previous corporate proxy becomes the capture proxy's upstream.
- Filters: host include/exclude, path pattern, methods. Destination: History or a chosen
  collection folder.
- If decryption fails (certificate not trusted, blocked by corporate policy, pinning), the
  session list shows the reason; traffic continues as tunnel.

## 10. Load testing (M6)

- Config: collection/folder, environment, virtual users (VUs), duration, load profile — fixed,
  ramp-up, spike, peak — with a preview graph; optional data file.
- Execution: separate `utilityProcess`; VUs run on `worker_threads` (pool sized to CPU count),
  each VU loops a `postman-runtime` run with its own cookie jar.
- Metrics every second: requests/s, response time avg/p90/p95/p99, error rate; per-request
  table. Samples streamed to `.pmlocal/perf/*.ndjson`; summary saved at the end; compare two runs.
- Guardrails: warn at 75% process CPU, stop adding VUs at 95%; hard cap on VUs (default 100,
  configurable).

## 11. Error handling

- Network errors (DNS, timeout, TLS, proxy 407/refused) shown in the response pane with cause and
  a hint (e.g. "certificate not trusted — corporate CA? Settings → Certificates").
- Child-process crash → supervisor restarts it and shows a notice; in-flight work is marked
  failed, never silently retried.
- Atomic writes; malformed files never overwritten; unsaved tab content kept in
  `.pmlocal/state.json` so a crash loses at most a few seconds of typing.
- Logs: rotating files in `%APPDATA%/pm-local/logs`. Nothing is sent off the machine.

## 12. Testing

- **Unit (Vitest):** format split/join round-trip (including real Postman exports in
  `test/fixtures`), filename sanitising, variable/secret handling, mock matching, certificate
  minting, load-profile math, IPC payload validation.
- **Integration (Vitest):** engine process against a local test server — each auth type, body
  types, cookies, redirects, client certificates, proxy chaining, script tests; runner with data
  files; mocks; capture proxy end-to-end.
- **E2E (Playwright `_electron`):** open workspace, send request, save, import cURL, run
  collection.
- **Visual parity:** manual side-by-side review against reference captures at each milestone.
- **CI:** GitHub Actions on `windows-latest` and `macos-latest` runs lint, typecheck, unit,
  integration, E2E.

## 13. Milestones

Each milestone is usable on its own and gets its own implementation plan.

| # | Delivers |
|---|---|
| M1 | Electron shell + security baseline + look-alike layout, open/create workspace, collections tree, send HTTP request with basic body/headers, response viewer |
| M2 | Full request builder (all auth, bodies, settings), scripts/tests, environments/globals/variables, secrets, cookies, console, history, import/export (v2.1 + cURL), corporate proxy/CA support |
| M3 | Collection Runner, code snippets |
| M4 | Mock servers |
| M5 | Capture proxy |
| M6 | Load testing |
| M7 | Portable `PM Local.exe` + zipped folder built in CI; hardening and polish on the Windows laptop: Nexus/ELECTRON_MIRROR install guide, proxy/CA edge cases, keyboard shortcuts, performance with large collections |
