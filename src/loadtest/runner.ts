// Load test: virtual users each loop the collection; a scheduler follows the load profile every second.
import { CookieJar } from '@postman/tough-cookie'
import { availableParallelism } from 'node:os'
import runtime from 'postman-runtime'
import { Collection, VariableScope } from 'postman-collection'
import type { LoadSpec } from '../shared/engine'
import { runtimeOptions, type SendDeps } from '../engine/send'
import { summarize, tickOf, type LoadSummary, type Sample, type Tick } from './metrics'
import { vusAt } from './profile'

/** Hard cap on virtual users, whatever the profile asks for. */
export const MAX_VUS = 500
// ponytail: all VUs share one event loop; move VUs to worker_threads if one core becomes the limit.
const CPU_WARN = 75
const CPU_STOP = 95
/** Endless iterations; a VU stops when the scheduler aborts it. */
const FOREVER = 1_000_000_000

export interface LoadHandle {
  result: Promise<LoadSummary>
  stop(): void
}

export function startLoadTest(spec: LoadSpec, onTick: (t: Tick) => void, deps: SendDeps = {}): LoadHandle {
  const t0 = Date.now()
  const collection = new Collection(spec.collection)
  const samples: Sample[] = []
  let pending: Sample[] = []
  const vus: { abort(): void }[] = []
  let maxVus = 0
  let warning: string | undefined
  let stopped = false
  let finished = false
  let resolveResult!: (s: LoadSummary) => void
  const result = new Promise<LoadSummary>((r) => (resolveResult = r))
  let cpuBase = process.cpuUsage()
  let wallBase = Date.now()

  const startVu = () => {
    const env = spec.environment ? new VariableScope({ name: spec.environment.name, values: spec.environment.values }) : undefined
    const globals = new VariableScope({ values: spec.globals })
    const options = runtimeOptions(spec, { environment: env, globals }, deps) as Record<string, any>
    // Each VU has its own cookies, like separate users.
    options.requester = { ...options.requester, cookieJar: new CookieJar() }
    options.iterationCount = FOREVER
    if (spec.data.length) options.data = spec.data
    const handle = { abort: () => (handle.aborted = true), aborted: false } as { abort(): void; aborted: boolean }
    vus.push(handle)
    new runtime.Runner().run(collection, options, (err, run) => {
      if (err) return
      if (handle.aborted) return run.abort()
      handle.abort = () => run.abort()
      run.start({
        response(e: NodeJS.ErrnoException | null, _c: unknown, res: any, _req: unknown, item: any) {
          if (finished) return
          const s: Sample = {
            at: Date.now() - t0,
            requestId: String(item?.id ?? item?.name ?? ''),
            name: String(item?.name ?? ''),
            timeMs: res?.responseTime ?? 0,
            ...(res ? { code: res.code } : {}),
            ...(e ? { error: e.code ?? e.message } : {}),
          }
          pending.push(s)
          samples.push(s)
        },
      })
    })
  }

  // Share of the whole machine: cpuUsage() counts every thread (each VU's script sandbox runs in one).
  const cores = Math.max(1, availableParallelism())
  const cpuPercent = () => {
    const used = process.cpuUsage(cpuBase)
    const wall = (Date.now() - wallBase) * 1000
    cpuBase = process.cpuUsage()
    wallBase = Date.now()
    return wall > 0 ? ((used.user + used.system) / wall / cores) * 100 : 0
  }

  const finish = () => {
    if (finished) return
    finished = true
    clearInterval(timer)
    for (const v of vus.splice(0)) v.abort()
    resolveResult(summarize(samples, (Date.now() - t0) / 1000, maxVus, stopped, warning))
  }

  const schedule = (second: number) => {
    const cpu = second > 0 ? cpuPercent() : 0
    if (second > 0) onTick(tickOf(second, vus.length, cpu, pending))
    pending = []
    const wanted = Math.min(vusAt(spec.profile, second), MAX_VUS)
    if (wanted === 0 || second >= spec.profile.durationSec) return finish()
    if (cpu >= CPU_STOP && wanted > vus.length) {
      warning = `CPU at ${Math.round(cpu)}%: stopped adding virtual users; results may reflect this computer, not the server.`
    } else {
      if (cpu >= CPU_WARN) warning ??= `CPU reached ${Math.round(cpu)}%: response times may include delays on this computer.`
      while (vus.length < wanted) startVu()
    }
    while (vus.length > wanted) vus.pop()!.abort()
    maxVus = Math.max(maxVus, vus.length)
  }

  let second = 0
  schedule(second)
  const timer = setInterval(() => schedule(++second), 1000)

  return {
    result,
    stop() {
      stopped = true
      finish()
    },
  }
}
