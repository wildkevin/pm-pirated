# Postman settings comparison

Compared against the installed Postman 12.32.3 Settings dialog. PM Local now uses its left navigation layout, with General, Themes, Shortcuts, Data, Certificates, Proxy, and About pages. Settings save immediately and apply without restarting.

## Preserved local settings

| Section | Controls and behavior |
| --- | --- |
| Request | Auto / HTTP 1.x / HTTP 2, timeout, maximum response size, SSL verification, TLS session key logging, disable cookie jar, Auto / JSON response detection |
| Working directory | Choose a directory, reset to workspace folder, allow/disallow files outside it; relative body file paths resolve against the selected directory |
| Headers | Implicit no-cache and Postman Token headers, follow redirects |
| Interface | Always open sidebar items in new tabs, confirm dirty tab closure, tab icons, request/response side-by-side, middle workbench visibility, swap sidebars, variable autocomplete |
| Editor | Font family, size, indentation count and Space / Tab, independent bracket and quote completion, reset; body beautification uses the selected indentation |
| Application | Request autosave; named requests save after editing, before closing, and before workspace changes/application exit; unnamed requests still need Save As |
| Themes | Manual or system sync, separate day/night choices; Light, High Contrast Light, Ayu Light, Night Owl Light, Solarized Light, Dark, High Contrast Dark, Ayu Dark, Dracula, Monokai, Night Owl Dark, Solarized Dark |
| Shortcuts | Enable/disable app shortcuts, restore defaults, list of implemented shortcuts including tab navigation, force close, layout switches, save/send/search |
| Certificates | Custom CA toggle/file and per-host client certificates, plus existing operating-system certificate trust |
| Proxy | System proxy, proxy environment variables, system proxy authentication, custom HTTP/HTTPS proxy, bypass and authentication |
| Data | Existing Postman collection/environment/global/cURL import; collection and environment export from Settings |

The theme names and palette choices are preserved; alternative palettes are local implementations rather than copies of Postman's theme assets. Editor syntax, selection, tooltips, app surfaces, and native controls follow the selected palette.

## Current user's values

Applied to the local app's settings file, with a timestamped backup next to it. Personal paths and credentials are not repository defaults.

- Request: Auto, 0 ms timeout, 50 MB, SSL verification off, TLS logging off, cookie jar enabled, Auto response detection.
- Headers: no-cache on, Postman Token on, redirects on.
- Working directory: the user's existing Postman files directory; access outside it off.
- Interface: new-tab preference off, close confirmation on, icons on, two-pane off, middle workbench on, sidebar swap off, variable autocomplete on.
- Editor: original `IBMPlexMono, Monaco, 'Courier New', monospace` family, 12 px, four spaces, bracket and quote completion on. The bundled font also registers the original `IBMPlexMono` family name.
- Themes: system sync, Light by day, Dark by night.
- Autosave off; keyboard shortcuts on.
- System proxy and proxy environment variables on; authentication and custom proxy off.
- Custom CA off; no client certificates.

New installations retain SSL verification on. Existing settings files gain the new fields without resetting previously saved settings. Encrypted proxy passwords and certificate passphrases retain the existing encrypted storage path.

## Remaining differences

PM Local deliberately has no Postman account, cloud sync, AI, add-ons marketplace, web-to-desktop handoff, telemetry, cloud notification badge, or Postman self-updater.

Other differences are explicit: documentation currently uses the existing text/Markdown editor rather than Postman's rich-text editor; response links do not have Postman's open-link/retain-request-headers behavior; language is English; shortcuts are fixed rather than individually remappable; Data exports individual collections/environments rather than a complete Scratch Pad dump. These controls are not presented as working preferences. The current original values for these items were recorded in the local comparison notes.

TLS keys, when enabled, are appended to `logs/tls-keys.log` under PM Local's app-data directory; the file is created with owner-only permissions on systems that support them. Disabling logging stops new writes and does not delete existing logs.

## Validation

Automated checks cover settings migration and malformed editor/theme values, encrypted persistence, actual HTTP/2 negotiation and HTTP/1 forcing, TLS key logging, disabled cookies/no-cache headers, working-directory file boundaries, theme switching/restart persistence, font/indent/quote/bracket behavior, variable completion, autosave, tab preferences, side-by-side layout, sidebar swapping, existing settings keyboard navigation, proxy/certificate controls, and the broader app regression suite.
