import { describe, expect, it } from 'vitest'
import { sanitizeName, uniqueName } from '../../src/shared/format/names'
import { stableStringify } from '../../src/shared/format/stableJson'

describe('sanitizeName', () => {
  it('replaces characters Windows forbids in file names', () => {
    expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('drops trailing dots and spaces', () => {
    expect(sanitizeName('Get users. ')).toBe('Get users')
  })
  it('prefixes reserved device names, also before an extension', () => {
    expect(sanitizeName('CON')).toBe('_CON')
    expect(sanitizeName('nul.json')).toBe('_nul.json')
    expect(sanitizeName('console')).toBe('console')
  })
  it('falls back to Untitled for empty results', () => {
    expect(sanitizeName('')).toBe('Untitled')
    expect(sanitizeName('...')).toBe('Untitled')
  })
  it('caps length at 100', () => {
    expect(sanitizeName('x'.repeat(300))).toHaveLength(100)
  })
})

describe('uniqueName', () => {
  it('adds a (n) suffix, comparing case-insensitively like Windows', () => {
    expect(uniqueName('Get', ['get.request.json'], '.request.json')).toBe('Get (2).request.json')
    expect(uniqueName('Get', ['Get.request.json', 'Get (2).request.json'], '.request.json')).toBe(
      'Get (3).request.json',
    )
    expect(uniqueName('Get', [], '.request.json')).toBe('Get.request.json')
  })
})

describe('stableStringify', () => {
  it('sorts object keys recursively, keeps array order, ends with a newline', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }, 3] } })).toBe(
      '{\n  "a": {\n    "c": [\n      {\n        "y": 2,\n        "z": 1\n      },\n      3\n    ],\n    "d": 1\n  },\n  "b": 1\n}\n',
    )
  })
})
