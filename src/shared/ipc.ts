// The only surface the renderer can reach (exposed as window.api by the preload).
import type { SendResult } from './engine'
import type { PmItem, WorkspaceInfo } from './format/types'

export interface Created {
  workspace: WorkspaceInfo
  id: string
}

export interface Api {
  /** Folder picker; opens the folder as a workspace, initialising it if needed. */
  openWorkspaceDialog(): Promise<WorkspaceInfo | null>
  /** The most recently used workspace, reopened at startup. */
  currentWorkspace(): Promise<WorkspaceInfo | null>
  createCollection(name: string): Promise<Created>
  createFolder(parentId: string, name: string): Promise<Created>
  createRequest(parentId: string, name: string): Promise<Created>
  /** Returns the node's new id (its file/folder is renamed to match). */
  renameNode(id: string, name: string): Promise<Created>
  deleteNode(id: string): Promise<WorkspaceInfo>
  readRequest(id: string): Promise<PmItem>
  saveRequest(id: string, item: PmItem): Promise<WorkspaceInfo>
  sendRequest(sendId: string, item: PmItem): Promise<SendResult>
  cancelRequest(sendId: string): Promise<void>
}

export const CHANNELS = {
  openWorkspaceDialog: 'workspace:openDialog',
  currentWorkspace: 'workspace:current',
  createCollection: 'node:createCollection',
  createFolder: 'node:createFolder',
  createRequest: 'node:createRequest',
  renameNode: 'node:rename',
  deleteNode: 'node:delete',
  readRequest: 'request:read',
  saveRequest: 'request:save',
  sendRequest: 'request:send',
  cancelRequest: 'request:cancel',
} as const satisfies Record<keyof Api, string>
