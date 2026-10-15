import { z } from 'zod'
import type { Api } from '../shared/ipc'

const id = z.string().min(1).max(2000)
const name = z.string().trim().min(1).max(200)
const header = z.object({ key: z.string(), value: z.string(), disabled: z.boolean().optional() })
const body = z.looseObject({
  mode: z.literal('raw'),
  raw: z.string(),
  options: z.looseObject({ raw: z.looseObject({ language: z.enum(['json', 'text']).optional() }).optional() }).optional(),
})

export const pmItem = z.looseObject({
  name,
  request: z.looseObject({
    method: z.string().min(1).max(32),
    url: z.string().max(100_000),
    header: z.array(header),
    body: body.optional(),
  }),
})

/** Argument schemas per API method; every IPC call is parsed against these in main. */
export const ARGS = {
  openWorkspaceDialog: z.tuple([]),
  currentWorkspace: z.tuple([]),
  createCollection: z.tuple([name]),
  createFolder: z.tuple([id, name]),
  createRequest: z.tuple([id, name]),
  renameNode: z.tuple([id, name]),
  deleteNode: z.tuple([id]),
  readRequest: z.tuple([id]),
  saveRequest: z.tuple([id, pmItem]),
  sendRequest: z.tuple([id, pmItem]),
  cancelRequest: z.tuple([id]),
} satisfies Record<keyof Api, z.ZodType>
