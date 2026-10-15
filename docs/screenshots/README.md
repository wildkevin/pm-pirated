# PM Local — every screen

Captured from the real app with a made-up sample workspace ("Payments Team", 1440×900).
Regenerate with `PM_LOCAL_GALLERY=1 npx playwright test e2e/gallery.spec.ts` after `npm run build`.
Compare with Postman's own local mode in [`../reference/README.md`](../reference/README.md).

## Requests

**Welcome** — a workspace is a folder you choose.
![Welcome](01-welcome.png)

**Request and response** — `{{variables}}` in green when defined (red when not), sub-tabs with counts, pretty JSON with folding, status/time/size.
![Request and response](02-request-and-response.png)

**Tests script** — JavaScript editor with `pm.*` autocomplete and Postman's snippet list.
![Tests script](03-tests-script-with-snippets.png)

**Test results** — PASS/FAIL per test with the assertion message.
![Test results](04-test-results.png)

**POST with a JSON body** — body modes none / form-data / x-www-form-urlencoded / raw / binary / GraphQL.
![POST with JSON body](07-post-with-json-body.png)

**OAuth 2.0** — "Configure New Token" and "Get New Access Token".
![OAuth 2.0](08-auth-oauth2.png)

**Per-request settings** — SSL verification, redirects and more, each with its app default.
![Request settings](09-request-settings.png)

**Code snippet** — the `</>` panel: cURL, PowerShell, Python, C#, JavaScript, Go, Java, …
![Code snippet](11-code-snippet.png)

**Console** — every request as actually sent, with headers/bodies and script `console.log` output.
![Console](12-console.png)

## Variables and organisation

**Environment editor** — Variable · Type (default/secret) · Initial value · Current value.
![Environment editor](05-environment-editor.png)

**Environment quick look** — the eye button next to the environment picker.
![Quick look](10-environment-quick-look.png)

**Collection settings** — Overview, Authorization (inherited by every request), scripts and variables.
![Collection settings](06-collection-settings-auth.png)

**History** — grouped by day, filterable; click to reopen as a new tab.
![History](13-history.png)

**Import** — paste cURL or Postman JSON, or choose files.
![Import](14-import.png)

**Save a draft request** — choose the collection or folder.
![Save request](19-save-request-draft.png)

**Cookies** — per-domain cookie jar, editable.
![Cookies](18-cookies.png)

## Settings

![Settings: General](15-settings-general.png)
![Settings: Proxy](16-settings-proxy.png)
![Settings: Certificates](17-settings-certificates.png)

## Tools

**Collection Runner** — iterations driven by a CSV data file; live results per request with tests.
![Collection Runner](20-collection-runner.png)

**Create a mock server** — serves the collection's saved examples.
![Create mock server](21-create-mock-server.png)

**Mock server** — URL, settings, examples served and a live request log (matched / unmatched).
![Mock server](22-mock-server.png)

**Capture proxy** — record traffic through `127.0.0.1:<port>`; details, open in tab, save to a collection.
![Capture proxy](23-capture-proxy.png)

**Performance test** — ramp-up profile, live throughput and latency percentiles, per-request table.
![Performance test](24-performance-test.png)
