import { ChevronDown, ChevronRight, FileText, Save } from 'lucide-react'
import { useState } from 'react'
import type { PmAuth, PmItem, PmRequest } from '../../../shared/format/types'
import { pathVariables, queryParams, rawUrl, setPathVariables, setQueryParams, setRaw } from '../../../shared/format/url'
import type { AppSettingsData } from '../../../shared/settings'
import { METHODS, methodClass } from '../../lib/methods'
import { isDirty, type Tab } from '../../state'
import { KeyValueTable, Menu } from '../common/ui'
import { VarInput, type Resolve } from '../common/VarInput'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
import { RequestSettings } from './RequestSettings'
import { ScriptsPanel, scriptOf } from './ScriptEditor'

type Section = 'docs' | 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings'

export interface RequestEditorProps {
  tab: Tab
  item: PmItem
  breadcrumb: string[]
  resolve: Resolve
  settings: AppSettingsData | null
  onPatch(patch: Partial<PmRequest>): void
  onItemPatch(patch: Partial<Omit<PmItem, 'request' | 'name'>>): void
  onSend(download?: boolean): void
  onCancel(): void
  onSave(): void
  /** Save a copy into a collection (Save As…). */
  onSaveAs(): void
  onPasteCurl(text: string): void
  onOpenCookies(): void
  pickFile(): Promise<string | null>
  onGetOAuth2Token(auth: PmAuth): Promise<void>
}

export function RequestEditor(p: RequestEditorProps) {
  const [customMethod, setCustomMethod] = useState(false)
  const [section, setSection] = useState<Section>('params')
  const [sendMenu, setSendMenu] = useState<DOMRect | null>(null)
  const [saveMenu, setSaveMenu] = useState<DOMRect | null>(null)
  const { item } = p
  const req = item.request
  const raw = rawUrl(req.url)
  const sending = !!p.tab.sendId
  const params = queryParams(req.url)
  const pathVars = pathVariables(req.url)
  const activeHeaders = req.header.filter((h) => !h.disabled && h.key).length
  const activeParams = params.filter((x) => !x.disabled && x.key).length
  const hasBody = !!req.body && !(req.body as { disabled?: boolean }).disabled
  const hasScripts = !!scriptOf(item.event, 'prerequest').trim() || !!scriptOf(item.event, 'test').trim()
  const dirty = isDirty(p.tab) || p.tab.id === null

  // Postman 12: grey count + green dot when a section has content.
  const tabs: { id: Section; label: string; badge?: number; dot?: boolean }[] = [
    { id: 'docs', label: 'Docs' },
    { id: 'params', label: 'Params', badge: activeParams, dot: activeParams > 0 },
    { id: 'auth', label: 'Authorization', dot: !!req.auth && req.auth.type !== 'noauth' },
    { id: 'headers', label: 'Headers', badge: activeHeaders, dot: activeHeaders > 0 },
    { id: 'body', label: 'Body', dot: hasBody },
    { id: 'scripts', label: 'Scripts', dot: hasScripts },
    { id: 'settings', label: 'Settings', dot: !!item.protocolProfileBehavior },
  ]

  return (
    <div className="editor">
      <div className="editor-title">
        <span className="editor-breadcrumb">
          <span className="http-badge">HTTP</span>
          {p.breadcrumb.map((b, i) => (
            <span key={i} className="crumb">
              {b}
              <ChevronRight size={12} className="crumb-sep" />
            </span>
          ))}
          <span className="editor-name">{item.name}</span>
        </span>
        <span className="save-group">
          <button className={`btn btn-ghost save-main${dirty ? '' : ' clean'}`} onClick={p.onSave} title="Save (Ctrl+S)">
            <Save size={14} /> Save
          </button>
          <button className="btn btn-ghost save-more" aria-label="Save options" onClick={(e) => setSaveMenu(e.currentTarget.getBoundingClientRect())}>
            <ChevronDown size={14} />
          </button>
        </span>
        {saveMenu && <Menu style={{ left: saveMenu.right - 180, top: saveMenu.bottom + 4 }} onClose={() => setSaveMenu(null)} items={[{ label: 'Save As…', onClick: p.onSaveAs }]} />}
      </div>

      <div className="url-row">
        <div className="url-group">
          {customMethod ? <input aria-label="Custom HTTP method" className="input method" value={req.method} autoFocus onChange={e => p.onPatch({ method: e.target.value.toUpperCase().replace(/[^!#$%&'*+.^_`|~0-9A-Z-]/g, '') })} onBlur={() => { if (!req.method) p.onPatch({ method: 'GET' }) }} /> : <select aria-label="HTTP method" className={`method method-select ${methodClass(req.method)}`} value={req.method} onChange={(e) => { if (e.target.value === '__custom') { setCustomMethod(true); p.onPatch({ method: '' }) } else p.onPatch({ method: e.target.value }) }}>
            {(METHODS as readonly string[]).concat(METHODS.includes(req.method as never) ? [] : [req.method]).map((m) => (
              <option key={m}>{m}</option>
            ))}
            <option value="__custom">Custom…</option>
          </select>}
          <VarInput
            ariaLabel="Request URL"
            placeholder="Enter URL or paste text"
            value={raw}
            resolve={p.resolve}
            onChange={(text) => p.onPatch({ url: setRaw(req.url, text) })}
            onEnter={() => !sending && raw.trim() && p.onSend()}
            onPasteCurl={p.onPasteCurl}
          />
        </div>
        {sending ? (
          <button className="btn btn-send" onClick={p.onCancel}>
            Cancel
          </button>
        ) : (
          <div className="send-group">
            <button className="btn btn-send send-main" onClick={() => p.onSend()} disabled={!raw.trim()} title="Send (Ctrl+Enter)">
              Send
            </button>
            <button className="btn btn-send send-more" aria-label="Send options" disabled={!raw.trim()} onClick={(e) => setSendMenu(e.currentTarget.getBoundingClientRect())}>
              <ChevronDown size={14} />
            </button>
            {sendMenu && (
              <Menu
                style={{ left: sendMenu.right - 160, top: sendMenu.bottom + 4 }}
                onClose={() => setSendMenu(null)}
                items={[{ label: 'Send and Download', onClick: () => p.onSend(true) }]}
              />
            )}
          </div>
        )}
      </div>

      <div className="subtabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={section === t.id} onClick={() => setSection(t.id)}>
            {t.id === 'docs' && <FileText size={13} />}
            {t.label}
            {!!t.badge && <span className="count">{t.badge}</span>}
            {t.dot && <span className="dot-indicator" />}
          </button>
        ))}
        <span className="spacer" />
        <button className="subtab-link" onClick={p.onOpenCookies}>
          Cookies
        </button>
      </div>

      <div className="subtab-panel">
        {section === 'docs' && (
          <textarea
            aria-label="Request documentation"
            className="docs-area"
            placeholder="Document this request..."
            value={req.description ?? ''}
            onChange={(e) => p.onPatch({ description: e.target.value || undefined })}
          />
        )}
        {section === 'params' && (
          <>
            <div className="section-title">Query Params</div>
            <KeyValueTable rows={params} onChange={(rows) => p.onPatch({ url: setQueryParams(req.url, rows) })} />
            {pathVars.length > 0 && (
              <>
                <div className="section-title">Path Variables</div>
                <KeyValueTable rows={pathVars} readOnlyKeys noBulk noToggle onChange={(rows) => p.onPatch({ url: setPathVariables(req.url, rows) })} />
              </>
            )}
          </>
        )}
        {section === 'auth' && (
          <AuthEditor
            auth={req.auth}
            canInherit
            inheritedFrom={p.breadcrumb.length ? p.breadcrumb.join(' / ') : undefined}
            onChange={(auth) => p.onPatch({ auth })}
            onGetOAuth2Token={p.onGetOAuth2Token}
          />
        )}
        {section === 'headers' && (
          <>
            <div className="section-title">Headers</div>
            <KeyValueTable rows={req.header} onChange={(header) => p.onPatch({ header })} />
          </>
        )}
        {section === 'body' && <><BodyEditor allowFilesOutsideWorkingDir={p.settings?.general.allowFilesOutsideWorkingDir} body={req.body} onChange={(body) => p.onPatch({ body })} pickFile={p.pickFile} />{item.protocolProfileBehavior?.disableBodyPruning === false && /^(GET|HEAD)$/i.test(req.method) && hasBody && <div className="notice">This body will not be sent. Enable “Send body with GET/HEAD” in Settings to include it.</div>}</>}
        {section === 'scripts' && <ScriptsPanel events={item.event} scope="request" onChange={(event) => p.onItemPatch({ event })} />}
        {section === 'settings' && (
          <RequestSettings behavior={item.protocolProfileBehavior} settings={p.settings} onChange={(protocolProfileBehavior) => p.onItemPatch({ protocolProfileBehavior })} />
        )}
      </div>
    </div>
  )
}
