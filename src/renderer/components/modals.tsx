import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ClientCert, CookieInfo } from '../../shared/engine'
import type { TreeNode, WorkspaceInfo } from '../../shared/format/types'
import type { ImportResult } from '../../shared/ipc'
import { normalizeCertificateHost, type AppSettingsData } from '../../shared/settings'
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

type SettingsTab = 'general' | 'proxy' | 'certificates'

export function SettingsModal({ onClose, onSaved }: { onClose(): void; onSaved(s: AppSettingsData): void }) {
  const [s, setS] = useState<AppSettingsData | null>(null)
  const [tab, setTab] = useState<SettingsTab>('general')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => void window.api.getSettings().then(setS), [])
  if (!s) return null
  const save = async (next: AppSettingsData) => {
    setS(next)
    try {
      await window.api.saveSettings(next)
      onSaved(next)
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }
  const g = s.general
  const px = s.proxy
  const cert = s.certificates
  const setG = (patch: Partial<typeof g>) => void save({ ...s, general: { ...g, ...patch } })
  const setP = (patch: Partial<typeof px>) => void save({ ...s, proxy: { ...px, ...patch } })
  const setC = (patch: Partial<typeof cert>) => void save({ ...s, certificates: { ...cert, ...patch } })
  const pick = async (title: string) => window.api.pickFile(title)

  return (
    <Modal title="SETTINGS" onClose={onClose} wide className="settings-modal">
      <div className="subtabs settings-tabs" role="tablist" aria-label="Settings">
        {(['general', 'certificates', 'proxy'] as const).map((t) => (
          <button key={t} role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} onClick={() => setTab(t)} onKeyDown={(e) => {
            const tabs = ['general', 'certificates', 'proxy'] as const
            const index = tabs.indexOf(t)
            const next = e.key === 'ArrowRight' ? (index + 1) % 3 : e.key === 'ArrowLeft' ? (index + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1
            if (next >= 0) { e.preventDefault(); setTab(tabs[next]); (e.currentTarget.parentElement!.children[next] as HTMLElement).focus() }
          }}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className={`settings-body settings-${tab}`} role="tabpanel">
        {tab === 'general' && (
          <>
            <div className="section-title">Request</div>
            <SettingNumber label="Request timeout in ms" help="Set how long a request should wait for a response before timing out. To never time out, set to 0." value={g.timeoutMs} onChange={(v) => setG({ timeoutMs: v })} />
            <SettingNumber label="Max response size in MB" help="Set the maximum size of a response to download. To download a response of any size, set to 0." value={g.maxResponseSizeMb} onChange={(v) => setG({ maxResponseSizeMb: v })} />
            <SettingToggle label="SSL certificate verification" value={g.sslVerification} onChange={(v) => setG({ sslVerification: v })} />
            <SettingToggle label="Automatically follow redirects" value={g.followRedirects} onChange={(v) => setG({ followRedirects: v })} />
            <SettingToggle label="Send Postman Token header" value={g.sendPostmanToken} onChange={(v) => setG({ sendPostmanToken: v })} />
            <SettingToggle
              label="Allow reading files outside working directory"
              help="The working directory is the workspace folder. Keep this off so shared collections cannot upload files from elsewhere on your computer."
              value={g.allowFilesOutsideWorkingDir}
              onChange={(v) => setG({ allowFilesOutsideWorkingDir: v })}
            />
          </>
        )}
        {tab === 'proxy' && (
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
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  )
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
