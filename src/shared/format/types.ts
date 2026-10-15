// Subset of the Postman v2.1 collection format used by PM Local. Unknown fields are kept as-is.

export const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

export interface PmKeyValue {
  key: string
  value: string
  disabled?: boolean
  description?: string
}
/** Kept for M1 call sites. */
export type PmHeader = PmKeyValue

export interface PmFormParam extends PmKeyValue {
  type?: 'text' | 'file'
  /** File path(s) for type 'file'. */
  src?: string | string[] | null
}

export type RawLanguage = 'json' | 'text' | 'javascript' | 'html' | 'xml'

export type PmBody =
  | { mode: 'raw'; raw: string; options?: { raw?: { language?: RawLanguage } } }
  | { mode: 'urlencoded'; urlencoded: PmKeyValue[] }
  | { mode: 'formdata'; formdata: PmFormParam[] }
  | { mode: 'file'; file: { src?: string | null } }
  | { mode: 'graphql'; graphql: { query: string; variables?: string } }

export type BodyMode = PmBody['mode']

/** v2.1 auth: `{ type: 'bearer', bearer: [{ key: 'token', value: '…' }] }`. Absent = inherit from parent. */
export interface PmAuthAttribute {
  key: string
  value: unknown
  type?: string
}
export interface PmAuth {
  type: string
  [type: string]: string | PmAuthAttribute[] | undefined
}

export interface PmScript {
  exec: string[]
  type?: string
}
export interface PmEvent {
  listen: 'prerequest' | 'test'
  script: PmScript
}

export type PmUrl = string | { raw: string; query?: PmKeyValue[]; variable?: PmKeyValue[]; [extra: string]: unknown }

export interface PmRequest {
  method: string
  url: PmUrl
  header: PmKeyValue[]
  body?: PmBody
  auth?: PmAuth
  description?: string
  [extra: string]: unknown
}

export interface PmItem {
  name: string
  request: PmRequest
  response?: unknown[]
  event?: PmEvent[]
  protocolProfileBehavior?: Record<string, unknown>
  [extra: string]: unknown
}

export interface PmVariable {
  key: string
  value: string
  /** 'secret' values are never written to workspace files. */
  type?: 'default' | 'secret' | string
  enabled?: boolean
  disabled?: boolean
  description?: string
}

/** collection.json (without `item`) or folder.json — the parts that matter when running. */
export interface PmContainer {
  name: string
  auth?: PmAuth
  event?: PmEvent[]
  /** Collection only. */
  variable?: PmVariable[]
  description?: string
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

export interface EnvironmentInfo {
  /** Path relative to the workspace root, e.g. `environments/Dev.env.json`. */
  id: string
  name: string
  error?: string
}

export interface WorkspaceInfo {
  root: string
  name: string
  collections: TreeNode[]
  environments: EnvironmentInfo[]
}
