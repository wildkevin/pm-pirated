import { describe, expect, it } from 'vitest'
import { AUTH_TYPES, authType, getAttr, setAttr, withType } from '../../src/renderer/lib/auth'
import { dayLabel, fromBulk, groupBy, splitVariables, toBulk } from '../../src/renderer/lib/misc'
import { snippetsFor } from '../../src/renderer/lib/snippets'

describe('auth helpers', () => {
  it('covers every authorizer postman-runtime ships', () => {
    expect(AUTH_TYPES.map((t) => t.type).sort()).toEqual(
      ['apikey', 'asap', 'awsv4', 'basic', 'bearer', 'digest', 'edgegrid', 'hawk', 'jwt', 'noauth', 'ntlm', 'oauth1', 'oauth2'].sort(),
    )
    expect(authType('bearer')?.label).toBe('Bearer Token')
  })

  it('reads and writes v2.1 attribute arrays', () => {
    let auth = withType(undefined, 'basic')
    auth = setAttr(auth, 'username', 'u')
    auth = setAttr(auth, 'password', 'p')
    auth = setAttr(auth, 'username', 'u2')
    expect(auth).toEqual({ type: 'basic', basic: [{ key: 'username', value: 'u2', type: 'string' }, { key: 'password', value: 'p', type: 'string' }] })
    expect(getAttr(auth, 'password')).toBe('p')
    expect(getAttr(undefined, 'x')).toBeUndefined()
  })

  it('switching type keeps the other type’s data so switching back restores it', () => {
    const basic = setAttr(withType(undefined, 'basic'), 'username', 'u')
    const back = withType(withType(basic, 'bearer'), 'basic')
    expect(getAttr(back, 'username')).toBe('u')
  })
})

describe('bulk edit', () => {
  it('round-trips rows including disabled ones and values with colons', () => {
    const rows = [{ key: 'a', value: '1' }, { key: 'url', value: 'http://x:80' }, { key: 'off', value: 'v', disabled: true }]
    expect(toBulk(rows)).toBe('a:1\nurl:http://x:80\n//off:v')
    expect(fromBulk(toBulk(rows))).toEqual(rows)
    expect(fromBulk('noval\n\n  ')).toEqual([{ key: 'noval', value: '' }])
  })
})

describe('history helpers', () => {
  it('labels days like Postman', () => {
    const now = new Date(2026, 9, 15, 10).getTime()
    expect(dayLabel(new Date(2026, 9, 15, 1).getTime(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 14, 23).getTime(), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toBe('October 1')
    expect(dayLabel(new Date(2025, 9, 1).getTime(), now)).toBe('October 1, 2025')
  })
  it('groups preserving order', () => {
    expect(groupBy([1, 2, 3, 4], (n) => (n % 2 ? 'odd' : 'even'))).toEqual([['odd', [1, 3]], ['even', [2, 4]]])
  })
})

describe('variables in text', () => {
  it('splits out {{variables}}', () => {
    expect(splitVariables('{{base}}/u/{{ id }}?x=1')).toEqual([
      { text: '{{base}}', variable: 'base' },
      { text: '/u/' },
      { text: '{{ id }}', variable: 'id' },
      { text: '?x=1' },
    ])
    expect(splitVariables('no vars')).toEqual([{ text: 'no vars' }])
  })
})

describe('snippets', () => {
  it('offers test snippets only in the Tests tab', () => {
    expect(snippetsFor('prerequest').some((s) => s.label.startsWith('Status code'))).toBe(false)
    expect(snippetsFor('test').some((s) => s.label.startsWith('Status code'))).toBe(true)
  })
})
