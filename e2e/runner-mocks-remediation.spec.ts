import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function workspace(base: string) {
  const root = await mkdtemp(join(tmpdir(), 'pml-independent-'))
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ formatVersion: 1, name: 'Independent QA' }))
  const dir = join(root, 'collections', 'Flow')
  await mkdir(dir, { recursive: true })
  const names = ['First', 'Reset', 'Last']
  await writeFile(join(dir, 'collection.json'), JSON.stringify({ info: { name: 'Flow', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, order: names.map(n => `${n}.request.json`) }))
  for (const [i, name] of names.entries()) {
    const request = { method: 'GET', url: `${base}/${['first', 'reset', 'last'][i]}`, header: [] }
    await writeFile(join(dir, `${name}.request.json`), JSON.stringify({ name, request, response: [{ name: 'Example', code: 200, status: 'OK', header: [], body: 'mock response', originalRequest: request }] }))
  }
  await writeFile(join(root, 'globals.json'), JSON.stringify({ name: 'Globals', values: [{ key: 'token', value: 'QA_SECRET_DO_NOT_SEND', enabled: true }] }))
  return root
}
async function launch(root: string) {
  const userData = await mkdtemp(join(tmpdir(), 'pml-independent-user-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_proxy$/i.test(key)))
  const app = await electron.launch({ args: ['.'], env: { ...env, PM_LOCAL_USER_DATA: userData } })
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, root)
  await page.getByRole('button', { name: 'Open an existing workspace folder…' }).click()
  await page.getByRole('button', { name: 'Create new', exact: true }).waitFor()
  return { app, page }
}
async function server() {
  const seen: { url: string; header: string | string[] | undefined; body: string }[] = []
  const instance = http.createServer((req, res) => {
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      seen.push({ url: req.url ?? '', header: req.headers['x-template'], body })
      if (req.url === '/reset') return req.socket.destroy()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve))
  return { instance, seen, port: (instance.address() as AddressInfo).port, base: `http://127.0.0.1:${(instance.address() as AddressInfo).port}` }
}
async function freePort() {
  const s = await server(); const port = s.port
  await new Promise<void>(resolve => s.instance.close(() => resolve()))
  return port
}
function call(port: number, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ code: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = ''; res.on('data', data => { body += data }); res.on('end', () => resolve({ code: res.statusCode!, headers: res.headers, body }))
    })
    req.on('error', reject); req.end()
  })
}
async function openMock(page: Page) {
  await page.getByRole('button', { name: 'Create new', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mock Server', exact: true }).click()
  return page.getByRole('dialog', { name: 'Create mock server' })
}
async function resize(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700))
}

test('independent QA: runner stops globally on request error and exports the stopped record', async () => {
  const s = await server(); const root = await workspace(s.base); const { app, page } = await launch(root)
  try {
    const row = page.getByRole('treeitem').filter({ has: page.getByText('Flow', { exact: true }) }).first()
    await row.hover(); await row.getByRole('button', { name: 'Actions for Flow' }).click()
    await page.getByRole('menuitem', { name: 'Run', exact: true }).click()
    const iterations = page.locator('#run-iterations')
    await iterations.fill(''); await expect(iterations).toHaveValue(''); await iterations.fill('3')
    await page.getByLabel('Stop run if an error occurs').check()
    await page.getByRole('button', { name: 'Run Flow', exact: true }).click()
    const results = page.getByTestId('runner-results')
    await expect(results.locator('.run-title')).toContainText('Stopped')
    expect(s.seen.map(r => r.url)).toEqual(['/first', '/reset'])
    await expect(results.locator('.run-stats')).toContainText('Request errors 1')
    const file = join(root, 'exported-run.json')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, file)
    await page.getByRole('button', { name: 'Export Results' }).click()
    await expect.poll(async () => { try { return JSON.parse(await readFile(file, 'utf8')).results.length } catch { return 0 } }).toBe(2)
    await resize(app)
    await expect.poll(async () => (await results.boundingBox())?.width ?? 0).toBeGreaterThan(250)
  } finally { await app.close(); s.instance.closeAllConnections(); s.instance.close() }
})

test('independent QA: mock port bounds, CORS, forbidden-host log, and keyboard save', async () => {
  const root = await workspace('http://example.test'); const { app, page } = await launch(root)
  const port = await freePort()
  try {
    const dialog = await openMock(page)
    await dialog.getByLabel('Port', { exact: true }).fill('70000')
    await expect(dialog.getByRole('button', { name: 'Create Mock Server' })).toBeDisabled()
    await dialog.getByLabel('Port', { exact: true }).fill(String(port))
    await dialog.getByLabel('Name', { exact: true }).fill('Cors QA')
    await dialog.getByRole('switch', { name: 'Allow browser access', exact: true }).click()
    await dialog.getByRole('button', { name: 'Create Mock Server' }).click()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page.getByTestId('mock-url')).toBeVisible()
    const preflight = await call(port, '/first', 'OPTIONS', { Origin: 'http://frontend.test', 'Access-Control-Request-Method': 'GET' })
    expect(preflight.code).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect((await call(port, '/first')).headers['access-control-allow-origin']).toBe('*')
    expect((await call(port, '/first', 'GET', { Host: 'evil.test' })).code).toBe(403)
    await expect(page.getByTestId('mock-log')).toContainText('403')
    await page.getByLabel('Name', { exact: true }).fill('Saved by keyboard')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(async () => {
      const files = await readdir(join(root, 'mocks'))
      return Promise.all(files.filter(f => f.endsWith('.json')).map(async f => JSON.parse(await readFile(join(root, 'mocks', f), 'utf8')).name))
    }).toContain('Saved by keyboard')
    await resize(app)
    await expect.poll(async () => (await page.getByTestId('mock-log').boundingBox())?.width ?? 0).toBeGreaterThan(250)
  } finally { await app.close() }
})

test('independent QA: captured URL templates stay literal and header templates require confirmation', async () => {
  const s = await server(); const root = await workspace(s.base); const { app, page } = await launch(root)
  const port = await freePort()
  try {
    await page.locator('.status-bar').getByRole('button', { name: /Capture/ }).click()
    await page.locator('#cap-port').fill(String(port))
    await page.getByRole('button', { name: 'Start proxy' }).click()
    await expect(page.getByTestId('capture-status')).toContainText('Listening')
    await call(port, `${s.base}/literal?q={{token}}`, 'GET', { Host: `127.0.0.1:${s.port}` })
    await page.locator('.capture-row').filter({ hasText: '/literal' }).click()
    await page.getByRole('button', { name: 'Open in tab' }).click()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByTestId('response-status')).toBeVisible()
    expect(s.seen.at(-1)?.url).not.toContain('QA_SECRET_DO_NOT_SEND')
    expect(decodeURIComponent(s.seen.at(-1)!.url)).toContain('{{token}}')
    await page.getByRole('tab', { name: /Capture/ }).click()
    await call(port, `${s.base}/header-template`, 'GET', { Host: `127.0.0.1:${s.port}`, 'X-Template': '{{token}}' })
    await page.locator('.capture-row').filter({ hasText: '/header-template' }).click()
    const confirmation = page.waitForEvent('dialog')
    const opening = page.getByRole('button', { name: 'Open in tab' }).click()
    const prompt = await confirmation
    expect(prompt.message()).toContain('workspace variables')
    await prompt.dismiss(); await opening
    await expect(page.getByRole('button', { name: 'Open in tab' })).toBeVisible()
    expect(s.seen.some(r => JSON.stringify(r).includes('QA_SECRET_DO_NOT_SEND'))).toBe(false)
  } finally { await app.close(); s.instance.closeAllConnections(); s.instance.close() }
})
