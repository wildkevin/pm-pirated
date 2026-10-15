# QA remediation — October 2026

The first review confirmed 87 findings: 2 critical, 16 major, 55 minor and 14 cosmetic. The changes below address those findings. WS-9 and the other unconfirmed report entry were not included in that total. Original reproduction scripts, screenshots and review notes remain in the ignored local `.qa/` directory.

| Findings | Resulting behavior |
| --- | --- |
| VAR-1, RUN-1 | Atomic, serialized current-value writes preserve changes across scopes and concurrent requests/runs; corrupted-file backups reject symlinks. |
| VAR-2 | Duplicate variable names produce an error before any values are overwritten. |
| VAR-3, VAR-4, VAR-6 | Pre-request failures stop sending; Console retains the main response and displays script logs and subrequests in event order. |
| VAR-5 | All variable scopes remain visible, with overridden values identified. |
| VAR-7, REQ-15 | Request subtabs expose horizontal scrolling; active document tabs remain visible after resizing. |
| WS-1, WS-2 | Workspace transitions and shutdown flush queued state; drafts, open tabs and favorites survive fast switches. |
| WS-3 | Open-tabs search preserves distinct entries with duplicate titles. |
| WS-4, WS-6 | Workspace location preview uses the actual sanitized, unique directory name; existing-folder name mismatches explain how to proceed. |
| WS-5, UI-1, UI-2, UI-3 | Pane widths adapt to the viewport, narrow side panels use overlays, and zoom/reset preserves a usable editor and new-tab control. |
| WS-7, WS-10, UI-11, UI-12, UI-14 | Tree, menus, History and Console support keyboard navigation; Back/Escape leave workspace pages; new tabs focus the URL. |
| WS-8, REQ-14 | Closing dirty tabs offers Save, Don't save and Cancel, including Save As for drafts and ordered multi-tab closure. |
| WS-11 | Missing workspace folders remain listed and startup explains why the last workspace could not open. |
| RUN-2, RUN-7, RUN-8 | Runner/performance layouts stack at narrow widths; metrics stay readable and result URLs wrap. |
| RUN-3, RUN-4, RUN-5, RUN-10 | Errors stop the entire run when requested, summaries count errors and completed iterations accurately, and newly completed runs can be exported. |
| RUN-6, RUN-11, RUN-12, RUN-13 | Numeric fields accept replacement text with bounded integer validation; empty data files fail early and failed starts clear placeholder results. |
| RUN-9 | Every virtual user cycles through all data rows. |
| RUN-14, RUN-15 | Performance history identifies profile/duration, charts identify peak VUs, and target names/counts avoid redundant prefixes and grammar errors. |
| MOCK-1, MOCK-10 | CORS reaches the mock process; preflight and forbidden-host requests appear in logs. |
| MOCK-2, MOCK-11, MOCK-13 | Capture forwarding preserves raw paths; URL templates open literally, header/body substitution requires explicit confirmation, and skipped history saves explain why. |
| MOCK-3, MOCK-12 | Narrow mock/capture views stack panels and retain readable paths and log details. |
| MOCK-4, MOCK-5 | Invalid mock ports receive inline validation; running mocks reserve their port across local/LAN bind addresses. |
| MOCK-6, MOCK-8 | Mock drafts survive tab switches, support keyboard save and dirty-close protection; dialog labels target unique input IDs. |
| MOCK-7 | LAN mocks display an external IPv4 address alongside the existing network-access disclosure. |
| MOCK-9 | Deleting a target collection or folder stops its running mock and reports the missing target. |
| REQ-1, REQ-2 | Custom HTTP methods and pasted cURL Basic credentials are supported. |
| REQ-3, REQ-4, REQ-5 | Query editing preserves row order, bare flags, empty values and encoded delimiters through send, Runner and import/export. |
| REQ-6 | Bulk editing preserves metadata for duplicate-key occurrences. |
| REQ-7, RES-12 | GET/HEAD bodies send by default; explicit pruning agrees across the engine, Console and snippets. |
| REQ-8, UI-9 | Invalid GraphQL variables and unreadable/disallowed upload files fail visibly before transmission, including values prepared by scripts. |
| REQ-9, REQ-10 | Beautify handles XML/HTML and reports malformed content; Disable URL encoding changes engine behavior. |
| REQ-11 | Cookie editing and deletion use separate controls. |
| REQ-12, RES-8 | TLS/OAuth errors give desktop-relevant guidance. |
| REQ-13, UI-6 | Settings numeric fields allow blank drafts and enforce valid ranges without concatenating replacement values. |
| RES-1, RES-2 | Trusted-renderer copy actions work and report feedback; generated raw JSON/XML snippets include the effective content type. |
| RES-3, RES-5, RES-6, RES-7 | Response viewing handles Max-Age expiry, images, declared text charsets and body search. |
| RES-4 | Saving examples persists immediately and makes them selectable; downloading a selected example saves that example rather than the current live response. |
| RES-9, RES-10, RES-11 | History identifies method/URL, test filters show counts with current script terminology, and response pane height survives tab changes. |
| UI-4, UI-7 | Modals trap/restore focus; the native app menu uses PM Local branding and avoids conflicting close-window/development shortcuts. |
| UI-5, UI-8, UI-10 | Proxy dependencies are enforced; certificate help is OS-neutral, hosts normalize/validate, and selected certificate files can be cleared. |
| UI-13, UI-15 | Settings use a fixed-height layout with pinned underline tabs; Console docks in the center with copy, menu and expand controls. Console expansion uses an in-app dialog rather than a separate native window. |

## Validation and independent review

- TypeScript check, production build and unit/integration suite pass locally. The final counts are recorded with the release validation below.
- New Electron tests cover response operations, Runner/mock/capture behavior, settings/keyboard behavior, workspace persistence, dirty-tab saves, zoom and narrow layouts. Existing request/import/script tests remain in the suite.
- Independent workspace/navigation/variables/layout review passed eight checks, including actual split-pane dragging and visual inspection at multiple zoom levels.
- Independent code review identified three additional defects: encoded query export, saved-example downloads and deleted mock folders. All were fixed with regressions. A subsequent import/export round-trip regression also covers enabling encoded disabled query rows.
- Two transient failures occurred during an earlier local full Electron run. Both affected tests passed three isolated repetitions; the final coordinated suite result is recorded below.
- Screenshot comparison was targeted to affected layouts, not a claim of exhaustive pixel equality with Postman. The repository CI runs Windows/macOS checks and a packaged Windows process smoke test.

## Local release validation

- `npm test`: 230 passed, 1 platform-specific skip (25 files).
- `npm run typecheck` and `npm run build`: passed.
- `npx playwright test --reporter=line`: 24 passed, 2 opt-in skips (reference gallery and packaged-app smoke test).
- Integration QA also fixed a startup race: workspace controls now appear after saved tabs have restored, so early edits cannot be overwritten by restoration. A delayed-restore Electron test covers this.
- Windows/macOS CI and portable artifact results are linked from the final delivery.
