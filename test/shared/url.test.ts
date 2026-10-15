import { describe, expect, it } from 'vitest'
import {
  parseQuery,
  pathVariableNames,
  pathVariables,
  queryParams,
  rawUrl,
  setPathVariables,
  setQueryParams,
  setRaw,
} from '../../src/shared/format/url'

describe('query params', () => {
  it('parses keys, values, empty values and = inside values; ignores the fragment', () => {
    expect(parseQuery('http://a/x?q=1&flag&e=&t=a=b#frag')).toEqual([
      { key: 'q', value: '1' },
      { key: 'flag', value: '', hasEquals: false },
      { key: 'e', value: '', hasEquals: true },
      { key: 't', value: 'a=b' },
    ])
    expect(parseQuery('http://a/x')).toEqual([])
    expect(parseQuery('{{base}}/x?id={{id}}')).toEqual([{ key: 'id', value: '{{id}}' }])
  })

  it('rewrites the URL from the table and keeps disabled rows out of the text', () => {
    const url = setQueryParams('http://a/x?old=1#h', [
      { key: 'a', value: '1' },
      { key: 'b', value: '2', disabled: true },
    ])
    expect(url).toEqual({
      raw: 'http://a/x?a=1#h',
      query: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2', disabled: true },
      ],
    })
    expect(queryParams(url)).toHaveLength(2)
  })

  it('drops the ? when all params are removed, and returns a plain string when nothing extra is needed', () => {
    expect(setQueryParams('http://a/x?q=1', [])).toBe('http://a/x')
    expect(rawUrl(setQueryParams('http://a/x', [{ key: 'q', value: '' }]))).toBe('http://a/x?q=')
  })

  it('keeps disabled params when the URL text is edited', () => {
    const withDisabled = setQueryParams('http://a/x', [
      { key: 'a', value: '1' },
      { key: 'b', value: '2', disabled: true },
    ])
    const edited = setRaw(withDisabled, 'http://a/y?a=1&c=3')
    expect(rawUrl(edited)).toBe('http://a/y?a=1&c=3')
    expect(queryParams(edited).map((p) => p.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('path variables', () => {
  it('finds :name segments but not the port', () => {
    expect(pathVariableNames('http://host:8080/users/:id/posts/:postId?x=:no')).toEqual(['id', 'postId'])
    expect(pathVariableNames('{{base}}/users/:id')).toEqual(['id'])
    expect(pathVariableNames('localhost:3000')).toEqual([])
  })

  it('keeps values of variables that survive an edit and drops removed ones', () => {
    let url = setRaw('', 'http://a/users/:id/:tab')
    url = setPathVariables(url, [
      { key: 'id', value: '42' },
      { key: 'tab', value: 'posts' },
    ])
    url = setRaw(url, 'http://a/users/:id')
    expect(url).toEqual({ raw: 'http://a/users/:id', variable: [{ key: 'id', value: '42' }] })
    expect(pathVariables(url)).toEqual([{ key: 'id', value: '42' }])
  })

  it('preserves unknown fields of imported URL objects', () => {
    const imported = { raw: 'http://a/:id', host: ['a'], path: [':id'], variable: [{ key: 'id', value: '1', description: 'd' }] }
    expect(setRaw(imported, 'http://a/:id?x=1')).toMatchObject({ host: ['a'], variable: [{ key: 'id', value: '1', description: 'd' }] })
  })
})


describe('QA query regressions', () => {
  it('keeps row order, empty equals and flags when toggling duplicate params', () => {
    const original = 'http://a/x?a=1&b=two&a=3&empty=&flag'
    const rows = queryParams(original)
    let url = setQueryParams(original, rows.map((p, i) => i === 1 ? { ...p, disabled: true } : p))
    expect(queryParams(url).map(p => p.key)).toEqual(['a', 'b', 'a', 'empty', 'flag'])
    expect(rawUrl(url)).toBe('http://a/x?a=1&a=3&empty=&flag')
    url = setQueryParams(url, queryParams(url).map(p => ({ ...p, disabled: false })))
    expect(rawUrl(url)).toBe(original)
  })
  it('round-trips delimiter characters without splitting or dropping their value', () => {
    const url = setQueryParams('http://a/x', [{ key: 'q', value: 'a&b=c d#e' }])
    expect(rawUrl(url)).toBe('http://a/x?q=a%26b%3Dc%20d%23e')
    expect(queryParams(setRaw(url, rawUrl(url)))).toEqual([{ key: 'q', value: 'a&b=c d#e' }])
  })
})
