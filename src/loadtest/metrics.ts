// Aggregates request samples into per-second ticks and a run summary.

export interface Sample {
  /** ms since the test started */
  at: number
  requestId: string
  name: string
  timeMs: number
  code?: number
  error?: string
}

export interface Tick {
  second: number
  vus: number
  requests: number
  errors: number
  avgMs: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  cpuPercent: number
}

export interface RequestStats {
  requestId: string
  name: string
  count: number
  errors: number
  avgMs: number
  minMs: number
  maxMs: number
  p90Ms: number
  p95Ms: number
}

export interface LoadSummary {
  durationSec: number
  totalRequests: number
  errors: number
  errorRate: number
  throughput: number
  avgMs: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  maxVus: number
  requests: RequestStats[]
  stopped: boolean
  warning?: string
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

const round = (n: number) => Math.round(n * 10) / 10

export function tickOf(second: number, vus: number, cpuPercent: number, samples: Sample[]): Tick {
  const times = samples.map((s) => s.timeMs).sort((a, b) => a - b)
  return {
    second,
    vus,
    requests: samples.length,
    errors: samples.filter((s) => s.error || (s.code ?? 0) >= 500).length,
    avgMs: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    p90Ms: percentile(times, 90),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    cpuPercent: Math.round(cpuPercent),
  }
}

export function summarize(samples: Sample[], durationSec: number, maxVus: number, stopped: boolean, warning?: string): LoadSummary {
  const times = samples.map((s) => s.timeMs).sort((a, b) => a - b)
  const errors = samples.filter((s) => s.error || (s.code ?? 0) >= 500).length
  const byRequest = new Map<string, Sample[]>()
  for (const s of samples) byRequest.set(s.requestId, [...(byRequest.get(s.requestId) ?? []), s])
  return {
    durationSec: round(durationSec),
    totalRequests: samples.length,
    errors,
    errorRate: samples.length ? round((errors / samples.length) * 100) : 0,
    throughput: durationSec > 0 ? round(samples.length / durationSec) : 0,
    avgMs: times.length ? round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    p90Ms: percentile(times, 90),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    maxVus,
    stopped,
    ...(warning ? { warning } : {}),
    requests: [...byRequest].map(([requestId, list]) => {
      const t = list.map((s) => s.timeMs).sort((a, b) => a - b)
      return {
        requestId,
        name: list[0].name,
        count: list.length,
        errors: list.filter((s) => s.error || (s.code ?? 0) >= 500).length,
        avgMs: round(t.reduce((a, b) => a + b, 0) / t.length),
        minMs: t[0],
        maxMs: t[t.length - 1],
        p90Ms: percentile(t, 90),
        p95Ms: percentile(t, 95),
      }
    }),
  }
}
