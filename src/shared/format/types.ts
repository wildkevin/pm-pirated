// Subset of the Postman v2.1 collection format used by PM Local. Unknown fields are kept as-is.

export const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

export interface PmHeader {
  key: string
  value: string
  disabled?: boolean
}

export interface PmBody {
  mode: 'raw'
  raw: string
  options?: { raw?: { language?: 'json' | 'text' } }
}

export interface PmRequest {
  method: string
  url: string
  header: PmHeader[]
  body?: PmBody
  [extra: string]: unknown
}

export interface PmItem {
  name: string
  request: PmRequest
  response?: unknown[]
  [extra: string]: unknown
}

export type NodeKind = 'collection' | 'folder' | 'request'

export interface TreeNode {
  kind: NodeKind
  /** Path relative to the workspace root, with forward slashes. */
  id: string
  name: string
  method?: string
  children?: TreeNode[]
  /** Set when the node's file could not be read; shown as a red badge. */
  error?: string
}

export interface WorkspaceInfo {
  root: string
  name: string
  collections: TreeNode[]
}
