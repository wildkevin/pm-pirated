import { Check, Folder, FolderOpen, LayoutGrid, MoreHorizontal, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorkspaceInfo } from '../../shared/format/types'
import type { CreateWorkspaceInput, WorkspaceListItem } from '../../shared/ipc'
import { cleanError } from '../lib/body'
import { Menu } from './common/ui'

const baseName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

/** Postman 12's "Create your workspace" page, with a folder location instead of team access. */
export function CreateWorkspacePage({ onCancel, onCreated, onOpenExisting }: { onCancel?(): void; onCreated(ws: WorkspaceInfo): void; onOpenExisting(): void }) {
  const [name, setName] = useState('')
  const [setup, setSetup] = useState<'blank' | 'folder'>('blank')
  const [location, setLocation] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void window.api.defaultWorkspaceLocation().then(setLocation), [])

  const pick = async (purpose: 'location' | 'existing') => {
    const dir = await window.api.pickFolder(purpose)
    if (!dir) return
    if (purpose === 'location') setLocation(dir)
    else {
      setFolder(dir)
      setSetup('folder')
      if (!name.trim()) setName(baseName(dir))
    }
  }
  const ready = !!name.trim() && (setup === 'blank' ? !!location : !!folder) && !busy
  const create = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const input: CreateWorkspaceInput = setup === 'blank' ? { name: name.trim(), setup, location } : { name: name.trim(), setup, folder: folder! }
      onCreated(await window.api.createWorkspace(input))
    } catch (e) {
      setError(cleanError(e))
      setBusy(false)
    }
  }

  return (
    <div className="ws-page">
      <form
        className="ws-create"
        aria-label="Create your workspace"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <h1>Create your workspace</h1>
        <label className="ws-field">
          <span>Workspace name</span>
          <input className="input" autoFocus placeholder="A team name, project or service..." value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="ws-field">
          <span id="ws-location-label">Location</span>
          <div className="ws-location" aria-labelledby="ws-location-label">
            <Folder size={14} />
            <span className="ws-location-path" title={location}>
              {setup === 'blank' ? `${location}${location.includes('\\') ? '\\' : '/'}${name.trim() || '…'}` : (folder ?? 'Choose a folder below')}
            </span>
            {setup === 'blank' && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void pick('location')}>
                Change…
              </button>
            )}
          </div>
        </div>
        <div className="ws-field">
          <span>Choose how you'd like to set up this workspace</span>
          <div className="ws-cards" role="radiogroup" aria-label="Workspace setup">
            <div role="radio" aria-checked={setup === 'blank'} tabIndex={0} className={`ws-card${setup === 'blank' ? ' selected' : ''}`} onClick={() => setSetup('blank')} onKeyDown={(e) => e.key === ' ' && setSetup('blank')}>
              <div className="ws-card-head">
                <LayoutGrid size={16} />
                <span>Blank workspace</span>
                <span className="ws-radio">{setup === 'blank' && <Check size={11} strokeWidth={3} />}</span>
              </div>
              <p>I want to start from scratch.</p>
            </div>
            <div role="radio" aria-checked={setup === 'folder'} tabIndex={0} className={`ws-card${setup === 'folder' ? ' selected' : ''}`} onClick={() => setSetup('folder')} onKeyDown={(e) => e.key === ' ' && setSetup('folder')}>
              <div className="ws-card-head">
                <Folder size={16} />
                <span>From a local folder</span>
                <span className="ws-radio">{setup === 'folder' && <Check size={11} strokeWidth={3} />}</span>
              </div>
              <p>I want to connect my existing project folder.</p>
              <button
                type="button"
                className="btn btn-secondary ws-choose"
                onClick={(e) => {
                  e.stopPropagation()
                  void pick('existing')
                }}
              >
                <FolderOpen size={14} /> {folder ? baseName(folder) : 'Choose a folder'}
              </button>
            </div>
          </div>
        </div>
        {error && (
          <div className="ws-error" role="alert">
            {error}
          </div>
        )}
        <div className="ws-actions">
          {!onCancel && (
            <button type="button" className="link-btn ws-open-existing" onClick={onOpenExisting}>
              Open an existing workspace folder…
            </button>
          )}
          <span className="spacer" />
          {onCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-brand" disabled={!ready}>
            Create Workspace
          </button>
        </div>
      </form>
    </div>
  )
}

/** "View all workspaces": the recent workspace folders. */
export function WorkspacesPage({ current, workspaces, onOpen, onForget, onCreate }: { current: string | null; workspaces: WorkspaceListItem[]; onOpen(root: string): void; onForget(root: string): void; onCreate(): void }) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ root: string; x: number; y: number } | null>(null)
  const q = query.trim().toLowerCase()
  const shown = workspaces.filter((w) => !q || `${w.name ?? ''} ${w.root}`.toLowerCase().includes(q))
  return (
    <div className="ws-page">
      <div className="ws-list">
        <div className="ws-list-head">
          <h1>Workspaces</h1>
          <span className="spacer" />
          <button className="btn btn-brand" onClick={onCreate}>
            Create workspace
          </button>
        </div>
        <label className="ws-search">
          <Search size={13} />
          <input aria-label="Search workspaces" placeholder="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <table className="ws-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Location</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.root} className={w.name ? '' : 'missing'}>
                <td>
                  <button className="ws-name" disabled={!w.name} onClick={() => onOpen(w.root)}>
                    <span className="ws-icon">
                      <Folder size={14} />
                    </span>
                    <span>
                      <span className="ws-name-text">{w.name ?? baseName(w.root)}</span>
                      <span className="ws-sub">{w.root === current ? 'Open now' : w.name ? 'Local' : 'Folder not found'}</span>
                    </span>
                  </button>
                </td>
                <td className="ws-path" title={w.root}>
                  {w.root}
                </td>
                <td className="ws-row-actions">
                  <button className="btn-icon" aria-label={`Actions for ${w.name ?? baseName(w.root)}`} onClick={(e) => setMenu({ root: w.root, x: e.currentTarget.getBoundingClientRect().right - 180, y: e.currentTarget.getBoundingClientRect().bottom + 4 })}>
                    <MoreHorizontal size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={3} className="ws-empty">
                  {workspaces.length ? 'No workspaces match.' : 'No workspaces yet. Create one to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {menu && (
        <Menu
          style={{ left: menu.x, top: menu.y }}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', disabled: !workspaces.find((w) => w.root === menu.root)?.name, onClick: () => onOpen(menu.root) },
            'separator',
            { label: 'Remove from list', danger: true, disabled: menu.root === current, onClick: () => onForget(menu.root) },
          ]}
        />
      )}
    </div>
  )
}
