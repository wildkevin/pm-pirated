import { z } from 'zod'
import type { Api } from '../shared/ipc'

const id = z.string().min(1).max(2000)
const name = z.string().trim().min(1).max(200)
const text = z.string().max(50_000_000)
const kv = z.looseObject({ key: z.string(), value: z.string(), disabled: z.boolean().optional() })

const url = z.union([z.string().max(100_000), z.looseObject({ raw: z.string().max(100_000), query: z.array(kv).optional(), variable: z.array(kv).optional() })])
const body = z.looseObject({ mode: z.enum(['raw', 'urlencoded', 'formdata', 'file', 'graphql']) })
const auth = z.looseObject({ type: z.string().min(1).max(40) })
// Postman exports allow events without scripts and `exec` as a string or a list.
const event = z.looseObject({ listen: z.string(), script: z.looseObject({ exec: z.union([z.string(), z.array(z.string())]).optional() }).optional() })

export const pmItem = z.looseObject({
  name,
  request: z.looseObject({ method: z.string().min(1).max(32), url, header: z.array(kv), body: body.optional(), auth: auth.optional() }),
  event: z.array(event).optional(),
})

const container = z.object({ auth: auth.optional(), event: z.array(event).optional(), description: z.string().max(1_000_000).optional() })
const scope = z.string().regex(/^(globals|env:.+|col:.+)$/)
const variableRow = z.object({ key: z.string().max(1000), type: z.enum(['default', 'secret']), initial: text, current: text, enabled: z.boolean() })
const uiState = z.object({
  activeEnvironment: z.string().nullable(),
  tabs: z.array(z.object({ id: z.string().nullable(), item: pmItem, saved: z.string().optional() })).max(200),
  activeIndex: z.number().int(),
})

const userPass = z.object({ enabled: z.boolean(), username: z.string(), password: z.string() })
const settings = z.object({
  recentWorkspaces: z.array(z.string()),
  general: z.object({
    timeoutMs: z.number().int().min(0),
    maxResponseSizeMb: z.number().min(0),
    sslVerification: z.boolean(),
    followRedirects: z.boolean(),
    sendPostmanToken: z.boolean(),
    allowFilesOutsideWorkingDir: z.boolean(),
  }),
  proxy: z.object({
    useSystemProxy: z.boolean(),
    respectEnvVars: z.boolean(),
    auth: userPass,
    custom: z.object({
      enabled: z.boolean(),
      http: z.boolean(),
      https: z.boolean(),
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      auth: userPass,
      bypass: z.string(),
    }),
  }),
  certificates: z.object({
    useSystemStore: z.boolean(),
    ca: z.object({ enabled: z.boolean(), file: z.string() }),
    client: z.array(
      z.object({ host: z.string(), cert: z.string().optional(), key: z.string().optional(), pfx: z.string().optional(), passphrase: z.string().optional() }),
    ),
  }),
})

/** Argument schemas per API method; every IPC call is parsed against these in main. */
export const ARGS = {
  openWorkspaceDialog: z.tuple([]),
  currentWorkspace: z.tuple([]),
  refreshWorkspace: z.tuple([]),
  createCollection: z.tuple([name]),
  createFolder: z.tuple([id, name]),
  createRequest: z.tuple([id, name, pmItem.optional()]),
  renameNode: z.tuple([id, name]),
  deleteNode: z.tuple([id]),
  readRequest: z.tuple([id]),
  saveRequest: z.tuple([id, pmItem]),
  readContainer: z.tuple([id]),
  saveContainer: z.tuple([id, container]),
  readVariables: z.tuple([scope]),
  saveVariables: z.tuple([scope, z.array(variableRow)]),
  createEnvironment: z.tuple([name]),
  renameEnvironment: z.tuple([id, name]),
  deleteEnvironment: z.tuple([id]),
  readUiState: z.tuple([]),
  saveUiState: z.tuple([uiState]),
  sendRequest: z.tuple([id, id.nullable(), pmItem, id.nullable()]),
  cancelRequest: z.tuple([id]),
  resolveVariables: z.tuple([id.nullable(), id.nullable()]),
  listHistory: z.tuple([]),
  deleteHistory: z.tuple([id.optional()]),
  listCookies: z.tuple([]),
  deleteCookies: z.tuple([z.string().min(1), z.string().optional(), z.string().optional()]),
  setCookie: z.tuple([z.string().url(), z.string().min(1).max(10_000)]),
  importFiles: z.tuple([]),
  importText: z.tuple([text]),
  exportCollection: z.tuple([id]),
  exportEnvironment: z.tuple([id]),
  getSettings: z.tuple([]),
  saveSettings: z.tuple([settings]),
  pickFile: z.tuple([z.string().max(200)]),
  saveResponseBody: z.tuple([z.string().max(255), z.instanceof(Uint8Array)]),
  getOAuth2Token: z.tuple([z.record(z.string(), z.string().max(10_000))]),
} satisfies Record<keyof Api, z.ZodType>
