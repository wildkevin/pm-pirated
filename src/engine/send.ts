import runtime from 'postman-runtime'
import { Collection } from 'postman-collection'
import type { PmItem } from '../shared/format/types'
import type { SendResult } from '../shared/engine'

export interface SendHandle {
  result: Promise<SendResult>
  cancel(): void
}

const CANCELLED: SendResult = { ok: false, error: 'Request cancelled' }

// postman-request silently routes through *_proxy env vars (even for 127.0.0.1).
// ponytail: cleared until M2 adds explicit proxy settings from the system/app config.
export function clearProxyEnv(): void {
  for (const key of Object.keys(process.env)) if (/^(http|https|all|no)_proxy$/i.test(key)) delete process.env[key]
}

/** Like Postman: a URL typed without a scheme is sent over http. */
export function ensureProtocol(url: string): string {
  const u = url.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('{{') ? u : `http://${u}`
}

function toResult(res: any): SendResult {
  const body: Buffer = res.stream ?? Buffer.alloc(0)
  return {
    ok: true,
    code: res.code,
    status: res.status,
    headers: res.headers.all().map((h: { key: string; value: string }) => ({ key: h.key, value: h.value })),
    body: new Uint8Array(body),
    size: res.size().total,
    timeMs: res.responseTime,
  }
}

export function startSend(item: PmItem, opts: { timeoutMs: number }): SendHandle {
  let resolve!: (r: SendResult) => void
  const result = new Promise<SendResult>((r) => (resolve = r))
  let settled = false
  const finish = (r: SendResult) => {
    if (!settled) (settled = true), resolve(r)
  }
  let run: { abort(): void } | undefined
  let cancelled = false

  if (!item.request.url.trim()) {
    finish({ ok: false, error: 'Enter a URL' })
    return { result, cancel: () => undefined }
  }

  const prepared: PmItem = { ...item, request: { ...item.request, url: ensureProtocol(item.request.url) } }
  const collection = new Collection({ item: [prepared] } as ConstructorParameters<typeof Collection>[0])
  new runtime.Runner().run(collection, { timeout: { request: opts.timeoutMs } }, (err, r) => {
    if (err) return finish({ ok: false, error: err.message })
    if (cancelled) return finish(CANCELLED)
    run = r
    let last: SendResult = { ok: false, error: 'No response received' }
    r.start({
      response(err: NodeJS.ErrnoException | null, _cursor: unknown, res: unknown) {
        last = err ? { ok: false, error: err.message, code: err.code } : toResult(res)
      },
      done(err: Error | null) {
        finish(err ? { ok: false, error: err.message } : last)
      },
    })
  })

  return {
    result,
    cancel() {
      cancelled = true
      run?.abort()
      finish(CANCELLED)
    },
  }
}
