# Visual reference: Postman 12.32.3 (macOS), local "Scratch Pad" mode

Captured 2026-10-15 with `node scripts/capture-reference.mjs <label>` (read-only, via Postman's local
remote-debugging port). Screenshots + raw layout JSON are in `docs/reference/private/` (git-ignored:
they can contain personal data). Measurements below are CSS px at a 1280×800 window.

## Layout

| Region | Size / style |
|---|---|
| App header | 48px, white; nav buttons 32px high; settings gear 32×32 |
| Sidebar | `#F9F9F9` background; title row 40px, `#F9F9F9`, bottom border 1px `#EDEDED`; title 12px/600 |
| Sidebar header buttons (New, Import) | 24px high, 11px/600, `#EDEDED` background |
| Tab strip | 40px; tab label 11px/400; method label 9px/600; active tab has orange top border; `+` and `…` 32×32 |
| Request title row | 42px; HTTP icon + name 12px/600; "Save" 12px `#6B6B6B` at right |
| URL group | 40px high, 1px border; method box 110px, 12px/600 coloured; URL input placeholder "Enter URL or paste text" |
| Send button | 100×40, `#0265D2`, "Send" 14px/600 white, split chevron |
| Request sub-tabs | 32px row, 24px gaps: Params · Authorization · Headers (n) · Body · Pre-request Script · Tests · Settings; active = orange underline; count in green; "Cookies" link right, 12px/600 `#0265D2` |
| Key/value tables | header row 36px (12px/600 `#6B6B6B`), rows 36px, placeholder `#A6A6A6`, "Bulk Edit" in header |
| Response pane | header 32px "Response" + collapse chevron; empty state "Enter the URL and click Send to get a response" |
| Right context bar | 48px wide (code snippet `</>` icon) |
| Status bar | 24px: sidebar toggle, Console, …; right: layout + help icons |

## Behaviour notes

- Authorization tab: left column "Type" dropdown (default "No Auth"), right side explains the type.
- Body tab: radios none / form-data / x-www-form-urlencoded / raw / binary (GraphQL appears for HTTP
  requests in logged-in mode); none → "This request does not have a body".
- Request Settings tab: HTTP version, SSL verification, follow redirects, follow original method,
  each with "Default: Settings" link.
- Settings → General defaults: timeout 0 (never), max response size 50 MB, SSL verification ON,
  follow redirects ON, Postman-Token header ON, no-cache header OFF.
- Settings → Proxy: "Use the system proxy" ON by default; "Respect HTTP_PROXY, HTTPS_PROXY and
  NO_PROXY environment variables" OFF by default; optional custom proxy (HTTP/HTTPS, host, port,
  auth, bypass list).
- Console: bottom panel with "All Logs" filter, Clear, copy, close; empty state "No logs yet".

## Colours

Grey scale (Scratch Pad CSS): 00 `#FFFFFF`, 05 `#F9F9F9`, 10 `#F2F2F2`, 20 `#EDEDED`, 30 `#E6E6E6`,
40 `#A6A6A6`, 50 `#6B6B6B`, 90 `#212121`. Brand/primary button `#FF6C37`; Send/link `#0265D2`;
GET `#007F31`.
