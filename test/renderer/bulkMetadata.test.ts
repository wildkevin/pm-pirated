import { describe, expect, it } from 'vitest'
import { mergeBulkRows } from '../../src/renderer/lib/misc'

describe('bulk editor metadata', () => {
  const rows = [{ key: 'X-Dup', value: 'a', description: 'first' }, { key: 'X-Dup', value: 'b', description: 'second' }]
  it('keeps separate duplicate-key descriptions on roundtrip and inserted rows', () => {
    expect(mergeBulkRows('X-Dup:a\nX-Dup:b\nX-New:3', rows).map((r) => r.description)).toEqual(['first', 'second', undefined])
  })
  it('reserves exact matches before matching edited values and preserves reordering', () => {
    expect(mergeBulkRows('X-Dup:c\nX-Dup:a', rows).map((r) => r.description)).toEqual(['second', 'first'])
    expect(mergeBulkRows('//X-Dup:b\nX-Dup:a', rows)).toEqual([{ ...rows[1], disabled: true }, { ...rows[0], disabled: undefined }])
  })
})
