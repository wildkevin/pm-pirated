// Generates docs/screenshots/*.png — every screen, with a made-up sample workspace.
import { _electron as electron, test, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.skip(!process.env.PM_LOCAL_GALLERY, 'set PM_LOCAL_GALLERY=1 to regenerate docs/screenshots')

const out = (n: string) => join(__dirname, '..', 'docs', 'screenshots', `${n}.png`)
const freePort = () => new Promise<number>((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)) }) })

async function rowActions(page: Page, name: string) {
  const row = page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) }).first()
  await row.hover()
  await row.getByRole('button', { name: `Actions for ${name}` }).click()
}

test('gallery', async () => {
  test.setTimeout(240_000)
  const server = http.createServer((q, r) => {
    let b = ''
    q.on('data', (d) => (b += d))
    q.on('end', () => setTimeout(() => {
      r.setHeader('content-type', 'application/json')
      r.setHeader('set-cookie', 'session=a1b2c3; Path=/')
      if (q.url?.startsWith('/orders') && q.method === 'POST') { r.statusCode = 201; return r.end(JSON.stringify({ id: 'ord_1042', status: 'created', items: JSON.parse(b || '{}').items ?? [] })) }
      r.end(JSON.stringify({ id: 42, name: 'Ada Lovelace', email: 'ada@example.com', roles: ['admin', 'billing'], active: true, address: { city: 'London', postcode: 'N1 9GU' }, lastLogin: '2026-10-14T09:12:44Z' }, null, 0))
    }, 15 + Math.random() * 40))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_proxy$/i.test(k))) as Record<string, string>
  const app = await electron.launch({ args: ['.'], env: { ...env, PM_LOCAL_USER_DATA: await mkdtemp(join(tmpdir(), 'gal-u-')) } })
  const dir = join(await mkdtemp(join(tmpdir(), 'gal-')), 'Payments Team')
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as any }, dir)
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  const shot = async (n: string) => { await page.waitForTimeout(250); await page.screenshot({ path: out(n) }) }
  const url = (p: Page) => p.getByLabel('Request URL')

  await shot('01-welcome')
  await page.getByRole('button', { name: 'Open workspace' }).first().click()

  // Environment
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Environment' }).click()
  await page.getByLabel('Name').fill('Staging'); await page.getByLabel('Name').press('Enter')
  for (const [i, [k, v]] of [['baseUrl', base], ['apiKey', 'sk_test_51Hx'], ['customerId', 'cus_9921']].entries()) {
    await page.getByLabel('Variable').last().fill(k)
    await page.getByLabel('Initial value').nth(i).fill(v)
  }
  await page.getByLabel('Type').nth(1).selectOption('secret')
  await page.keyboard.press('ControlOrMeta+s')
  await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'Staging' })
  await shot('05-environment-editor')

  // Collection with folders and requests
  await page.getByRole('tab', { name: /^Collections/ }).click()
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Collection' }).click()
  await page.getByLabel('Name').fill('Payments API'); await page.getByLabel('Name').press('Enter')
  await rowActions(page, 'Payments API')
  await page.getByRole('menuitem', { name: 'Add folder' }).click()
  await page.getByLabel('Name').fill('Customers'); await page.getByLabel('Name').press('Enter')
  const reqs: [string, string, string][] = [['List customers', 'GET', '{{baseUrl}}/customers?limit=20&status=active'], ['Create order', 'POST', '{{baseUrl}}/orders'], ['Refund payment', 'DELETE', '{{baseUrl}}/payments/:paymentId'], ['Get customer', 'GET', '{{baseUrl}}/customers/{{customerId}}']]
  for (const [n, m, u] of reqs) {
    await rowActions(page, 'Payments API')
    await page.getByRole('menuitem', { name: 'Add request' }).click()
    await page.getByLabel('Name').fill(n); await page.getByLabel('Name').press('Enter')
    await page.getByLabel('HTTP method').selectOption(m)
    await url(page).fill(u)
    if (n === 'Create order') {
      await page.getByRole('tab', { name: /^Body/ }).first().click()
      await page.getByLabel('raw', { exact: true }).check()
      await page.getByLabel('Request body').fill('{\n  "customer": "{{customerId}}",\n  "items": [{ "sku": "PLAN-PRO", "qty": 1 }],\n  "currency": "GBP"\n}')
    }
    if (n === 'Get customer') {
      await page.getByRole('tab', { name: 'Tests' }).click()
      await page.getByLabel('Tests script').fill('pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});\npm.test("Customer is active", function () {\n    pm.expect(pm.response.json().active).to.be.true;\n});\npm.test("Has billing role", function () {\n    pm.expect(pm.response.json().roles).to.include("support");\n});')
    }
    await page.keyboard.press('ControlOrMeta+s')
  }
  // collection auth
  await page.getByTestId('tree-row').filter({ hasText: 'Payments API' }).click()
  await page.getByRole('tab', { name: 'Authorization' }).click()
  await page.getByLabel('Auth type').selectOption('apikey')
  await page.getByLabel('Key', { exact: true }).fill('X-Api-Key')
  await page.getByLabel('Value', { exact: true }).fill('{{apiKey}}')
  await page.keyboard.press('ControlOrMeta+s')
  await shot('06-collection-settings-auth')

  // Main request + response
  await page.getByTestId('tree-row').filter({ hasText: 'Get customer' }).click()
  await page.getByRole('tab', { name: 'Params' }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByTestId('response-status').waitFor()
  await shot('02-request-and-response')
  await page.getByRole('tab', { name: /Test Results/ }).click()
  await shot('04-test-results')
  await page.getByRole('tab', { name: 'Tests' }).click()
  await shot('03-tests-script-with-snippets')
  await page.getByRole('tab', { name: /^Body/ }).first().click()

  await page.getByTestId('tree-row').filter({ hasText: 'Create order' }).click()
  await page.getByRole('tab', { name: /^Body/ }).first().click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByTestId('response-status').waitFor()
  await shot('07-post-with-json-body')

  await page.getByTestId('tree-row').filter({ hasText: 'List customers' }).click()
  await page.getByRole('tab', { name: 'Authorization' }).click()
  await page.getByLabel('Auth type').selectOption('oauth2')
  await shot('08-auth-oauth2')
  await page.getByLabel('Auth type').selectOption('inherit')
  await page.getByRole('tab', { name: 'Settings' }).click()
  await shot('09-request-settings')
  await page.getByRole('tab', { name: 'Params' }).click()

  // Quick look
  await page.getByRole('button', { name: 'Environment quick look' }).click()
  await shot('10-environment-quick-look')
  await page.getByRole('button', { name: 'Environment quick look' }).click()

  // Code panel
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await page.getByTestId('code-snippet').waitFor()
  await shot('11-code-snippet')
  await page.getByRole('button', { name: 'Close code snippet' }).click()

  // Console
  await page.locator('.status-bar').getByRole('button', { name: 'Console' }).click()
  await page.locator('.console-request').first().click()
  await shot('12-console')
  await page.locator('.status-bar').getByRole('button', { name: 'Console' }).click()

  // History
  await page.getByRole('tab', { name: 'History' }).click()
  await shot('13-history')
  await page.getByRole('tab', { name: /^Collections/ }).click()

  // Modals
  await page.locator('.sb-toolbar').getByRole('button', { name: 'Import' }).click()
  await page.getByLabel('Import text').fill(`curl -X POST '${base}/orders' -H 'Content-Type: application/json' --data-raw '{"items":[]}'`)
  await shot('14-import')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await shot('15-settings-general')
  await page.getByRole('dialog').getByRole('tab', { name: 'Proxy' }).click()
  await shot('16-settings-proxy')
  await page.getByRole('dialog').getByRole('tab', { name: 'Certificates' }).click()
  await shot('17-settings-certificates')
  await page.keyboard.press('Escape')
  await page.getByTestId('tree-row').filter({ hasText: 'Get customer' }).click()
  await page.locator('.status-bar').getByRole('button', { name: 'Cookies' }).click()
  await page.locator('.cookie-domain').first().click()
  await shot('18-cookies')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New request tab' }).click()
  await url(page).fill(`${base}/status`)
  await page.keyboard.press('ControlOrMeta+s')
  await shot('19-save-request-draft')
  await page.keyboard.press('Escape')

  // Runner with data file
  await writeFile(join(dir, 'customers.csv'), 'customerId\ncus_9921\ncus_7310\ncus_5528\n')
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as any }, join(dir, 'customers.csv'))
  await rowActions(page, 'Payments API')
  await page.getByRole('menuitem', { name: 'Run' }).click()
  await page.getByRole('button', { name: 'Select File' }).click()
  await page.getByRole('button', { name: /^Run Payments API/ }).click()
  await page.getByTestId('runner-results').getByText('Completed').waitFor()
  await shot('20-collection-runner')

  // Mock server (save an example first)
  await page.getByTestId('tree-row').filter({ hasText: 'Get customer' }).click()
  await page.getByRole('button', { name: 'Save as example' }).click()
  await page.keyboard.press('ControlOrMeta+s')
  const mockPort = await freePort()
  await rowActions(page, 'Payments API')
  await page.getByRole('menuitem', { name: 'More' }).hover()
  await page.getByRole('menuitem', { name: 'Mock', exact: true }).click()
  await page.getByRole('dialog', { name: 'Create mock server' }).getByLabel('Name').fill('Payments mock')
  await page.getByRole('dialog', { name: 'Create mock server' }).getByLabel('Port').fill(String(mockPort))
  await shot('21-create-mock-server')
  await page.getByRole('button', { name: 'Create Mock Server' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByTestId('mock-url').waitFor()
  for (const p of ['/customers/cus_9921', '/customers/123', '/unknown']) await fetch(`http://127.0.0.1:${mockPort}${p}`).catch(() => undefined)
  await page.waitForTimeout(300)
  await shot('22-mock-server')

  // Capture
  const capPort = await freePort()
  await page.locator('.status-bar').getByRole('button', { name: /Capture/ }).click()
  await page.getByLabel('Port', { exact: true }).fill(String(capPort))
  await page.getByRole('button', { name: 'Start proxy' }).click()
  await page.getByTestId('capture-status').getByText('Listening').waitFor()
  for (const [m, p] of [['GET', '/customers?limit=5'], ['POST', '/orders'], ['GET', '/customers/42']]) {
    await new Promise<void>((res) => { const r = http.request({ host: '127.0.0.1', port: capPort, method: m, path: `${base}${p}`, headers: { Host: new URL(base).host, 'Content-Type': 'application/json' } }, (x) => { x.resume(); x.on('end', () => res()) }); r.end(m === 'POST' ? '{"items":[{"sku":"PLAN-PRO"}]}' : undefined) })
  }
  await page.locator('.capture-row').nth(1).click()
  await shot('23-capture-proxy')
  await page.getByRole('button', { name: 'Stop proxy' }).click()

  // Performance
  await page.getByRole('tab', { name: /^Collections/ }).click()
  await rowActions(page, 'Payments API')
  await page.getByRole('menuitem', { name: 'More' }).hover()
  await page.getByRole('menuitem', { name: 'Run performance test' }).click()
  await page.getByRole('button', { name: 'Ramp up' }).click()
  await page.getByLabel('Virtual users').fill('15')
  await page.getByLabel('Duration (s)').fill('10')
  await page.getByLabel('Ramp up (s)').fill('4')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByTestId('load-results').getByText('Completed').waitFor({ timeout: 30000 })
  await shot('24-performance-test')

  await app.close()
  server.close()
})
