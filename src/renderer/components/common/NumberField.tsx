import { useEffect, useState } from 'react'

/** Keep editing text (including empty) until blur, then normalize to an integer. */
export function NumberField({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange(value: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const normalize = (input: string) => Math.min(max, Math.max(min, Math.round(Number(input) || min)))
  return <input id={id} className="input small" type="number" min={min} max={max} step={1} value={text}
    onChange={(e) => {
      const next = e.target.value
      setText(next)
      if (next && Number.isInteger(Number(next)) && Number(next) >= min && Number(next) <= max) onChange(Number(next))
    }}
    onBlur={() => { const next = normalize(text); setText(String(next)); onChange(next) }} />
}
