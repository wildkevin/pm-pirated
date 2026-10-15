import { Allotment } from 'allotment'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PmItem } from '../shared/format/types'
import { RequestEditor } from './components/RequestEditor'
import { ResponseViewer } from './components/ResponseViewer'
import { Sidebar } from './components/Sidebar'
import { TabsBar } from './components/TabsBar'
import { cleanError } from './lib/body'
import { initialState, isDirty, reducer, type Tab } from './state'

let sendSeq = 0

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

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

  useEffect(() => {
    void run(async () => dispatch({ type: 'workspace', workspace: await window.api.currentWorkspace() }))
  }, [run])

  const openWorkspace = () =>
    run(async () => {
      const workspace = await window.api.openWorkspaceDialog()
      if (workspace) dispatch({ type: 'workspace', workspace })
    })

  const openRequest = (id: string) =>
    run(async () => {
      if (stateRef.current.tabs.some((t) => t.id === id)) return dispatch({ type: 'activate', id })
      dispatch({ type: 'open', id, item: await window.api.readRequest(id) })
    })

  const save = (tab: Tab) =>
    run(async () => {
      const workspace = await window.api.saveRequest(tab.id, tab.item)
      dispatch({ type: 'saved', id: tab.id, item: tab.item })
      dispatch({ type: 'workspace', workspace })
    })

  const send = (tab: Tab) => {
    const sendId = `${Date.now()}-${++sendSeq}`
    dispatch({ type: 'sendStart', id: tab.id, sendId })
    void window.api
      .sendRequest(sendId, tab.item)
      .catch((e) => ({ ok: false as const, error: cleanError(e) }))
      .then((result) => dispatch({ type: 'sendDone', id: tab.id, sendId, result }))
  }

  const cancel = (tab: Tab) => {
    if (tab.sendId) void window.api.cancelRequest(tab.sendId)
  }

  const close = (tab: Tab) => {
    if (isDirty(tab) && !window.confirm(`"${tab.item.name}" has unsaved changes. Close without saving?`)) return
    dispatch({ type: 'close', id: tab.id })
  }

  const active = state.tabs.find((t) => t.id === state.activeId)

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Enter sends — same shortcuts as Postman.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId)
      if (!tab || !(e.ctrlKey || e.metaKey)) return
      if (e.key === 's') {
        e.preventDefault()
        void save(tab)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (!tab.sendId) send(tab)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sidebarActions = {
    open: openRequest,
    createCollection: () =>
      run(async () => {
        const { workspace, id } = await window.api.createCollection('New Collection')
        dispatch({ type: 'workspace', workspace })
        setRenamingId(id)
      }),
    createFolder: (parentId: string) =>
      run(async () => {
        const { workspace, id } = await window.api.createFolder(parentId, 'New Folder')
        dispatch({ type: 'workspace', workspace })
        setRenamingId(id)
      }),
    createRequest: (parentId: string) =>
      run(async () => {
        const { workspace, id } = await window.api.createRequest(parentId, 'New Request')
        dispatch({ type: 'workspace', workspace })
        await openRequest(id)
        setRenamingId(id)
      }),
    rename: (id: string, name: string) =>
      run(async () => {
        setRenamingId(null)
        const { workspace, id: newId } = await window.api.renameNode(id, name)
        dispatch({ type: 'renamed', id, newId, name })
        dispatch({ type: 'workspace', workspace })
      }),
    startRename: setRenamingId,
    remove: (id: string, name: string) =>
      run(async () => {
        if (!window.confirm(`Delete "${name}"? This removes it from disk.`)) return
        const workspace = await window.api.deleteNode(id)
        dispatch({ type: 'removed', id })
        dispatch({ type: 'workspace', workspace })
      }),
  }

  return (
    <div className="app">
      <header className="header">
        <span className="brand">PM Local</span>
        <span className="header-spacer" />
        {state.workspace && <span className="header-workspace">{state.workspace.name}</span>}
        <button className="btn btn-secondary" onClick={() => void openWorkspace()}>
          <FolderOpen size={14} /> Open workspace
        </button>
      </header>

      {state.workspace ? (
        <div className="main">
          <Allotment proportionalLayout={false}>
            <Allotment.Pane preferredSize={300} minSize={220} maxSize={600}>
              <Sidebar
                workspace={state.workspace}
                activeId={state.activeId}
                renamingId={renamingId}
                actions={sidebarActions}
              />
            </Allotment.Pane>
            <Allotment.Pane>
              <div className="workbench">
                <TabsBar
                  tabs={state.tabs}
                  activeId={state.activeId}
                  onActivate={(id) => dispatch({ type: 'activate', id })}
                  onClose={close}
                />
                {active ? (
                  <Allotment vertical key={active.key}>
                    <Allotment.Pane minSize={160}>
                      <RequestEditor
                        tab={active}
                        onChange={(item: PmItem) => dispatch({ type: 'edit', id: active.id, item })}
                        onSend={() => send(active)}
                        onCancel={() => cancel(active)}
                        onSave={() => void save(active)}
                      />
                    </Allotment.Pane>
                    <Allotment.Pane minSize={120}>
                      <ResponseViewer tab={active} onCancel={() => cancel(active)} />
                    </Allotment.Pane>
                  </Allotment>
                ) : (
                  <div className="empty-state">Open a request from the sidebar, or create one with the … menu.</div>
                )}
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
      ) : (
        <div className="welcome">
          <h1>Welcome to PM Local</h1>
          <p>
            A workspace is a folder on your computer. Collections and requests are stored in it as plain JSON files
            you can version with git.
          </p>
          <button className="btn btn-primary" onClick={() => void openWorkspace()}>
            <FolderOpen size={14} /> Open workspace
          </button>
        </div>
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
