// Minimal dependency-free SVG line chart (one shared x axis, each series scaled to its own max).
export interface Series {
  label: string
  color: string
  values: number[]
  unit?: string
  legendValue?: number
}

export function LineChart({ series, height = 140, ariaLabel }: { series: Series[]; height?: number; ariaLabel: string }) {
  const width = 600
  const pad = { l: 8, r: 8, t: 8, b: 16 }
  const n = Math.max(2, ...series.map((s) => s.values.length))
  const x = (i: number) => pad.l + (i / (n - 1)) * (width - pad.l - pad.r)
  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
        <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} className="chart-axis" />
        {series.map((s) => {
          const max = Math.max(1, ...s.values)
          const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b)
          const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        })}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
            {s.values.length > 0 && (
              <b>
                {' '}
                {s.legendValue ?? s.values[s.values.length - 1]}
                {s.unit ?? ''}
              </b>
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
