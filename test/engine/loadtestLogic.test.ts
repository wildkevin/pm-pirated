import { describe, expect, it } from 'vitest'
import { percentile, summarize, tickOf, type Sample } from '../../src/loadtest/metrics'
import { profileSeries, validateLoadProfile, vusAt } from '../../src/loadtest/profile'

describe('load profiles', () => {
  it('rejects fractional users and unbounded durations, and bounds preview points', () => {
    expect(() => validateLoadProfile({ kind: 'fixed', vus: 2.5, durationSec: 10 })).toThrow(/whole number/)
    expect(() => validateLoadProfile({ kind: 'fixed', vus: 2, durationSec: 100000 })).toThrow(/3600/)
    expect(profileSeries({ kind: 'spike', vus: 10, durationSec: 3600 })).toHaveLength(120)
  })

  it('fixed keeps all VUs for the whole run and stops at the end', () => {
    expect(profileSeries({ kind: 'fixed', vus: 10, durationSec: 5 })).toEqual([10, 10, 10, 10, 10])
    expect(vusAt({ kind: 'fixed', vus: 10, durationSec: 5 }, 5)).toBe(0)
  })
  it('ramp-up climbs from 1 to max over the ramp time', () => {
    const s = profileSeries({ kind: 'ramp-up', vus: 10, durationSec: 10, rampUpSec: 5 })
    expect(s[0]).toBe(1)
    expect(s[5]).toBe(10)
    expect(s.every((v, i) => i === 0 || v >= s[i - 1])).toBe(true)
  })
  it('spike jumps to max in the middle and returns to base', () => {
    const s = profileSeries({ kind: 'spike', vus: 50, durationSec: 20, baseShare: 0.2 })
    expect(s[0]).toBe(10)
    expect(s[10]).toBe(50)
    expect(s[19]).toBe(10)
  })
  it('peak ramps up, holds and ramps down', () => {
    const s = profileSeries({ kind: 'peak', vus: 20, durationSec: 10, baseShare: 0.25 })
    expect(s[0]).toBe(5)
    expect(Math.max(...s)).toBe(20)
    expect(s[5]).toBe(20)
    expect(s[9]).toBeLessThan(20)
  })
  it('never schedules fewer than one VU', () => {
    expect(vusAt({ kind: 'spike', vus: 1, durationSec: 10, baseShare: 0 }, 1)).toBe(1)
  })
})

describe('metrics', () => {
  const samples: Sample[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((t, i) => ({ at: i * 100, requestId: i % 2 ? 'b' : 'a', name: i % 2 ? 'B' : 'A', timeMs: t, code: i === 9 ? 500 : 200 }))
  it('computes nearest-rank percentiles', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90)
    expect(percentile([5], 99)).toBe(5)
    expect(percentile([], 50)).toBe(0)
  })
  it('builds per-second ticks', () => {
    expect(tickOf(3, 7, 42.4, samples)).toEqual({ second: 3, vus: 7, requests: 10, errors: 1, avgMs: 55, p90Ms: 90, p95Ms: 100, p99Ms: 100, cpuPercent: 42 })
  })
  it('summarizes the run, overall and per request', () => {
    const s = summarize(samples, 2, 7, false)
    expect(s).toMatchObject({ totalRequests: 10, errors: 1, errorRate: 10, throughput: 5, avgMs: 55, p90Ms: 90, maxVus: 7, stopped: false })
    expect(s.requests.map((r) => [r.name, r.count, r.minMs, r.maxMs])).toEqual([
      ['A', 5, 10, 90],
      ['B', 5, 20, 100],
    ])
  })
})
