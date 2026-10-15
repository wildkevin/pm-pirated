import { Allotment } from 'allotment'
import { FolderOpen, Settings as SettingsIcon, Terminal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RunReport } from '../shared/engine'
import type { PmAuth, PmItem, TreeNode } from '../shared/format/types'
import { rawUrl } from '../shared/format/url'
import type { HistoryEntry, ImportResult, OAuth2Config, ResolvedVariable } from '../shared/ipc'
import type { AppSettingsData } from '../shared/settings'
import { getAttr, setAttr } from './lib/auth'
import { cleanError, viewBody } from './lib/body'
import { splitVariables } from './lib/misc'
import { ContainerEditor } from './components/ContainerEditor'
import { Console, type ConsoleEntry } from './components/Console'
import { CookiesModal, ImportModal, SaveRequestModal, SettingsModal } from './components/modals'
import { RequestEditor } from './components/request/RequestEditor'
import { ResponseViewer } from './components/response/ResponseViewer'
import { Sidebar, type Panel, type SidebarActions } from './components/Sidebar'
import { TabsBar } from './components/TabsBar'
import { VariablesEditor } from './components/VariablesEditor'
import { activeTab, initialState, isDirty, newDraft, reducer, tabTitle, toUiState, type Tab, type TabDoc } from './state'

let seq = 0
const nextId = () => `${Date.now()}-${++seq}`
const MAX_CONSOLE = 300

type ModalState = { kind: 'import' } | { kind: 'settings' } | { kind: 'cookies' } | { kind: 'save'; key: string } | null

function findPath(nodes: TreeNode[], id: string): TreeNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n]
    if (n.children && id.startsWith(`${n.id}/`)) {
      const rest = findPath(n.children, id)
      if (rest.length) return [n, ...rest]
    }
  }
  return []
}

const failedReport = (error: string): RunReport => ({ response: { ok: false, error }, tests: [], logs: [], scriptErrors: [], cookies: [] })

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const [panel, setPanel] = useState<Panel>('collections')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [settings, setSettings] = useState<AppSettingsData | null>(null)
  const [resolved, setResolved] = useState<ResolvedVariable[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [modal, setModal] = useState<ModalState>(null)
  const restoredRoot = useRef<string | null>(null)

  const fail = useCallback((e: unknown) => dispatch({ type: 'error', error: cleanError(e) }), [])
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (e) {
        fail(e)
        return undefined
      }
    },
    [fail],
  )

  // --- startup, workspace switching, persistence ---
  useEffect(() => {
    void run(async () => {
      setSettings(await window.api.getSettings())
      dispatch({ type: 'workspace', workspace: await window.api.currentWorkspace() })
    })
  }, [run])

  const root = state.workspace?.root
  useEffect(() => {
    if (!root || restoredRoot.current === root) return
    void run(async () => {
      dispatch({ type: 'restore', ui: await window.api.readUiState() })
      setHistory(await window.api.listHistory())
      setConsoleEntries([])
      restoredRoot.current = root
    })
  }, [root, run])

  useEffect(() => {
    if (!root || restoredRoot.current !== root) return
    const t = setTimeout(() => void window.api.saveUiState(toUiState(stateRef.current)).catch(() => undefined), 400)
    return () => clearTimeout(t)
  }, [root, state.tabs, state.activeKey, state.activeEnvironment])

  useEffect(() => {
    window.api.onBeforeClose(() => {
      const done = () => window.api.closeReady()
      if (!restoredRoot.current) return done()
      window.api.saveUiState(toUiState(stateRef.current)).then(done, done)
    })
  }, [])

  const active = activeTab(state)
  const activeRequestId = active?.doc.kind === 'request' ? active.id : null

  const refreshResolved = useCallback(() => {
    if (!root) return
    window.api.resolveVariables(activeRequestId, stateRef.current.activeEnvironment).then(setResolved, () => setResolved([]))
  }, [root, activeRequestId])
  useEffect(refreshResolved, [refreshResolved, state.activeEnvironment])
  const resolve = useMemo(() => {
    const m = new Map(resolved.map((v) => [v.key, v]))
    return (name: string) => m.get(name)
  }, [resolved])

  const refreshWorkspace = () => run(async () => dispatch({ type: 'workspace', workspace: await window.api.refreshWorkspace() }))

  // --- opening tabs ---
  const openWorkspace = () =>
    run(async () => {
      const workspace = await window.api.openWorkspaceDialog()
      if (workspace) dispatch({ type: 'workspace', workspace })
    })
  const openRequest = (id: string) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === id && t.doc.kind === 'request')
      if (open) return dispatch({ type: 'activate', key: open.key })
      dispatch({ type: 'open', id, doc: { kind: 'request', item: await window.api.readRequest(id) } })
    })
  const openContainer = (id: string) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === id && t.doc.kind === 'container')
      if (open) return dispatch({ type: 'activate', key: open.key })
      const isCollection = id.split('/').length === 2
      const [container, variables] = await Promise.all([window.api.readContainer(id), isCollection ? window.api.readVariables(`col:${id}`) : Promise.resolve(null)])
      dispatch({ type: 'open', id, doc: { kind: 'container', container, variables } })
    })
  const openVariables = (scope: string, title: string) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === scope)
      if (open) return dispatch({ type: 'activate', key: open.key })
      dispatch({ type: 'open', id: scope, doc: { kind: 'variables', title, rows: await window.api.readVariables(scope) } })
    })

  // --- saving ---
  const save = (tab: Tab) =>
    run(async () => {
      const doc = tab.doc
      if (doc.kind === 'request') {
        if (tab.id === null) return setModal({ kind: 'save', key: tab.key })
        const workspace = await window.api.saveRequest(tab.id, doc.item)
        dispatch({ type: 'saved', key: tab.key, doc })
        dispatch({ type: 'workspace', workspace })
      } else if (doc.kind === 'container') {
        const { auth, event, description } = doc.container
        let workspace = await window.api.saveContainer(tab.id!, { auth, event, description })
        if (doc.variables) {
          await window.api.saveVariables(`col:${tab.id}`, doc.variables)
          workspace = await window.api.refreshWorkspace()
        }
        dispatch({ type: 'saved', key: tab.key, doc })
        dispatch({ type: 'workspace', workspace })
      } else {
        await window.api.saveVariables(tab.id!, doc.rows)
        dispatch({ type: 'saved', key: tab.key, doc })
      }
      refreshResolved()
    })

  /** After scripts ran, reload open variable editors that have no unsaved edits. */
  const reloadVariableTabs = () =>
    run(async () => {
      for (const t of stateRef.current.tabs) {
        if (isDirty(t) || !t.id) continue
        if (t.doc.kind === 'variables') {
          const rows = await window.api.readVariables(t.id)
          const latest = stateRef.current.tabs.find((x) => x.key === t.key)?.doc ?? t.doc
          dispatch({ type: 'setRows', key: t.key, rows })
          dispatch({ type: 'saved', key: t.key, doc: { ...latest, rows } as TabDoc })
        } else if (t.doc.kind === 'container' && t.doc.variables) {
          const variables = await window.api.readVariables(`col:${t.id}`)
          const latest = stateRef.current.tabs.find((x) => x.key === t.key)?.doc ?? t.doc
          dispatch({ type: 'setContainerVariables', key: t.key, variables })
          dispatch({ type: 'saved', key: t.key, doc: { ...latest, variables } as TabDoc })
        }
      }
    })

  // --- sending ---
  const send = (tab: Tab, download = false) => {
    if (tab.doc.kind !== 'request') return
    const item = tab.doc.item
    const sendId = nextId()
    dispatch({ type: 'sendStart', key: tab.key, sendId })
    void window.api
      .sendRequest(sendId, tab.id, item, stateRef.current.activeEnvironment)
      .catch((e) => failedReport(cleanError(e)))
      .then(async (report) => {
        dispatch({ type: 'sendDone', key: tab.key, sendId, report })
        setConsoleEntries((prev) => [...prev, { id: ++seq, ts: Date.now(), method: item.request.method, url: rawUrl(item.request.url), report }].slice(-MAX_CONSOLE))
        refreshResolved()
        void reloadVariableTabs()
        window.api.listHistory().then(setHistory, () => undefined)
        if (download && report.response.ok) await run(() => window.api.saveResponseBody(item.name || 'response', (report.response as { body: Uint8Array }).body))
      })
  }
  const cancel = (tab: Tab) => {
    if (tab.sendId) void window.api.cancelRequest(tab.sendId)
  }

  const close = (tab: Tab) => {
    if (isDirty(tab) && !window.confirm(`"${tabTitle(tab)}" has unsaved changes. Close without saving?`)) return
    dispatch({ type: 'close', key: tab.key })
  }

  const newRequestTab = () => dispatch({ type: 'openDraft', item: newDraft() })

  /** "Get New Access Token": resolves {{variables}} in the config, runs the flow, stores the token. */
  const getOAuth2Token = (apply: (auth: PmAuth) => void) => async (auth: PmAuth) => {
    const sub = (v: unknown) =>
      splitVariables(String(v ?? ''))
        .map((p) => (p.variable ? (resolve(p.variable)?.value ?? p.text) : p.text))
        .join('')
    const keys: (keyof OAuth2Config)[] = ['grant_type', 'authUrl', 'accessTokenUrl', 'clientId', 'clientSecret', 'scope', 'state', 'redirect_uri', 'client_authentication', 'username', 'password', 'challengeAlgorithm']
    const defaults: Partial<Record<keyof OAuth2Config, string>> = { grant_type: 'authorization_code', client_authentication: 'header', challengeAlgorithm: 'S256' }
    const config = Object.fromEntries(keys.map((k) => [k, sub(getAttr(auth, k) ?? defaults[k] ?? '')]))
    await run(async () => {
      const token = await window.api.getOAuth2Token(config)
      apply(setAttr(auth, 'accessToken', token.access_token))
    })
  }

  // --- keyboard shortcuts (Postman's) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !stateRef.current.workspace || modal) return
      const tab = activeTab(stateRef.current)
      const k = e.key.toLowerCase()
      if (k === 's' && tab) {
        e.preventDefault()
        void save(tab)
      } else if (k === 'enter' && tab && !tab.sendId) {
        e.preventDefault()
        send(tab)
      } else if (k === 't') {
        e.preventDefault()
        newRequestTab()
      } else if (k === 'w' && tab) {
        e.preventDefault()
        close(tab)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- sidebar actions ---
  const actions: SidebarActions = {
    openRequest: (id) => void openRequest(id),
    openContainer: (id) => void openContainer(id),
    createCollection: () =>
      void run(async () => {
        setPanel('collections')
        const { workspace, id } = await window.api.createCollection('New Collection')
        dispatch({ type: 'workspace', workspace })
        setRenamingId(id)
      }),
    createFolder: (parentId) =>
      void run(async () => {
        const { workspace, id } = await window.api.createFolder(parentId, 'New Folder')
        dispatch({ type: 'workspace', workspace })
        setRenamingId(id)
      }),
    createRequest: (parentId) =>
      void run(async () => {
        const { workspace, id } = await window.api.createRequest(parentId, 'New Request')
        dispatch({ type: 'workspace', workspace })
        await openRequest(id)
        setRenamingId(id)
      }),
    rename: (id, name) =>
      void run(async () => {
        setRenamingId(null)
        const { workspace, id: newId } = await window.api.renameNode(id, name)
        dispatch({ type: 'renamed', id, newId, name })
        dispatch({ type: 'workspace', workspace })
      }),
    startRename: setRenamingId,
    remove: (id, name) =>
      void run(async () => {
        if (!window.confirm(`Delete "${name}"? This removes it from disk.`)) return
        const workspace = await window.api.deleteNode(id)
        dispatch({ type: 'removed', id })
        dispatch({ type: 'workspace', workspace })
      }),
    exportCollection: (id) => void run(() => window.api.exportCollection(id)),
    openVariables: (scope, title) => void openVariables(scope, title),
    createEnvironment: () =>
      void run(async () => {
        setPanel('environments')
        const { workspace, id } = await window.api.createEnvironment('New Environment')
        dispatch({ type: 'workspace', workspace })
        await openVariables(`env:${id}`, 'New Environment')
        setRenamingId(id)
      }),
    renameEnvironment: (id, name) =>
      void run(async () => {
        setRenamingId(null)
        const { workspace, id: newId } = await window.api.renameEnvironment(id, name)
        dispatch({ type: 'renamed', id: `env:${id}`, newId: `env:${newId}`, name })
        if (stateRef.current.activeEnvironment === id) dispatch({ type: 'environment', id: newId })
        dispatch({ type: 'workspace', workspace })
      }),
    deleteEnvironment: (id, name) =>
      void run(async () => {
        if (!window.confirm(`Delete environment "${name}"?`)) return
        const workspace = await window.api.deleteEnvironment(id)
        dispatch({ type: 'removed', id: `env:${id}` })
        if (stateRef.current.activeEnvironment === id) dispatch({ type: 'environment', id: null })
        dispatch({ type: 'workspace', workspace })
      }),
    exportEnvironment: (id) => void run(() => window.api.exportEnvironment(id)),
    setActiveEnvironment: (id) => dispatch({ type: 'environment', id }),
    openHistory: (entry) => dispatch({ type: 'openDraft', item: { ...entry.item, name: rawUrl(entry.item.request.url) || entry.item.name } }),
    deleteHistory: (id) =>
      void run(async () => {
        await window.api.deleteHistory(id)
        setHistory(await window.api.listHistory())
      }),
    newRequest: newRequestTab,
    openImport: () => setModal({ kind: 'import' }),
  }

  const onImported = (results: ImportResult[]) =>
    run(async () => {
      setModal(null)
      for (const r of results) if (r.kind === 'request' && r.item) dispatch({ type: 'openDraft', item: r.item })
      await refreshWorkspace()
      refreshResolved()
      if (results.some((r) => r.kind === 'collection')) setPanel('collections')
      else if (results.some((r) => r.kind === 'environment' || r.kind === 'globals')) setPanel('environments')
    })

  const pasteCurl = (tab: Tab) => (text: string) =>
    void run(async () => {
      const r = await window.api.importText(text)
      if (r.item) dispatch({ type: 'edit', key: tab.key, patch: { method: r.item.request.method, url: r.item.request.url, header: r.item.request.header, body: r.item.request.body } })
    })

  const saveExample = (tab: Tab) => {
    if (tab.doc.kind !== 'request' || !tab.report?.response.ok) return
    const res = tab.report.response
    const view = viewBody(res.body, res.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value)
    const example = {
      name: `${tab.doc.item.name} (${res.code})`,
      originalRequest: tab.doc.item.request,
      status: res.status,
      code: res.code,
      header: res.headers,
      body: view.kind === 'text' ? view.text : '',
      ...(view.kind === 'text' ? { _postman_previewlanguage: view.language } : {}),
    }
    dispatch({ type: 'editItem', key: tab.key, patch: { response: [...(tab.doc.item.response ?? []), example] } })
  }

  const content = () => {
    if (!active) {
      return (
        <div className="empty-state">
          <div className="empty-actions">
            <button className="btn btn-secondary" onClick={newRequestTab}>
              New HTTP request <kbd>Ctrl+T</kbd>
            </button>
            <button className="btn btn-secondary" onClick={() => setModal({ kind: 'import' })}>
              Import
            </button>
          </div>
          <p className="muted">Open a request from the sidebar, or paste a cURL command into a new request's URL bar.</p>
        </div>
      )
    }
    const doc = active.doc
    if (doc.kind === 'request') {
      const path = active.id ? findPath(state.workspace!.collections, active.id) : []
      return (
        <Allotment vertical key={active.key}>
          <Allotment.Pane minSize={180} preferredSize="55%">
            <RequestEditor
              tab={active}
              item={doc.item}
              breadcrumb={path.slice(0, -1).map((n) => n.name)}
              resolve={resolve}
              settings={settings}
              onPatch={(patch) => dispatch({ type: 'edit', key: active.key, patch })}
              onItemPatch={(patch) => dispatch({ type: 'editItem', key: active.key, patch })}
              onSend={(download) => send(active, download)}
              onCancel={() => cancel(active)}
              onSave={() => void save(active)}
              onPasteCurl={pasteCurl(active)}
              onOpenCookies={() => setModal({ kind: 'cookies' })}
              pickFile={() => window.api.pickFile('Select file')}
              onGetOAuth2Token={getOAuth2Token((auth) => dispatch({ type: 'edit', key: active.key, patch: { auth } }))}
            />
          </Allotment.Pane>
          <Allotment.Pane minSize={120}>
            <ResponseViewer
              report={active.report}
              sending={!!active.sendId}
              onCancel={() => cancel(active)}
              onSaveBody={() => {
                const res = active.report?.response
                if (res?.ok) void run(() => window.api.saveResponseBody(doc.item.name || 'response', res.body))
              }}
              onSaveExample={() => saveExample(active)}
            />
          </Allotment.Pane>
        </Allotment>
      )
    }
    if (doc.kind === 'container') {
      return (
        <ContainerEditor
          key={active.key}
          doc={doc}
          isCollection={active.id!.split('/').length === 2}
          onPatch={(patch) => dispatch({ type: 'patchContainer', key: active.key, patch })}
          onVariables={(variables) => dispatch({ type: 'setContainerVariables', key: active.key, variables })}
          onSave={() => void save(active)}
          onGetOAuth2Token={getOAuth2Token((auth) => dispatch({ type: 'patchContainer', key: active.key, patch: { auth } }))}
        />
      )
    }
    return (
      <div className="editor variables-tab" key={active.key}>
        <div className="editor-title">
          <span className="editor-name">{doc.title}</span>
          <button className="btn btn-ghost" onClick={() => void save(active)}>
            Save
          </button>
        </div>
        <p className="muted">
          {active.id === 'globals'
            ? 'Global variables are available in every request of this workspace.'
            : 'Current values stay on this computer; initial values are saved in the workspace folder (secret values never are).'}
        </p>
        <div className="subtab-panel">
          <VariablesEditor rows={doc.rows} onChange={(rows) => dispatch({ type: 'setRows', key: active.key, rows })} />
        </div>
      </div>
    )
  }

  const modalTab = modal?.kind === 'save' ? state.tabs.find((t) => t.key === modal.key) : undefined

  return (
    <div className="app">
      <header className="header">
        <span className="brand">PM Local</span>
        <span className="header-spacer" />
        <button className="btn-icon header-icon" aria-label="Settings" title="Settings" onClick={() => setModal({ kind: 'settings' })}>
          <SettingsIcon size={18} />
        </button>
        <button className="btn btn-secondary" onClick={() => void openWorkspace()}>
          <FolderOpen size={14} /> Open workspace
        </button>
      </header>

      {state.workspace ? (
        <div className="main">
          <Allotment vertical proportionalLayout={false}>
            <Allotment.Pane>
              <Allotment proportionalLayout={false}>
                <Allotment.Pane preferredSize={340} minSize={240} maxSize={640}>
                  <Sidebar
                    workspace={state.workspace}
                    panel={panel}
                    setPanel={setPanel}
                    activeId={active?.id ?? null}
                    renamingId={renamingId}
                    activeEnvironment={state.activeEnvironment}
                    history={history}
                    actions={actions}
                  />
                </Allotment.Pane>
                <Allotment.Pane>
                  <div className="workbench">
                    <TabsBar
                      tabs={state.tabs}
                      activeKey={state.activeKey}
                      onActivate={(key) => dispatch({ type: 'activate', key })}
                      onClose={close}
                      onNew={newRequestTab}
                      environments={state.workspace.environments}
                      activeEnvironment={state.activeEnvironment}
                      onEnvironment={(id) => dispatch({ type: 'environment', id })}
                      quickLook={resolved}
                      onEditEnvironment={() => {
                        const env = state.workspace!.environments.find((e) => e.id === state.activeEnvironment)
                        if (env) void openVariables(`env:${env.id}`, env.name)
                      }}
                    />
                    <div className="workbench-content">{content()}</div>
                  </div>
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>
            <Allotment.Pane visible={consoleOpen} preferredSize={260} minSize={120}>
              <Console entries={consoleEntries} onClear={() => setConsoleEntries([])} onClose={() => setConsoleOpen(false)} />
            </Allotment.Pane>
          </Allotment>
        </div>
      ) : (
        <div className="welcome">
          <h1>Welcome to PM Local</h1>
          <p>A workspace is a folder on your computer. Collections and requests are stored in it as plain JSON files you can version with git.</p>
          <button className="btn btn-primary" onClick={() => void openWorkspace()}>
            <FolderOpen size={14} /> Open workspace
          </button>
        </div>
      )}

      <footer className="status-bar">
        <button className={`status-btn${consoleOpen ? ' active' : ''}`} onClick={() => setConsoleOpen(!consoleOpen)} disabled={!state.workspace}>
          <Terminal size={12} /> Console
        </button>
        <span className="spacer" />
        {state.workspace && <span className="muted">{state.workspace.root}</span>}
      </footer>

      {modal?.kind === 'import' && <ImportModal onClose={() => setModal(null)} onImported={(r) => void onImported(r)} />}
      {modal?.kind === 'settings' && <SettingsModal onClose={() => setModal(null)} onSaved={setSettings} />}
      {modal?.kind === 'cookies' && <CookiesModal onClose={() => setModal(null)} />}
      {modalTab && modalTab.doc.kind === 'request' && state.workspace && (
        <SaveRequestModal
          workspace={state.workspace}
          initialName={modalTab.doc.item.name}
          onClose={() => setModal(null)}
          onNewCollection={async () => {
            const created = await run(() => window.api.createCollection('New Collection'))
            if (!created) return undefined
            dispatch({ type: 'workspace', workspace: created.workspace })
            return created.id
          }}
          onSave={async (parentId, name) => {
            const item: PmItem = { ...(modalTab.doc as { item: PmItem }).item, name }
            const { workspace, id } = await window.api.createRequest(parentId, name, item)
            dispatch({ type: 'saved', key: modalTab.key, doc: { kind: 'request', item }, id })
            dispatch({ type: 'workspace', workspace })
            setModal(null)
            refreshResolved()
          }}
        />
      )}

      {state.error && (
        <div className="toast" role="alert">
          <span>{state.error}</span>
          <button className="btn-icon" aria-label="Dismiss" onClick={() => dispatch({ type: 'error', error: null })}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
