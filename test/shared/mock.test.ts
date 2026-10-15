import { describe, expect, it } from 'vitest'
import { matchRoute, pathOf, pathScore, queryOf, type MockRoute } from '../../src/shared/mock'

const route = (id: string, method: string, path: string, extra: Partial<MockRoute> = {}): MockRoute => ({
  id,
  exampleName: id,
  requestName: 'R',
  method,
  path,
  query: [],
  response: { code: 200, status: 'OK', headers: [], body: id },
  ...extra,
})

describe('paths', () => {
  it('strips scheme, host and a leading variable', () => {
    expect(pathOf('https://api.test/users/1?x=1')).toBe('/users/1')
    expect(pathOf('{{baseUrl}}/users/:id')).toBe('/users/:id')
    expect(pathOf('localhost:3000/a/')).toBe('/a')
    expect(pathOf('{{baseUrl}}')).toBe('/')
    expect(queryOf('/x?a=1&b=two%20words&flag')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: 'two words' },
      { key: 'flag', value: '' },
    ])
  })

  it('scores exact above wildcard segments', () => {
    expect(pathScore('/users/42', '/users/42')).toBe(2)
    expect(pathScore('/users/:id', '/users/42')).toBe(1)
    expect(pathScore('/users/{{id}}', '/users/42')).toBe(1)
    expect(pathScore('/users/:id', '/users/42/posts')).toBe(0)
    expect(pathScore('/users', '/orders')).toBe(0)
  })
})

describe('matchRoute', () => {
  const req = (method: string, url: string, headers: Record<string, string> = {}, body = '') => ({ method, url, headers, body })

  it('matches method and path, preferring exact over wildcard', () => {
    const routes = [route('any', 'GET', '/users/:id'), route('ada', 'GET', '/users/1'), route('post', 'POST', '/users/1')]
    expect(matchRoute(routes, req('GET', '/users/1')).route?.id).toBe('ada')
    expect(matchRoute(routes, req('GET', '/users/7')).route?.id).toBe('any')
    expect(matchRoute(routes, req('POST', '/users/1')).route?.id).toBe('post')
    expect(matchRoute(routes, req('DELETE', '/users/1'))).toMatchObject({ route: null, reason: 'No example for DELETE /users/1' })
  })

  it('uses query parameters to pick between examples', () => {
    const routes = [route('page1', 'GET', '/items', { query: [{ key: 'page', value: '1' }] }), route('page2', 'GET', '/items', { query: [{ key: 'page', value: '2' }] })]
    expect(matchRoute(routes, req('GET', '/items?page=2')).route?.id).toBe('page2')
    expect(matchRoute(routes, req('GET', '/items')).route?.id).toBe('page1')
  })

  it('honours x-mock-response-name and x-mock-response-code', () => {
    const routes = [route('ok', 'GET', '/a'), route('missing', 'GET', '/a', { response: { code: 404, status: 'Not Found', headers: [], body: '' } })]
    expect(matchRoute(routes, req('GET', '/a', { 'x-mock-response-code': '404' })).route?.id).toBe('missing')
    expect(matchRoute(routes, req('GET', '/a', { 'x-mock-response-name': 'ok' })).route?.id).toBe('ok')
    expect(matchRoute(routes, req('GET', '/a', { 'x-mock-response-name': 'nope' })).route).toBeNull()
  })

  it('can require the same request body', () => {
    const routes = [route('a', 'POST', '/s', { body: '{"q":1}' }), route('b', 'POST', '/s', { body: '{"q": 2}' })]
    expect(matchRoute(routes, req('POST', '/s', { 'x-mock-match-request-body': 'true' }, '{"q":2}')).route?.id).toBe('b')
    expect(matchRoute(routes, req('POST', '/s', {}, '{"q":2}')).route?.id).toBe('a')
  })
})
