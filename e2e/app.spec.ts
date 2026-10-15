import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = (prefix: string) => mkdtemp(join(tmpdir(), prefix))
let server: http.Server
let base: string

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, token: req.headers['x-token'] ?? null, auth: req.headers.authorization ?? null, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => server.close())

function launch(userData: string): Promise<ElectronApplication> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(http|https|all|no)_proxy$/i.test(k)),
  ) as Record<string, string>
  return electron.launch({ args: ['.'], env: { ...env, PM_LOCAL_USER_DATA: userData } })
}

async function stubDialogs(app: ElectronApplication, dir: string) {
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
  }, dir)
}

async function openWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Open workspace' }).first().click()
  await expect(page.getByRole('button', { name: 'New collection' })).toBeVisible()
}

async function newCollectionWithRequest(page: Page, collection: string, request: string) {
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Name').fill(collection)
  await page.getByLabel('Name').press('Enter')
  await page.getByRole('button', { name: `Actions for ${collection}` }).click()
  await page.getByRole('menuitem', { name: 'Add request' }).click()
  await page.getByLabel('Name').fill(request)
  await page.getByLabel('Name').press('Enter')
}

const urlBar = (page: Page) => page.getByLabel('Request URL')

test('renderer is isolated and only sees window.api', async () => {
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('PM Local')
  const globals = await page.evaluate(() => [
    typeof (window as unknown as { require?: unknown }).require,
    typeof (window as unknown as { process?: unknown }).process,
    typeof window.api,
  ])
  expect(globals).toEqual(['undefined', 'undefined', 'object'])
  await app.close()
})

test('build a POST with headers and a JSON body, send, save, and reopen after restart', async () => {
  const userData = await temp('pml-ud-')
  const dir = await temp('pml-ws-')
  let app = await launch(userData)
  let page = await app.firstWindow()
  await stubDialogs(app, dir)
  await openWorkspace(page)
  await newCollectionWithRequest(page, 'Demo API', 'Echo')

  await page.getByLabel('HTTP method').selectOption('POST')
  await urlBar(page).fill(`${base}/echo?q=1`)
  await page.getByRole('tab', { name: /Headers/ }).click()
  await page.getByLabel('Key').last().fill('X-Token')
  await page.getByLabel('Value').first().fill('abc')
  await page.getByRole('tab', { name: /^Body/ }).click()
  await page.getByLabel('raw', { exact: true }).check()
  await page.getByLabel('Request body').fill('{"hello":"world"}')
  await page.getByRole('button', { name: 'Send', exact: true }).click()

  await expect(page.getByTestId('response-status')).toHaveText('200 OK')
  await expect(page.getByTestId('response-body')).toContainText('"token": "abc"')
  await expect(page.getByTestId('response-body')).toContainText('"method": "POST"')

  await expect(page.getByLabel('Unsaved changes')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0)

  const saved = JSON.parse(await readFile(join(dir, 'collections', 'Demo API', 'Echo.request.json'), 'utf8'))
  expect(saved).toMatchObject({
    name: 'Echo',
    request: { method: 'POST', url: `${base}/echo?q=1`, header: [{ key: 'X-Token', value: 'abc' }], body: { mode: 'raw', raw: '{"hello":"world"}' } },
  })
  await app.close()

  // Tabs, unsaved edits and the workspace come back after a restart.
  app = await launch(userData)
  page = await app.firstWindow()
  await expect(page.getByTestId('tree-row').filter({ hasText: 'Demo API' })).toBeVisible()
  await expect(urlBar(page)).toHaveText(`${base}/echo?q=1`)
  await app.close()
})

test('environment variables, collection auth, scripts, tests and console', async () => {
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, await temp('pml-ws-'))
  await openWorkspace(page)

  // Environment "Dev" with base = local server, made active.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Environment' }).click()
  await page.getByLabel('Name').fill('Dev')
  await page.getByLabel('Name').press('Enter')
  await page.getByLabel('Variable').last().fill('base')
  await page.getByLabel('Initial value').first().fill(base)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('tab', { name: /^Dev/ })).toBeVisible()
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0)
  await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'Dev' })

  await page.getByRole('button', { name: 'Collections' }).click()
  await newCollectionWithRequest(page, 'Vars', 'Scripted')
  await urlBar(page).fill('{{base}}/users/{{missing}}')
  await expect(page.locator('.cm-var-ok')).toHaveText('{{base}}')
  await expect(page.locator('.cm-var-missing')).toHaveText('{{missing}}')
  await urlBar(page).fill('{{base}}/users')

  await page.getByRole('tab', { name: 'Pre-request Script' }).click()
  await page.getByLabel('Pre-request script').fill('pm.environment.set("token", "T-123"); console.log("pre ran")')
  await page.getByRole('tab', { name: 'Tests' }).click()
  await page.getByLabel('Tests script').fill('pm.test("is 200", () => pm.response.to.have.status(200)); pm.test("fails", () => pm.expect(1).to.eql(2))')
  await page.getByRole('tab', { name: 'Authorization' }).click()
  await page.getByLabel('Auth type').selectOption('bearer')
  await page.getByLabel('Token').fill('{{token}}')
  await page.keyboard.press('ControlOrMeta+Enter')

  await expect(page.getByTestId('response-status')).toHaveText('200 OK')
  await expect(page.getByTestId('response-body')).toContainText('"auth": "Bearer T-123"')
  await page.getByRole('tab', { name: /Test Results/ }).click()
  await expect(page.getByTestId('test-results')).toContainText('PASS')
  await expect(page.getByTestId('test-results')).toContainText('expected 1 to deeply equal 2')

  // The script's variable change is persisted as the environment's current value.
  await page.getByRole('button', { name: 'Environment quick look' }).click()
  await expect(page.getByRole('dialog', { name: 'Environment quick look' })).toContainText('T-123')
  await page.getByRole('button', { name: 'Environment quick look' }).click()

  await page.locator('.status-bar').getByRole('button', { name: 'Console' }).click()
  await expect(page.getByRole('region', { name: 'Console' })).toContainText('pre ran')
  await expect(page.getByRole('region', { name: 'Console' })).toContainText('/users')
  await app.close()
})

test('paste cURL into a new tab, send it, save the draft into a collection', async () => {
  const dir = await temp('pml-ws-')
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, dir)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Name').fill('Inbox')
  await page.getByLabel('Name').press('Enter')

  await page.getByRole('button', { name: 'New request tab' }).click()
  await urlBar(page).click()
  await page.evaluate((url) => {
    const target = document.querySelector('[aria-label="Request URL"]')!
    const data = new DataTransfer()
    data.setData('text/plain', `curl -X PUT '${url}/things/7' -H 'X-Token: from-curl' --data-raw 'x=1'`)
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, base)
  await expect(page.getByLabel('HTTP method')).toHaveValue('PUT')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('response-body')).toContainText('"token": "from-curl"')

  await page.keyboard.press('ControlOrMeta+s')
  await page.getByRole('dialog', { name: 'Save request' }).getByLabel('Request name').fill('Put thing')
  await page.getByRole('option', { name: 'Inbox' }).click()
  await page.getByRole('dialog', { name: 'Save request' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('tree-row').filter({ hasText: 'Put thing' })).toBeVisible()
  const saved = JSON.parse(await readFile(join(dir, 'collections', 'Inbox', 'Put thing.request.json'), 'utf8'))
  expect(saved.request).toMatchObject({ method: 'PUT', url: `${base}/things/7` })
  await app.close()
})

test('import a Postman collection by pasting JSON', async () => {
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, await temp('pml-ws-'))
  await openWorkspace(page)
  const fixture = await readFile(join(__dirname, '..', 'test', 'fixtures', 'sample.postman_collection.json'), 'utf8')
  await page.locator('.sidebar-head').getByRole('button', { name: 'Import' }).click()
  await page.getByLabel('Import text').fill(fixture)
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import' }).click()
  await expect(page.getByTestId('tree-row').filter({ hasText: 'Sample API' })).toBeVisible()
  await page.getByTestId('tree-row').filter({ hasText: 'Sample API' }).click()
  await expect(page.getByTestId('tree-row').filter({ hasText: 'Users' })).toBeVisible()
  await app.close()
})

test('a failed request shows the reason instead of crashing', async () => {
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, await temp('pml-ws-'))
  await openWorkspace(page)
  await page.getByRole('button', { name: 'New request tab' }).click()
  await urlBar(page).fill('http://127.0.0.1:1/')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('response-error')).toContainText('ECONNREFUSED')
  await app.close()
})

test('collection runner with a CSV data file, and the code snippet panel', async () => {
  const dir = await temp('pml-ws-')
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, dir)
  await openWorkspace(page)
  await newCollectionWithRequest(page, 'Suite', 'First')
  await urlBar(page).fill(`${base}/first?user={{user}}`)
  await page.getByRole('tab', { name: 'Tests' }).click()
  await page.getByLabel('Tests script').fill('pm.test("ok", () => pm.response.to.have.status(200))')
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByRole('button', { name: 'Actions for Suite' }).click()
  await page.getByRole('menuitem', { name: 'Add request' }).click()
  await page.getByLabel('Name').fill('Second')
  await page.getByLabel('Name').press('Enter')
  await urlBar(page).fill(`${base}/second`)
  await page.getByRole('tab', { name: 'Tests' }).click()
  await page.getByLabel('Tests script').fill('pm.test("fails", () => pm.expect(1).to.eql(2))')
  await page.keyboard.press('ControlOrMeta+s')

  // Code snippet for the open request.
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await expect(page.getByTestId('code-snippet')).toContainText(`curl --location '${base}/second'`)
  await page.getByLabel('Snippet language').selectOption({ label: 'Python - Requests' })
  await expect(page.getByTestId('code-snippet')).toContainText('import requests')
  await page.getByRole('button', { name: 'Close code snippet' }).click()

  // Data file inside the workspace; the picker is stubbed to return it.
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(dir, 'users.csv'), 'user\nada\nbob\n')
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog
  }, join(dir, 'users.csv'))

  await page.getByRole('button', { name: 'Actions for Suite' }).click()
  await page.getByRole('menuitem', { name: 'Run' }).click()
  await page.getByRole('button', { name: 'Select File' }).click()
  await expect(page.getByText('2 rows · columns: user')).toBeVisible()
  await expect(page.getByLabel('Iterations')).toHaveValue('2')
  await page.getByRole('button', { name: /^Run Suite/ }).click()

  await expect(page.getByTestId('run-row')).toHaveCount(4)
  await expect(page.getByTestId('run-passed')).toHaveText('2')
  await expect(page.getByTestId('run-failed')).toHaveText('2')
  await expect(page.getByTestId('runner-results')).toContainText('/first?user=bob')
  await expect(page.getByTestId('runner-results')).toContainText('Completed')
  await expect(page.getByText('Past runs')).toBeVisible()
  await app.close()
})

test('mock server answers with a saved example', async () => {
  const net = await import('node:net')
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => r(p))
    })
  })
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, await temp('pml-ws-'))
  await openWorkspace(page)
  await newCollectionWithRequest(page, 'Shop', 'Get product')
  await urlBar(page).fill(`${base}/products/7`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('response-status')).toHaveText('200 OK')
  await page.getByRole('button', { name: 'Save as example' }).click()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByLabel('Unsaved changes')).toHaveCount(0)

  await page.getByRole('button', { name: 'Actions for Shop' }).click()
  await page.getByRole('menuitem', { name: 'Mock', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create mock server' })
  await dialog.getByLabel('Name').fill('Shop mock')
  await dialog.getByLabel('Port').fill(String(port))
  await dialog.getByRole('button', { name: 'Create Mock Server' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('mock-url')).toHaveText(`http://127.0.0.1:${port}`)
  await expect(page.getByText('Examples served (1)')).toBeVisible()

  // Call the mock from a new request tab.
  await page.getByRole('button', { name: 'New request tab' }).click()
  await urlBar(page).fill(`http://127.0.0.1:${port}/products/7`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('response-body')).toContainText('"url": "/products/7"')
  await page.getByRole('tab', { name: /Shop mock/ }).click()
  await expect(page.getByTestId('mock-log')).toContainText('/products/7')
  await expect(page.getByTestId('mock-log')).toContainText('Matched')
  await app.close()
})

test('capture proxy records traffic and saves it to History', async () => {
  const net = await import('node:net')
  const port = await new Promise<number>((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => r(p))
    })
  })
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubDialogs(app, await temp('pml-ws-'))
  await openWorkspace(page)
  await page.locator('.status-bar').getByRole('button', { name: /Capture/ }).click()
  await page.getByLabel('Port').fill(String(port))
  await page.getByRole('button', { name: 'Start proxy' }).click()
  await expect(page.getByTestId('capture-status')).toHaveText(`Listening on 127.0.0.1:${port}`)

  // A client configured to use the proxy (absolute-form HTTP request).
  await new Promise<void>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `${base}/captured?x=1`, headers: { Host: new URL(base).host, 'Content-Type': 'application/json' } }, (res) => {
      res.resume()
      res.on('end', () => resolve())
    })
    req.on('error', reject)
    req.end('{"hello":"proxy"}')
  })
  await expect(page.getByTestId('capture-list')).toContainText('/captured?x=1')
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByTestId('history-row').first()).toContainText('/captured?x=1')

  await page.getByRole('tab', { name: /Capture/ }).click()
  await page.getByRole('button', { name: 'Stop proxy' }).click()
  await expect(page.getByTestId('capture-status')).toHaveText('Stopped')
  await app.close()
})
