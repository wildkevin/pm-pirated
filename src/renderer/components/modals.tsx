import { palettes, isDarkTheme } from '../settings'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ClientCert, CookieInfo } from '../../shared/engine'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { ImportResult } from '../../shared/ipc'
import { DEFAULT_SETTINGS, THEMES, normalizeCertificateHost, type AppSettingsData } from '../../shared/settings'
import { cleanError } from '../lib/body'
import { Modal, NumericInput, Toggle } from './common/ui'

// ---------------- Import ----------------

export function ImportModal({ onClose, onImported }: { onClose(): void; onImported(results: ImportResult[]): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<ImportResult[]>) => {
    setError(null)
    try {
      const results = await fn()
      if (results.length) onImported(results)
    } catch (e) {
      setError(cleanError(e))
    }
  }
  return (
    <Modal title="Import" onClose={onClose}>
      <p className="muted">Paste a cURL command or Postman JSON (collection v2.0/v2.1, environment, globals), or choose files.</p>
      <textarea
        aria-label="Import text"
        className="input textarea import-text"
        spellCheck={false}
        placeholder="Paste cURL or raw text"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={() => void run(() => window.api.importFiles())}>
          Choose files
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!text.trim()} onClick={() => void run(async () => [await window.api.importText(text)])}>
          Import
        </button>
      </div>
    </Modal>
  )
}

// ---------------- Save request (drafts) ----------------

export function SaveRequestModal({
  workspace,
  initialName,
  onClose,
  onSave,
  onNewCollection,
}: {
  workspace: WorkspaceInfo
  initialName: string
  onClose(): void
  onSave(parentId: string, name: string): Promise<void>
  onNewCollection(): Promise<string | undefined>
}) {
  const [name, setName] = useState(initialName)
  const [target, setTarget] = useState<string | null>(workspace.collections[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const containers: { id: string; label: string; depth: number }[] = []
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === 'request') continue
      containers.push({ id: n.id, label: n.name, depth })
      walk(n.children ?? [], depth + 1)
    }
  }
  walk(workspace.collections, 0)
  return (
    <Modal
      title="Save request"
      onClose={onClose}
      footer={
        <>
          <button
            className="link-btn"
            onClick={async () => {
              const id = await onNewCollection()
              if (id) setTarget(id)
            }}
          >
            New Collection
          </button>
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!target || !name.trim()}
            onClick={async () => {
              try {
                await onSave(target!, name.trim())
              } catch (e) {
                setError(cleanError(e))
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="save-name">
        Request name
      </label>
      <input id="save-name" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <div className="field-label">Save to</div>
      <div className="save-targets" role="listbox" aria-label="Save to">
        {containers.length === 0 && <div className="muted">Create a collection first.</div>}
        {containers.map((c) => (
          <div
            key={c.id}
            role="option"
            aria-selected={target === c.id}
            className={`save-target${target === c.id ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + c.depth * 16 }}
            onClick={() => setTarget(c.id)}
          >
            {c.label}
          </div>
        ))}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  )
}

// ---------------- Cookies ----------------

export function CookiesModal({ onClose }: { onClose(): void }) {
  const [cookies, setCookies] = useState<CookieInfo[]>([])
  const [domain, setDomain] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [editor, setEditor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = async () => setCookies(await window.api.listCookies())
  useEffect(() => void reload(), [])
  const domains = [...new Set(cookies.map((c) => c.domain))].sort()
  const shown = cookies.filter((c) => c.domain === domain)
  const act = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(cleanError(e))
    }
  }
  return (
    <Modal title="Manage Cookies" onClose={onClose} wide>
      <div className="cookie-add">
        <input className="input" placeholder="Type a domain name" aria-label="Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} />
        <button
          className="btn btn-secondary"
          disabled={!newDomain.trim()}
          onClick={() => {
            setDomain(newDomain.trim())
            setEditor(`Cookie_1=value; Path=/; Domain=${newDomain.trim()};`)
            setNewDomain('')
          }}
        >
          Add domain
        </button>
      </div>
      <div className="cookie-layout">
        <div className="cookie-domains">
          {domains.length === 0 && <div className="muted">No cookies stored.</div>}
          {domains.map((d) => (
            <div key={d} className={`cookie-domain${domain === d ? ' selected' : ''}`} onClick={() => setDomain(d)}>
              <span>{d}</span>
              <span className="muted">{cookies.filter((c) => c.domain === d).length}</span>
              <button className="btn-icon" aria-label={`Delete domain ${d}`} onClick={(e) => (e.stopPropagation(), void act(() => window.api.deleteCookies(d)))}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="cookie-list">
          {domain && (
            <>
              <div className="cookie-chips">
                {shown.map((c) => (
                  <span key={`${c.path}${c.key}`} className="cookie-chip">
                    <button className="cookie-edit" aria-label={`Edit cookie ${c.key}`} onClick={() => setEditor(`${c.key}=${c.value}; Path=${c.path}; Domain=${c.domain};${c.expires ? ` Expires=${c.expires};` : ''}${c.httpOnly ? ' HttpOnly;' : ''}${c.secure ? ' Secure;' : ''}`)}>{c.key}</button>
                    <button className="btn-icon" aria-label={`Delete cookie ${c.key}`} onClick={(e) => (e.stopPropagation(), void act(() => window.api.deleteCookies(c.domain, c.path, c.key)))}>
                      ×
                    </button>
                  </span>
                ))}
                <button className="link-btn" onClick={() => setEditor(`Cookie_${shown.length + 1}=value; Path=/; Domain=${domain};`)}>
                  + Add Cookie
                </button>
              </div>
              {editor !== null && (
                <div className="cookie-editor">
                  <textarea aria-label="Cookie" className="input textarea" spellCheck={false} value={editor} onChange={(e) => setEditor(e.target.value)} />
                  <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => setEditor(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        void act(async () => {
                          const host = domain.replace(/^\./, '')
                          await window.api.setCookie(`https://${host}/`, editor)
                          setEditor(null)
                        })
                      }
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  )
}

// ---------------- Settings ----------------

const settingsTabs = ['general', 'themes', 'shortcuts', 'data', 'certificates', 'proxy', 'about'] as const
type SettingsTab = typeof settingsTabs[number]

export function SettingsModal({ onClose, onSaved, onImport }: { onClose(): void; onSaved(s: AppSettingsData): void; onImport(): void }) {
  const [s, setS] = useState<AppSettingsData | null>(null)
  const [tab, setTab] = useState<SettingsTab>('general')
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const revision = useRef(0)
  useEffect(() => { void window.api.currentWorkspace().then(setWorkspace) }, [])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.api.getSettings().then(setS), [])
  if (!s) return null
  const save = async (next: AppSettingsData) => {
    const version = ++revision.current
    setS(next)
    onSaved(next)
    try {
      await window.api.saveSettings(next)
      if (version === revision.current) setError(null)
    } catch (e) {
      if (version === revision.current) setError(cleanError(e))
    }
  }
  const g = s.general
  const ui = s.ui
  const editor = s.editor
  const setUI = (patch: Partial<typeof ui>) => void save({ ...s, ui: { ...ui, ...patch } })
  const setEditor = (patch: Partial<typeof editor>) => void save({ ...s, editor: { ...editor, ...patch } })
  const px = s.proxy
  const cert = s.certificates
  const setG = (patch: Partial<typeof g>) => void save({ ...s, general: { ...g, ...patch } })
  const setP = (patch: Partial<typeof px>) => void save({ ...s, proxy: { ...px, ...patch } })
  const setC = (patch: Partial<typeof cert>) => void save({ ...s, certificates: { ...cert, ...patch } })
  const pick = async (title: string) => window.api.pickFile(title)

  return (
    <Modal title="SETTINGS" onClose={onClose} wide className="settings-modal">
      <div className="settings-layout">
      <div className="settings-tabs" role="tablist" aria-label="Settings" aria-orientation="vertical">
        {settingsTabs.map((t) => (
          <button key={t} role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} onClick={() => setTab(t)} onKeyDown={(e) => {
            const tabs = settingsTabs
            const index = tabs.indexOf(t)
            const next = ['ArrowRight', 'ArrowDown'].includes(e.key) ? (index + 1) % tabs.length : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
            if (next >= 0) { e.preventDefault(); setTab(tabs[next]); (e.currentTarget.parentElement!.children[next] as HTMLElement).focus() }
          }}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className={`settings-body settings-${tab}`} role="tabpanel" aria-label={tab}>
        <h2 className="settings-page-title">{tab[0].toUpperCase() + tab.slice(1)}</h2>
        {tab === 'general' && (
          <>
            <div className="section-title">Request</div>
            <SettingSelect label="HTTP version" value={g.httpVersion} options={[['auto', 'Auto'], ['http1', 'HTTP/1.x'], ['http2', 'HTTP/2']]} onChange={v => setG({ httpVersion: v as typeof g.httpVersion })} />
            <SettingNumber label="Request timeout in ms" help="Set how long a request should wait for a response before timing out. To never time out, set to 0." value={g.timeoutMs} onChange={(v) => setG({ timeoutMs: v })} />
            <SettingNumber label="Max response size in MB" help="Set the maximum size of a response to download. To download a response of any size, set to 0." value={g.maxResponseSizeMb} onChange={(v) => setG({ maxResponseSizeMb: v })} />
            <SettingToggle label="SSL certificate verification" value={g.sslVerification} onChange={(v) => setG({ sslVerification: v })} />
            <SettingToggle label="SSL/TLS key log" help="Write TLS session keys to the app's local logs/tls-keys.log file for debugging encrypted connections." value={g.tlsKeyLog} onChange={v => setG({ tlsKeyLog: v })} />
            <SettingToggle label="Disable cookies" value={g.disableCookies} onChange={v => setG({ disableCookies: v })} />
            <SettingSelect label="Response format detection" value={g.responseFormat} options={['auto', 'json'].map(v => [v, v === 'auto' ? 'Auto' : 'JSON'])} onChange={v => setG({ responseFormat: v as typeof g.responseFormat })} />
            <div className="section-title">Working directory</div>
            <div className="setting-row"><div className="setting-label">Location</div><div className="settings-folder"><span title={g.workingDirectory}>{g.workingDirectory || 'Current workspace folder'}</span><button className="btn btn-secondary" onClick={async () => { const folder = await window.api.pickFolder('location'); if (folder) setG({ workingDirectory: folder }) }}>Choose</button>{g.workingDirectory && <button className="link-btn" onClick={() => setG({ workingDirectory: '' })}>Reset</button>}</div></div>
            <SettingToggle label="Allow reading files outside working directory" value={g.allowFilesOutsideWorkingDir} onChange={v => setG({ allowFilesOutsideWorkingDir: v })} />
            <div className="section-title">Headers</div>
            <SettingToggle label="Send no-cache header" value={g.sendNoCache} onChange={v => setG({ sendNoCache: v })} />
            <SettingToggle label="Send Postman Token header" value={g.sendPostmanToken} onChange={v => setG({ sendPostmanToken: v })} />
            <SettingToggle label="Automatically follow redirects" value={g.followRedirects} onChange={v => setG({ followRedirects: v })} />
            <div className="section-title">User interface</div>
            <SettingToggle label="Always open sidebar item in new tab" value={ui.alwaysNewTab} onChange={v => setUI({ alwaysNewTab: v })} />
            <SettingToggle label="Always ask when closing unsaved tabs" value={ui.confirmClose} onChange={v => setUI({ confirmClose: v })} />
            <SettingToggle label="Show icons with tab names" value={ui.tabIcons} onChange={v => setUI({ tabIcons: v })} />
            <SettingToggle label="Two-pane view" help="Show the request and response side by side." value={ui.twoPane} onChange={v => setUI({ twoPane: v })} />
            <SettingToggle label="Show middle workbench" value={ui.middleWorkbench} onChange={v => setUI({ middleWorkbench: v })} />
            <SettingToggle label="Swap left and right sidebars" value={ui.swapSidebars} onChange={v => setUI({ swapSidebars: v })} />
            <SettingToggle label="Variable autocomplete" value={ui.variableAutocomplete} onChange={v => setUI({ variableAutocomplete: v })} />
            <div className="section-title settings-section-heading">Editor settings<button className="link-btn" onClick={() => void save({ ...s, editor: { ...DEFAULT_SETTINGS.editor } })}>Reset</button></div>
            <div className="setting-row"><label htmlFor="editor-font">Font Family</label><input id="editor-font" className="input settings-font" value={editor.fontFamily} onChange={e => setEditor({ fontFamily: e.target.value })} /></div>
            <div className="setting-row"><label htmlFor="editor-size">Font Size (px)</label><NumericInput id="editor-size" className="input setting-number" min={8} max={40} value={editor.fontSize} onChange={v => setEditor({ fontSize: v })} /></div>
            <div className="setting-row"><label htmlFor="editor-indent">Indentation count</label><NumericInput id="editor-indent" className="input setting-number" min={1} max={8} value={editor.indentCount} onChange={v => setEditor({ indentCount: v })} /></div>
            <SettingSelect label="Indentation type" value={editor.indentType} options={[["space", "Space"], ["tab", "Tab"]]} onChange={v => setEditor({ indentType: v as typeof editor.indentType })} />
            <SettingToggle label="Auto close brackets" value={editor.closeBrackets} onChange={v => setEditor({ closeBrackets: v })} />
            <SettingToggle label="Auto close quotes" value={editor.closeQuotes} onChange={v => setEditor({ closeQuotes: v })} />
            <div className="section-title">Application</div>
            <div className="setting-row"><span>Language</span><span>English</span></div>
            <SettingToggle label="Autosave" help="Automatically save edits to requests in collections. New requests still need a name and collection." value={ui.autosave} onChange={v => setUI({ autosave: v })} />
          </>
        )}
        {tab === 'themes' && <>
          <SettingSelect label="Theme selection" value={s.appearance.mode} options={[["system", "Sync with system"], ["manual", "Manual"]]} onChange={v => void save({ ...s, appearance: { ...s.appearance, mode: v as 'system' | 'manual' } })} />
          <div className="theme-cards">{(s.appearance.mode === 'system' ? ['day', 'night'] as const : ['manual'] as const).map(key => {
            const name = s.appearance[key], palette = palettes[name]
            return <div className="theme-card" key={key}>
              <div className="theme-preview" style={{ background: palette[0], color: palette[4], borderColor: palette[3], colorScheme: isDarkTheme(name) ? 'dark' : 'light' }}><div style={{ background: palette[1], borderColor: palette[3] }}>PM Local</div><aside style={{ background: palette[1] }}>Collections<br /><br />Environments</aside><main><span style={{ color: isDarkTheme(name) ? '#77d5a3' : '#007f31' }}>GET</span> &nbsp; https://api.example.com<br /><br /><code>{'{ "status": "ok" }'}</code></main></div>
              <SettingSelect label={key === 'day' ? 'Day Theme' : key === 'night' ? 'Night Theme' : 'Theme'} value={name} options={THEMES.map(t => [t, t])} onChange={v => void save({ ...s, appearance: { ...s.appearance, [key]: v } })} />
            </div>
          })}</div>
        </>}
        {tab === 'shortcuts' && <>
          <SettingToggle label="Keyboard Shortcuts" value={ui.shortcuts} onChange={v => setUI({ shortcuts: v })} />
          <div className="section-title settings-section-heading">Shortcuts<button className="link-btn" onClick={() => setUI({ shortcuts: true })}>Restore Defaults</button></div>
          <p className="muted">Use Command on macOS or Ctrl on Windows. Editor editing shortcuts remain available.</p>
          <div className="shortcut-list">{[['Settings', '⌘ / Ctrl ,'], ['Save request', '⌘ / Ctrl S'], ['Send request', '⌘ / Ctrl Enter'], ['New request tab', '⌘ / Ctrl T'], ['Close tab', '⌘ / Ctrl W'], ['Force close tab', 'Alt ⌘ / Ctrl W'], ['Next tab', 'Shift ⌘ / Ctrl ]'], ['Previous tab', 'Shift ⌘ / Ctrl ['], ['Tab by position', '⌘ / Ctrl 1–8'], ['Last tab', '⌘ / Ctrl 9'], ['Search', '⌘ / Ctrl K'], ['Toggle sidebar', '⌘ / Ctrl \\'], ['Show middle workbench', 'Alt ⌘ / Ctrl M'], ['Swap sidebars', 'Alt ⌘ / Ctrl S']].map(([label, key]) => <div className="setting-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
        </>}
        {tab === 'data' && <>
          <div className="section-title">Import data</div><p className="muted">Import Postman collections, environments, globals, and cURL requests into your workspace.</p><button className="btn btn-secondary" disabled={!workspace} onClick={onImport}>Import Data File</button>
          <div className="section-title">Export workspace data</div><p className="muted">Export collections and environments as Postman JSON. Current secret variable values stay in the local secret store.</p>
          {!workspace && <p>Open a workspace to import or export data.</p>}
          {workspace?.collections.map(c => <div className="setting-row" key={c.id}><span>{c.name}</span><button className="btn btn-secondary" onClick={() => void window.api.exportCollection(c.id).catch(e => setError(cleanError(e)))}>Export collection</button></div>)}
          {workspace?.environments.map(e => <div className="setting-row" key={e.id}><span>{e.name}</span><button className="btn btn-secondary" onClick={() => void window.api.exportEnvironment(e.id).catch(e => setError(cleanError(e)))}>Export environment</button></div>)}
        </>}
        {tab === 'about' && <><div className="section-title">PM Local</div><p>A local API client built on the Postman runtime.</p><p>Collections, environments, history, and settings are stored on your computer.</p><p className="muted">No account, cloud sync, AI services, or usage telemetry.</p></>}
        {tab === 'proxy'  && (
          <>
            <div className="section-title">Default Proxy Configuration</div>
            <label className="check">
              <input type="checkbox" checked={px.auth.enabled} onChange={(e) => setP({ auth: { ...px.auth, enabled: e.target.checked } })} /> This proxy requires authentication
            </label>
            {px.auth.enabled && <Credentials value={px.auth} onChange={(auth) => setP({ auth })} />}
            <div className="section-title">Proxy configurations for sending requests</div>
            <p className="muted">Requests use the system proxy settings (including PAC scripts) by default.</p>
            <label className="check">
              <input type="checkbox" checked={px.useSystemProxy} onChange={(e) => setP({ useSystemProxy: e.target.checked })} /> Use the system proxy
            </label>
            <label className="check indent">
              <input type="checkbox" disabled={!px.useSystemProxy} checked={px.respectEnvVars} onChange={(e) => setP({ respectEnvVars: e.target.checked })} /> Respect HTTP_PROXY, HTTPS_PROXY, and NO_PROXY environment variables.
            </label>

            <label className="check">
              <input type="checkbox" checked={px.custom.enabled} onChange={(e) => setP({ custom: { ...px.custom, enabled: e.target.checked } })} /> Add a custom proxy configuration
            </label>
            {px.custom.enabled && (
              <div className="indent">
                <div className="form-row">
                  <span className="field-label">Proxy Type</span>
                  <label className="check">
                    <input type="checkbox" checked={px.custom.http} onChange={(e) => setP({ custom: { ...px.custom, http: e.target.checked } })} /> HTTP
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={px.custom.https} onChange={(e) => setP({ custom: { ...px.custom, https: e.target.checked } })} /> HTTPS
                  </label>
                </div>
                <div className="form-row">
                  <span className="field-label">Proxy Server</span>
                  <input className="input" aria-label="Proxy host" placeholder="proxy.example.com" value={px.custom.host} onChange={(e) => setP({ custom: { ...px.custom, host: e.target.value } })} />
                  <NumericInput className="input port" aria-label="Proxy port" min={1} max={65535} value={px.custom.port} onChange={(port) => setP({ custom: { ...px.custom, port } })} />
                </div>
                <label className="check">
                  <input type="checkbox" checked={px.custom.auth.enabled} onChange={(e) => setP({ custom: { ...px.custom, auth: { ...px.custom.auth, enabled: e.target.checked } } })} /> Proxy Auth
                </label>
                {px.custom.auth.enabled && <Credentials value={px.custom.auth} onChange={(auth) => setP({ custom: { ...px.custom, auth } })} />}
                <div className="form-row">
                  <span className="field-label">Proxy Bypass</span>
                  <input className="input" aria-label="Proxy bypass" placeholder="localhost, *.corp.example" value={px.custom.bypass} onChange={(e) => setP({ custom: { ...px.custom, bypass: e.target.value } })} />
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'certificates' && (
          <>
            <div className="section-title">CA Certificates</div>
            <SettingToggle
              label="Trust the operating system's certificates"
              help="Uses the operating system’s trusted certificate store, so corporate root certificates work like in your browser."
              value={cert.useSystemStore}
              onChange={(v) => setC({ useSystemStore: v })}
            />
            <SettingToggle label="Use a custom CA certificate file" value={cert.ca.enabled} onChange={(v) => setC({ ca: { ...cert.ca, enabled: v } })} />
            {cert.ca.enabled && (
              <div className="form-row indent">
                <span className="field-label">PEM file</span>
                <button className="file-pick" onClick={async () => { const f = await pick('Select CA certificate (PEM)'); if (f) setC({ ca: { ...cert.ca, file: f } }) }}>
                  {cert.ca.file || 'Select File'}
                </button>
                {cert.ca.file && <button className="btn-icon" aria-label="Clear CA file" onClick={() => setC({ ca: { ...cert.ca, file: '' } })}>×</button>}
              </div>
            )}
            <div className="section-title settings-section-heading">Client Certificates
              <button className="link-btn" onClick={() => setC({ client: [...cert.client, { host: '' }] })}>Add Certificate</button>
            </div>
            <p className="muted">Add and manage SSL certificates on a per domain basis.</p>
            {cert.client.map((c, i) => (
              <ClientCertRow
                key={i}
                cert={c}
                pick={pick}
                onChange={(next) => setC({ client: cert.client.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setC({ client: cert.client.filter((_, j) => j !== i) })}
              />
            ))}
          </>
        )}
      </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  )
}

function SettingSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly string[])[]; onChange(value: string): void }) {
  return <div className="setting-row"><span className="setting-label">{label}</span><select className="select" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(([value, title]) => <option value={value} key={value}>{title}</option>)}</select></div>
}

function SettingToggle({ label, help, value, onChange }: { label: string; help?: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {help && <div className="muted">{help}</div>}
      </div>
      <Toggle label={label} checked={value} onChange={onChange} />
    </div>
  )
}

function SettingNumber({ label, help, value, onChange }: { label: string; help: string; value: number; onChange(v: number): void }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        <div className="muted">{help}</div>
      </div>
      <NumericInput aria-label={label} className="input setting-number" min={0} value={value} onChange={onChange} />
    </div>
  )
}

function Credentials({ value, onChange }: { value: { enabled: boolean; username: string; password: string }; onChange(v: typeof value): void }) {
  return (
    <div className="form-row indent">
      <input className="input" aria-label="Proxy username" placeholder="Username" value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })} />
      <input className="input" aria-label="Proxy password" placeholder="Password" type="password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} />
    </div>
  )
}

function ClientCertRow({ cert, pick, onChange, onRemove }: { cert: ClientCert; pick(t: string): Promise<string | null>; onChange(c: ClientCert): void; onRemove(): void }) {
  const file = (key: 'cert' | 'key' | 'pfx', label: string) => (
    <div className="form-row">
      <span className="field-label">{label}</span>
      <button className="file-pick" onClick={async () => { const f = await pick(`Select ${label}`); if (f) onChange({ ...cert, [key]: f }) }}>
        {cert[key] || 'Select File'}
      </button>
      {cert[key] && <button className="btn-icon" aria-label={`Clear ${label}`} onClick={() => onChange({ ...cert, [key]: undefined })}>×</button>}
    </div>
  )
  return (
    <div className="client-cert">
      <div className="form-row">
        <span className="field-label">Host</span>
        <input className="input" aria-label="Certificate host" placeholder="api.example.com:443" value={cert.host} onChange={(e) => onChange({ ...cert, host: e.target.value.replace(/^https?:\/\//i, '') })} />
        <button className="btn-icon" aria-label="Remove certificate" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      {cert.host && !normalizeCertificateHost(cert.host) && <div className="form-error" role="alert">Enter a hostname and optional port (1–65535), without a path.</div>}
      {file('cert', 'CRT file')}
      {file('key', 'KEY file')}
      {file('pfx', 'PFX file')}
      <div className="form-row">
        <span className="field-label">Passphrase</span>
        <input className="input" type="password" aria-label="Certificate passphrase" value={cert.passphrase ?? ''} onChange={(e) => onChange({ ...cert, passphrase: e.target.value || undefined })} />
      </div>
    </div>
  )
}
