import { Save } from 'lucide-react'
import { useState } from 'react'
import type { PmAuth, PmContainer } from '../../shared/format/types'
import type { VariableRow } from '../../shared/ipc'
import type { TabDoc } from '../state'
import { AuthEditor } from './request/AuthEditor'
import { ScriptEditor } from './request/ScriptEditor'
import { VariablesEditor } from './VariablesEditor'

type Container = Extract<TabDoc, { kind: 'container' }>
type Section = 'overview' | 'auth' | 'prerequest' | 'test' | 'variables'

interface Props {
  doc: Container
  isCollection: boolean
  onPatch(patch: Partial<PmContainer>): void
  onVariables(rows: VariableRow[]): void
  onSave(): void
  onGetOAuth2Token(auth: PmAuth): Promise<void>
}

/** Collection / folder tab: Overview, Authorization, Pre-request Script, Tests, Variables (collections). */
export function ContainerEditor({ doc, isCollection, onPatch, onVariables, onSave, onGetOAuth2Token }: Props) {
  const [section, setSection] = useState<Section>('overview')
  const c = doc.container
  const set = onPatch
  const sections: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'auth', label: 'Authorization' },
    { id: 'prerequest', label: 'Pre-request Script' },
    { id: 'test', label: 'Tests' },
    ...(isCollection ? [{ id: 'variables' as const, label: 'Variables' }] : []),
  ]
  return (
    <div className="editor container-editor">
      <div className="editor-title">
        <span className="editor-name">{c.name}</span>
        <button className="btn btn-ghost" onClick={onSave} title="Save (Ctrl+S)">
          <Save size={14} /> Save
        </button>
      </div>
      <div className="subtabs" role="tablist">
        {sections.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="subtab-panel">
        {section === 'overview' && (
          <textarea
            aria-label="Description"
            className="input textarea description"
            placeholder={`Add a description for this ${isCollection ? 'collection' : 'folder'}`}
            value={c.description ?? ''}
            onChange={(e) => set({ description: e.target.value || undefined })}
          />
        )}
        {section === 'auth' && (
          <>
            <p className="muted">
              This authorization method will be used for every request in this {isCollection ? 'collection' : 'folder'}. You can override this by specifying one in the request.
            </p>
            <AuthEditor auth={c.auth} canInherit={!isCollection} onChange={(auth) => set({ auth })} onGetOAuth2Token={onGetOAuth2Token} />
          </>
        )}
        {(section === 'prerequest' || section === 'test') && (
          <>
            <p className="muted">
              {section === 'prerequest'
                ? `This script will execute before every request in this ${isCollection ? 'collection' : 'folder'}.`
                : `These tests will execute after every request in this ${isCollection ? 'collection' : 'folder'}.`}
            </p>
            <ScriptEditor key={section} events={c.event} listen={section} onChange={(event) => set({ event })} />
          </>
        )}
        {section === 'variables' && doc.variables && (
          <>
            <p className="muted">These variables are specific to this collection and its requests.</p>
            <VariablesEditor rows={doc.variables} onChange={onVariables} />
          </>
        )}
      </div>
    </div>
  )
}
