import type { PmItem } from './format/types'

export type SendResult =
  | {
      ok: true
      code: number
      status: string
      headers: { key: string; value: string }[]
      body: Uint8Array
      /** Bytes on the wire: headers + body. */
      size: number
      timeMs: number
    }
  | { ok: false; error: string; code?: string }

export type EngineRequest =
  | { type: 'send'; id: string; item: PmItem; timeoutMs: number }
  | { type: 'cancel'; id: string }

export interface EngineReply {
  id: string
  result: SendResult
}
