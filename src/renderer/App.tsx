import { Allotment } from 'allotment'
import { Cookie, Globe, PanelLeft, PanelRight, PlayCircle, Radio, Terminal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RunReport } from '../shared/engine'
import type { PmAuth, PmItem, TreeNode } from '../shared/format/types'
import { rawUrl } from '../shared/format/url'
import type { CaptureState, HistoryEntry, ImportResult, OAuth2Config, ResolvedVariable, WorkspaceListItem } from '../shared/ipc'
import type { CapturedExchange } from '../shared/engine'
import type { MockInfo, MockLogEntry } from '../shared/mock'
import type { AppSettingsData } from '../shared/settings'
import { getAttr, setAttr } from './lib/auth'
import { cleanError, viewBody } from './lib/body'
import { splitVariables } from './lib/misc'
import { RightPanel, type RightView } from './components/RightPanel'
import { ContainerEditor } from './components/ContainerEditor'
import { Console, type ConsoleEntry } from './components/Console'
import { CookiesModal, ImportModal, SaveRequestModal, SettingsModal } from './components/modals'
import { RequestEditor } from './components/request/RequestEditor'
import { ResponseViewer } from './components/response/ResponseViewer'
import { CreateMockModal, MockView } from './components/MockView'
import { RunnerView } from './components/RunnerView'
import { LoadTestView } from './components/LoadTestView'
import { onCaptureEvent, onMockEvent } from './lib/runnerBus'
import { CaptureView } from './components/CaptureView'
import { Sidebar, type Panel, type SidebarActions } from './components/Sidebar'
import { TabsBar } from './components/TabsBar'
import { VariablesEditor } from './components/VariablesEditor'
import { activeTab, initialState, isDirty, newDraft, reducer, tabTitle, toUiState, type Action, type Tab, type TabDoc } from './state'
import { AppHeader, type SearchHit } from './components/AppHeader'
import { CreateWorkspacePage, WorkspacesPage } from './components/WorkspacePages'

let seq = 0
const nextId = () => `${Date.now()}-${++seq}`
const MAX_CONSOLE = 300

type ModalState = { kind: 'import' } | { kind: 'settings' } | { kind: 'cookies' } | { kind: 'save'; key: string } | { kind: 'mock'; target?: string } | null

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
  /** Dispatch and update stateRef right away, so the next queued operation sees fresh ids. */
  const act = (a: Action) => {
    stateRef.current = reducer(stateRef.current, a)
    dispatch(a)
  }
  // Workspace file operations run one at a time: e.g. Ctrl+S right after a rename must save to the
  // renamed file, not re-create the old one.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(fn, fn)
    chain.current = next.catch(() => undefined)
    return next
  }
  const [panel, setPanel] = useState<Panel>('collections')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [settings, setSettings] = useState<AppSettingsData | null>(null)
  const [resolved, setResolved] = useState<ResolvedVariable[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [modal, setModal] = useState<ModalState>(null)
  // Postman 12's right panel (Variables / Code / Info); open by default, remembered.
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('pm-local.right') !== 'hidden')
  const [rightView, setRightView] = useState<RightView>('variables')
  const showRight = (open: boolean, view?: RightView) => {
    localStorage.setItem('pm-local.right', open ? 'shown' : 'hidden')
    setRightOpen(open)
    if (view) setRightView(view)
  }
  const [searchOpen, setSearchOpen] = useState(false)
  // Postman's workspace pages: "Create your workspace" and "View all workspaces".
  const [page, setPage] = useState<'create' | 'workspaces' | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const refreshWorkspaces = () => window.api.listWorkspaces().then(setWorkspaces, () => undefined)
  // Back/forward through previously active tabs (Postman's ⌘[ / ⌘]).
  const [nav, setNav] = useState<{ back: string[]; forward: string[] }>({ back: [], forward: [] })
  const navLast = useRef<string | null>(null)
  const navJump = useRef(false)
  // Hide the sidebar for more room on small screens or at high zoom (Postman: Ctrl+\).
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('pm-local.sidebar') !== 'hidden')
  const toggleSidebar = () =>
    setSidebarOpen((open) => {
      localStorage.setItem('pm-local.sidebar', open ? 'hidden' : 'shown')
      return !open
    })
  const [mocks, setMocks] = useState<MockInfo[]>([])
  const [mockLogs, setMockLogs] = useState<Record<string, MockLogEntry[]>>({})
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const [captured, setCaptured] = useState<CapturedExchange[]>([])
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
      setMocks(await window.api.listMocks())
      setMockLogs({})
      setConsoleEntries([])
      restoredRoot.current = root
    })
  }, [root, run])

  useEffect(() => {
    if (!root || restoredRoot.current !== root) return
    const t = setTimeout(() => void window.api.saveUiState(toUiState(stateRef.current)).catch(() => undefined), 400)
    return () => clearTimeout(t)
  }, [root, state.tabs, state.activeKey, state.activeEnvironment])

  useEffect(
    () =>
      onMockEvent((e) => {
        if ('log' in e) setMockLogs((prev) => ({ ...prev, [e.id]: [...(prev[e.id] ?? []), e.log].slice(-200) }))
        else setMocks((prev) => prev.map((m) => (m.id === e.id ? { ...m, status: e.status } : m)))
      }),
    [],
  )

  useEffect(
    () =>
      onCaptureEvent((e) => {
        if ('state' in e) return setCapture(e.state)
        setCaptured((prev) => [...prev, e.exchange].slice(-500))
        if (e.savedTo === 'history') window.api.listHistory().then(setHistory, () => undefined)
        else if (e.savedTo) void refreshWorkspace()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    window.api.onBeforeClose(() => {
      const done = () => window.api.closeReady()
      if (!restoredRoot.current) return done()
      window.api.saveUiState(toUiState(stateRef.current)).then(done, done)
    })
  }, [])

  useEffect(() => {
    const prev = navLast.current
    navLast.current = state.activeKey
    if (prev === state.activeKey) return
    if (navJump.current) navJump.current = false
    else if (prev) setNav((n) => ({ back: [...n.back, prev].slice(-50), forward: [] }))
  }, [state.activeKey])
  const live = (keys: string[]) => keys.filter((k) => state.tabs.some((t) => t.key === k) && k !== state.activeKey)
  const navigate = (dir: 'back' | 'forward') => {
    const from = live(nav[dir])
    const target = from.at(-1)
    if (!target) return
    const other = dir === 'back' ? 'forward' : 'back'
    navJump.current = true
    setNav({ [dir]: from.slice(0, -1), [other]: [...nav[other], ...(state.activeKey ? [state.activeKey] : [])] } as typeof nav)
    dispatch({ type: 'activate', key: target })
  }

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
  const switchWorkspace = (open: () => Promise<import('../shared/format/types').WorkspaceInfo | null>) =>
    run(async () => {
      const workspace = await open()
      if (workspace) {
        dispatch({ type: 'workspace', workspace })
        setPage(null)
      }
      setSettings(await window.api.getSettings()) // recent workspaces changed
      void refreshWorkspaces()
    })
  const openWorkspace = () => switchWorkspace(() => window.api.openWorkspaceDialog())
  /** `preview`: single click in the sidebar — reuse the preview tab (Postman). */
  const openRequest = (id: string, preview = false) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === id && t.doc.kind === 'request')
      if (open) return dispatch({ type: 'open', id, doc: open.doc, preview })
      dispatch({ type: 'open', id, doc: { kind: 'request', item: await window.api.readRequest(id) }, preview })
    })
  const openContainer = (id: string, preview = false) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === id && t.doc.kind === 'container')
      if (open) return dispatch({ type: 'open', id, doc: open.doc, preview })
      const isCollection = id.split('/').length === 2
      const [container, variables] = await Promise.all([window.api.readContainer(id), isCollection ? window.api.readVariables(`col:${id}`) : Promise.resolve(null)])
      dispatch({ type: 'open', id, doc: { kind: 'container', container, variables }, preview })
    })
  const openVariables = (scope: string, title: string) =>
    run(async () => {
      const open = stateRef.current.tabs.find((t) => t.id === scope)
      if (open) return dispatch({ type: 'activate', key: open.key })
      dispatch({ type: 'open', id: scope, doc: { kind: 'variables', title, rows: await window.api.readVariables(scope) } })
    })

  // --- saving ---
  const save = (target: Tab) =>
    run(() =>
      serial(async () => {
        // The tab as it is now (a rename may have moved its file since the save was asked for).
        const tab = stateRef.current.tabs.find((t) => t.key === target.key)
        if (!tab) return
        const doc = tab.doc
        if (doc.kind === 'request') {
          if (tab.id === null) return setModal({ kind: 'save', key: tab.key })
          const workspace = await window.api.saveRequest(tab.id, doc.item)
          act({ type: 'saved', key: tab.key, doc })
          act({ type: 'workspace', workspace })
        } else if (doc.kind === 'container') {
          const { auth, event, description } = doc.container
          let workspace = await window.api.saveContainer(tab.id!, { auth, event, description })
          if (doc.variables) {
            await window.api.saveVariables(`col:${tab.id}`, doc.variables)
            workspace = await window.api.refreshWorkspace()
          }
          act({ type: 'saved', key: tab.key, doc })
          act({ type: 'workspace', workspace })
        } else if (doc.kind === 'variables') {
          await window.api.saveVariables(tab.id!, doc.rows)
          act({ type: 'saved', key: tab.key, doc })
        }
        refreshResolved()
      }),
    )

  /** After scripts ran, reload open variable editors that have no unsaved edits. */
  const reloadVariableTabs = () =>
    run(async () => {
      for (const t of stateRef.current.tabs) {
        if (isDirty(t) || !t.id) continue
        if (t.doc.kind === 'variables') {
          const rows = await window.api.readVariables(t.id)
          const latest = stateRef.current.tabs.find((x) => x.key === t.key)?.doc ?? t.doc
          // setDoc, not setRows: a refresh is not a user edit (must not pin a preview tab).
          dispatch({ type: 'setDoc', key: t.key, doc: { ...latest, rows } as TabDoc })
          dispatch({ type: 'saved', key: t.key, doc: { ...latest, rows } as TabDoc })
        } else if (t.doc.kind === 'container' && t.doc.variables) {
          const variables = await window.api.readVariables(`col:${t.id}`)
          const latest = stateRef.current.tabs.find((x) => x.key === t.key)?.doc ?? t.doc
          dispatch({ type: 'setDoc', key: t.key, doc: { ...latest, variables } as TabDoc })
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

  /** Context-menu closes: one confirmation for all unsaved tabs among them. */
  const closeMany = (tabs: Tab[]) => {
    const dirty = tabs.filter(isDirty)
    if (dirty.length && !window.confirm(`${dirty.length} tab${dirty.length > 1 ? 's have' : ' has'} unsaved changes. Close without saving?`)) return
    dispatch({ type: 'closeMany', keys: tabs.map((t) => t.key) })
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
      } else if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (k === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        navigate(e.key === '[' ? 'back' : 'forward')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- sidebar actions ---
  const actions: SidebarActions = {
    openRequest: (id, preview) => void openRequest(id, preview),
    openContainer: (id, preview) => void openContainer(id, preview),
    createCollection: () =>
      void run(() =>
        serial(async () => {
          setPanel('collections')
          const { workspace, id } = await window.api.createCollection('New Collection')
          act({ type: 'workspace', workspace })
          setRenamingId(id)
        }),
      ),
    createFolder: (parentId) =>
      void run(() =>
        serial(async () => {
          const { workspace, id } = await window.api.createFolder(parentId, 'New Folder')
          act({ type: 'workspace', workspace })
          setRenamingId(id)
        }),
      ),
    createRequest: (parentId) =>
      void run(() =>
        serial(async () => {
          const { workspace, id } = await window.api.createRequest(parentId, 'New Request')
          act({ type: 'workspace', workspace })
          await openRequest(id)
          setRenamingId(id)
        }),
      ),
    rename: (id, name) =>
      void run(() =>
        serial(async () => {
          setRenamingId(null)
          const { workspace, id: newId } = await window.api.renameNode(id, name)
          act({ type: 'renamed', id, newId, name })
          act({ type: 'workspace', workspace })
        }),
      ),
    startRename: setRenamingId,
    duplicate: (id) =>
      void run(() =>
        serial(async () => {
          const { workspace } = await window.api.duplicateNode(id)
          act({ type: 'workspace', workspace })
        }),
      ),
    toggleFavorite: (id) => dispatch({ type: 'toggleFavorite', id }),
    openWorkspace: () => void openWorkspace(),
    remove: (id, name) =>
      void run(() =>
        serial(async () => {
          if (!window.confirm(`Delete "${name}"? This removes it from disk.`)) return
          const workspace = await window.api.deleteNode(id)
          act({ type: 'removed', id })
          act({ type: 'workspace', workspace })
        }),
      ),
    exportCollection: (id) => void run(() => window.api.exportCollection(id)),
    runCollection: (id) => dispatch({ type: 'openRunner', target: id }),
    loadTest: (id) => dispatch({ type: 'openLoad', target: id }),
    openVariables: (scope, title) => void openVariables(scope, title),
    createEnvironment: () =>
      void run(() =>
        serial(async () => {
          setPanel('environments')
          const { workspace, id } = await window.api.createEnvironment('New Environment')
          act({ type: 'workspace', workspace })
          await openVariables(`env:${id}`, 'New Environment')
          setRenamingId(id)
        }),
      ),
    renameEnvironment: (id, name) =>
      void run(() =>
        serial(async () => {
          setRenamingId(null)
          const { workspace, id: newId } = await window.api.renameEnvironment(id, name)
          act({ type: 'renamed', id: `env:${id}`, newId: `env:${newId}`, name })
          if (stateRef.current.activeEnvironment === id) act({ type: 'environment', id: newId })
          act({ type: 'workspace', workspace })
        }),
      ),
    deleteEnvironment: (id, name) =>
      void run(() =>
        serial(async () => {
          if (!window.confirm(`Delete environment "${name}"?`)) return
          const workspace = await window.api.deleteEnvironment(id)
          act({ type: 'removed', id: `env:${id}` })
          if (stateRef.current.activeEnvironment === id) act({ type: 'environment', id: null })
          act({ type: 'workspace', workspace })
        }),
      ),
    exportEnvironment: (id) => void run(() => window.api.exportEnvironment(id)),
    setActiveEnvironment: (id) => dispatch({ type: 'environment', id }),
    openHistory: (entry) => dispatch({ type: 'openDraft', item: { ...entry.item, name: rawUrl(entry.item.request.url) || entry.item.name } }),
    deleteHistory: (id) =>
      void run(async () => {
        await window.api.deleteHistory(id)
        setHistory(await window.api.listHistory())
      }),
    openMock: (id, name) => {
      const open = stateRef.current.tabs.find((t) => t.id === id)
      if (open) dispatch({ type: 'activate', key: open.key })
      else dispatch({ type: 'open', id, doc: { kind: 'mock', title: name } })
    },
    createMock: (target) => setModal({ kind: 'mock', target }),
    startMock: (id) => void run(() => window.api.startMock(id)),
    stopMock: (id) => void run(() => window.api.stopMock(id)),
    deleteMock: (id, name) =>
      void run(async () => {
        if (!window.confirm(`Delete mock server "${name}"?`)) return
        setMocks(await window.api.deleteMock(id))
        dispatch({ type: 'removed', id })
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
    if (doc.kind === 'load') {
      return (
        <LoadTestView
          workspace={state.workspace!}
          target={doc.target}
          onTarget={(target) => dispatch({ type: 'openLoad', target })}
          activeEnvironment={state.activeEnvironment}
          onError={fail}
        />
      )
    }
    if (doc.kind === 'capture') {
      return (
        <CaptureView
          state={capture}
          workspace={state.workspace!}
          captured={captured}
          onClear={() => setCaptured([])}
          onOpenInTab={(item) => dispatch({ type: 'openDraft', item })}
          onError={fail}
        />
      )
    }
    if (doc.kind === 'mock') {
      return (
        <MockView
          key={active.key}
          info={mocks.find((m) => m.id === active.id)}
          workspace={state.workspace!}
          logs={mockLogs[active.id!] ?? []}
          onSave={async (def) => {
            setMocks(await window.api.saveMock(active.id!, def))
            dispatch({ type: 'setDoc', key: active.key, doc: { kind: 'mock', title: def.name } })
          }}
          onStart={() => void run(() => window.api.startMock(active.id!))}
          onStop={() => void run(() => window.api.stopMock(active.id!))}
          onClearLog={() => setMockLogs((prev) => ({ ...prev, [active.id!]: [] }))}
          onError={fail}
        />
      )
    }
    if (doc.kind === 'runner') {
      return (
        <RunnerView
          workspace={state.workspace!}
          target={doc.target}
          onTarget={(target) => dispatch({ type: 'openRunner', target })}
          activeEnvironment={state.activeEnvironment}
          onError={fail}
        />
      )
    }
    if (doc.kind === 'request') {
      const path = active.id ? findPath(state.workspace!.collections, active.id) : []
      return (
        <div className="request-area">
        <div className="request-main">
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
              onSaveAs={() => setModal({ kind: 'save', key: active.key })}
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
              past={active.past ?? []}
              onShowPast={(index) => dispatch({ type: 'showReport', key: active.key, index })}
              onClear={() => dispatch({ type: 'clearReport', key: active.key })}
            />
          </Allotment.Pane>
        </Allotment>
        </div>
        </div>
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
          onRun={() => dispatch({ type: 'openRunner', target: active.id! })}
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
      <AppHeader
        workspace={state.workspace}
        title={page === 'workspaces' || (page === 'create' && state.workspace) ? 'Workspaces' : undefined}
        workspaces={workspaces}
        onSwitcherOpen={() => void refreshWorkspaces()}
        onCreateWorkspace={() => setPage('create')}
        onViewAllWorkspaces={() => {
          void refreshWorkspaces()
          setPage('workspaces')
        }}
        canBack={live(nav.back).length > 0}
        canForward={live(nav.forward).length > 0}
        onBack={() => navigate('back')}
        onForward={() => navigate('forward')}
        onOpenRecent={(dir) => void switchWorkspace(() => window.api.openRecentWorkspace(dir))}
        onSettings={() => setModal({ kind: 'settings' })}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        onPick={(hit: SearchHit) => {
          if (hit.kind === 'request') void openRequest(hit.id)
          else if (hit.kind === 'environment') void openVariables(`env:${hit.id}`, hit.name)
          else void openContainer(hit.id)
        }}
      />

      {page === 'workspaces' ? (
        <WorkspacesPage
          current={state.workspace?.root ?? null}
          workspaces={workspaces}
          onOpen={(dir) => void (dir === state.workspace?.root ? setPage(null) : switchWorkspace(() => window.api.openRecentWorkspace(dir)))}
          onForget={(dir) => void run(async () => (await window.api.forgetWorkspace(dir), await refreshWorkspaces()))}
          onCreate={() => setPage('create')}
        />
      ) : page === 'create' || !state.workspace ? (
        <CreateWorkspacePage
          onCancel={state.workspace ? () => setPage(null) : undefined}
          onOpenExisting={() => void openWorkspace()}
          onCreated={(workspace) => {
            dispatch({ type: 'workspace', workspace })
            setPage(null)
            void refreshWorkspaces()
            void window.api.getSettings().then(setSettings)
          }}
        />
      ) : state.workspace ? (
        <div className="main">
          <Allotment vertical proportionalLayout={false}>
            <Allotment.Pane>
              <Allotment proportionalLayout={false}>
                <Allotment.Pane preferredSize={340} minSize={240} maxSize={640} visible={sidebarOpen}>
                  <Sidebar
                    workspace={state.workspace}
                    panel={panel}
                    setPanel={setPanel}
                    activeId={active?.id ?? null}
                    renamingId={renamingId}
                    activeEnvironment={state.activeEnvironment}
                    favorites={state.favorites}
                    history={history}
                    mocks={mocks}
                    actions={actions}
                  />
                </Allotment.Pane>
                <Allotment.Pane>
                  <div className="workbench">
                    <TabsBar
                      tabs={state.tabs}
                      activeKey={state.activeKey}
                      onActivate={(key) => dispatch({ type: 'activate', key })}
                      onPin={(key) => dispatch({ type: 'pin', key })}
                      onClose={close}
                      onCloseMany={closeMany}
                      onNew={newRequestTab}
                      environments={state.workspace.environments}
                      activeEnvironment={state.activeEnvironment}
                      onEnvironment={(id) => dispatch({ type: 'environment', id })}
                      onShowVariables={() => showRight(!(rightOpen && rightView === 'variables'), 'variables')}
                    />
                    <div className="workbench-content">{content()}</div>
                  </div>
                </Allotment.Pane>
                <Allotment.Pane preferredSize={300} minSize={220} maxSize={640} visible={rightOpen}>
                  <RightPanel
                    view={rightView}
                    setView={setRightView}
                    onClose={() => showRight(false)}
                    active={active}
                    resolved={resolved}
                    environmentId={state.activeEnvironment}
                    environmentName={state.workspace.environments.find((e) => e.id === state.activeEnvironment)?.name ?? null}
                    onEdit={(scope) => {
                      const ws = state.workspace!
                      if (scope === 'globals') return void openVariables('globals', 'Globals')
                      if (scope === 'environment') {
                        const env = ws.environments.find((e) => e.id === state.activeEnvironment)
                        return void (env && openVariables(`env:${env.id}`, env.name))
                      }
                      const col = active?.id?.startsWith('collections/') ? active.id.split('/').slice(0, 2).join('/') : null
                      if (col) void openContainer(col)
                    }}
                  />
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>
            <Allotment.Pane visible={consoleOpen} preferredSize={260} minSize={120}>
              <Console entries={consoleEntries} onClear={() => setConsoleEntries([])} onClose={() => setConsoleOpen(false)} />
            </Allotment.Pane>
          </Allotment>
        </div>
      ) : null}

      <footer className="status-bar">
        <button className={`status-btn${sidebarOpen ? '' : ' active'}`} aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} title="Toggle sidebar (Ctrl+\\)" disabled={!state.workspace} onClick={toggleSidebar}>
          <PanelLeft size={12} />
        </button>
        <button className={`status-btn${consoleOpen ? ' active' : ''}`} onClick={() => setConsoleOpen(!consoleOpen)} disabled={!state.workspace}>
          <Terminal size={12} /> Console
        </button>
        <span className="spacer" />
        <button
          className="status-btn"
          disabled={!state.workspace?.collections.length}
          onClick={() => state.workspace?.collections[0] && dispatch({ type: 'openRunner', target: active?.doc.kind === 'runner' ? active.doc.target : state.workspace.collections[0].id })}
        >
          <PlayCircle size={12} /> Runner
        </button>
        <button
          className={`status-btn${capture?.running ? ' active' : ''}`}
          disabled={!state.workspace}
          onClick={() => {
            void run(async () => setCapture(await window.api.captureState()))
            const open = state.tabs.find((t) => t.doc.kind === 'capture')
            if (open) dispatch({ type: 'activate', key: open.key })
            else dispatch({ type: 'open', id: 'capture', doc: { kind: 'capture' } })
          }}
        >
          <Radio size={12} /> {capture?.running ? `Capturing :${capture.port}` : 'Capture'}
        </button>
        <button className="status-btn" disabled={!state.workspace} onClick={() => void openVariables('globals', 'Globals')}>
          <Globe size={12} /> Globals
        </button>
        <button className="status-btn" disabled={!state.workspace} onClick={() => setModal({ kind: 'cookies' })}>
          <Cookie size={12} /> Cookies
        </button>
        <button className={`status-btn${rightOpen ? ' active' : ''}`} aria-label={rightOpen ? 'Hide right panel' : 'Show right panel'} title="Toggle right panel" disabled={!state.workspace} onClick={() => showRight(!rightOpen)}>
          <PanelRight size={12} />
        </button>
      </footer>

      {modal?.kind === 'import' && <ImportModal onClose={() => setModal(null)} onImported={(r) => void onImported(r)} />}
      {modal?.kind === 'settings' && <SettingsModal onClose={() => setModal(null)} onSaved={setSettings} />}
      {modal?.kind === 'cookies' && <CookiesModal onClose={() => setModal(null)} />}
      {modal?.kind === 'mock' && state.workspace && (
        <CreateMockModal
          workspace={state.workspace}
          existingPorts={mocks.map((m) => m.def.port)}
          defaultTarget={modal.target}
          onClose={() => setModal(null)}
          onCreate={async (def) => {
            const created = await run(() => window.api.createMock(def))
            if (!created) return
            setMocks(created.mocks)
            setModal(null)
            setPanel('mocks')
            dispatch({ type: 'open', id: created.id, doc: { kind: 'mock', title: def.name } })
          }}
        />
      )}
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
