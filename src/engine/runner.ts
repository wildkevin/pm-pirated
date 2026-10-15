// Collection Runner: runs a (pruned) collection for N iterations and streams one result per request.
import runtime from 'postman-runtime'
import { Collection, VariableScope } from 'postman-collection'
import type { PmVariable } from '../shared/format/types'
import type { LogEntry } from '../shared/engine'
import type { RunnerItemResult, RunnerOutcome, RunnerSpec } from '../shared/engine'
import { saveJar } from './cookies'
import { formatArg, runtimeOptions, toResult, toSent, toVars, type SendDeps } from './send'

/** Response bodies kept per result when "persist responses" is on. */
const MAX_PERSISTED_BODY = 1024 * 1024

export interface RunnerHandle {
  result: Promise<RunnerOutcome>
  stop(): void
}

export function startRunner(spec: RunnerSpec, onItem: (r: RunnerItemResult) => void, deps: SendDeps = {}): RunnerHandle {
  let resolve!: (o: RunnerOutcome) => void
  const result = new Promise<RunnerOutcome>((r) => (resolve = r))
  const environment = spec.environment ? new VariableScope({ name: spec.environment.name, values: spec.environment.values }) : undefined
  const globals = new VariableScope({ values: spec.globals })
  let collectionVariables: PmVariable[] = ((spec.collection.variable as PmVariable[] | undefined) ?? []).map((v) => ({ key: v.key, value: v.value }))
  const started = Date.now()
  const summary = { iterations: 0, durationMs: 0, requests: 0, testsPassed: 0, testsFailed: 0, errors: 0, avgResponseMs: 0, stopped: false }
  let totalTime = 0
  let responses = 0
  let current: RunnerItemResult | undefined
  let run: { abort(): void } | undefined
  let stopped = false
  let settled = false

  const finish = () => {
    if (settled) return
    settled = true
    summary.durationMs = Date.now() - started
    summary.avgResponseMs = responses ? Math.round(totalTime / responses) : 0
    summary.stopped = stopped
    saveJar(spec.cookieFile)
    resolve({
      summary,
      variables: { ...(environment ? { environment: toVars(environment) } : {}), globals: toVars(globals), collection: collectionVariables },
    })
  }

  const scriptResult = (results: any[] | undefined) => {
    for (const r of results ?? []) {
      if (r?.error) current?.scriptErrors.push(r.error.message ?? String(r.error))
      const cv = r?.result?.collectionVariables
      if (cv?.values) collectionVariables = toVars(new VariableScope(cv))
    }
  }

  const options = {
    ...runtimeOptions(spec, { environment, globals }, deps),
    iterationCount: spec.iterationCount,
    ...(spec.data.length ? { data: spec.data } : {}),
    ...(spec.delayMs > 0 ? { delay: { item: spec.delayMs } } : {}),
  }

  new runtime.Runner().run(new Collection(spec.collection), options, (err, r) => {
    if (err) {
      summary.errors++
      return finish()
    }
    if (stopped) return finish()
    run = r
    r.start({
      beforeItem(_e: unknown, cursor: { iteration: number }, item: any) {
        current = { iteration: cursor.iteration, requestId: String(item.id ?? ''), name: item.name, method: '', url: '', tests: [], scriptErrors: [], logs: [] }
      },
      console(_cursor: unknown, level: LogEntry['level'], ...args: unknown[]) {
        current?.logs.push({ level, args: args.map(formatArg) })
      },
      prerequest(_e: unknown, _c: unknown, results: any[]) {
        scriptResult(results)
      },
      test(_e: unknown, _c: unknown, results: any[]) {
        scriptResult(results)
      },
      assertion(_c: unknown, assertions: any[]) {
        for (const a of assertions) {
          current?.tests.push({ name: a.name, passed: !!a.passed, skipped: !!a.skipped, ...(a.error ? { error: a.error.message } : {}) })
          if (!a.skipped) a.passed ? summary.testsPassed++ : summary.testsFailed++
        }
      },
      request(_e: unknown, _c: unknown, _res: unknown, request: any) {
        if (!current || !request) return
        current.sent = toSent(request)
        current.method = current.sent.method
        current.url = current.sent.url
      },
      response(e: NodeJS.ErrnoException | null, _c: unknown, res: unknown) {
        if (!current) return
        if (e) {
          current.error = e.code ? `${e.code}: ${e.message}` : e.message
          return
        }
        const r = toResult(res)
        if (!r.ok) return
        Object.assign(current, { code: r.code, status: r.status, timeMs: r.timeMs, size: r.size })
        totalTime += r.timeMs
        responses++
        if (spec.persistResponses)
          current.response = { headers: r.headers, body: Buffer.from(r.body.subarray(0, MAX_PERSISTED_BODY)).toString('utf8') }
      },
      item(_e: unknown, _c: unknown, _item: unknown, _visualizer: unknown, res: { isSkipped?: boolean } | undefined) {
        if (!current || res?.isSkipped) return
        summary.requests++
        summary.iterations = Math.max(summary.iterations, current.iteration + 1)
        const hasError = !!current.error || current.scriptErrors.length > 0
        if (hasError) summary.errors++
        onItem(current)
        current = undefined
        if (spec.stopOnError && hasError) {
          stopped = true
          run?.abort()
          finish()
        }
      },
      done() {
        finish()
      },
    })
  })

  return {
    result,
    stop() {
      stopped = true
      run?.abort()
      finish()
    },
  }
}
