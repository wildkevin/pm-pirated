// Load profiles: how many virtual users should be active at time t (Postman's fixed / ramp-up / spike / peak).
export type ProfileKind = 'fixed' | 'ramp-up' | 'spike' | 'peak'

export interface LoadProfile {
  kind: ProfileKind
  /** Maximum virtual users. */
  vus: number
  durationSec: number
  /** ramp-up: seconds to go from 1 to `vus`. */
  rampUpSec?: number
  /** spike/peak: the load outside the spike/peak, as a share of `vus` (0–1). */
  baseShare?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Active VUs at second `t` (always ≥ 1 while the test runs). */
export function vusAt(p: LoadProfile, t: number): number {
  const max = Math.max(1, Math.floor(p.vus))
  const d = Math.max(1, p.durationSec)
  if (t >= d) return 0
  const base = Math.max(1, Math.round(max * clamp(p.baseShare ?? 0.2, 0, 1)))
  switch (p.kind) {
    case 'fixed':
      return max
    case 'ramp-up': {
      const ramp = clamp(p.rampUpSec ?? d / 4, 1, d)
      return t >= ramp ? max : Math.max(1, Math.round(1 + ((max - 1) * t) / ramp))
    }
    case 'spike': {
      // Base load, a spike to max in the middle 10% of the run, then base again.
      const start = d * 0.45
      const end = d * 0.55
      return t >= start && t < end ? max : base
    }
    case 'peak': {
      // Base → ramp up (20%) → hold peak (40%) → ramp down (20%) → base.
      const up0 = d * 0.2
      const up1 = d * 0.4
      const down0 = d * 0.8
      const down1 = d
      if (t < up0) return base
      if (t < up1) return Math.round(base + ((max - base) * (t - up0)) / (up1 - up0))
      if (t < down0) return max
      return Math.max(base, Math.round(max - ((max - base) * (t - down0)) / (down1 - down0)))
    }
  }
}

/** One point per second for the preview graph. */
export function profileSeries(p: LoadProfile): number[] {
  return Array.from({ length: Math.max(1, Math.ceil(p.durationSec)) }, (_, t) => vusAt(p, t))
}
