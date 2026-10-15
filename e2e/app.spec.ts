import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temp = (prefix: string) => mkdtemp(join(tmpdir(), prefix))

function launch(userData: string): Promise<ElectronApplication> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(http|https|all|no)_proxy$/i.test(k)),
  ) as Record<string, string>
  return electron.launch({ args: ['.'], env: { ...env, PM_LOCAL_USER_DATA: userData } })
}

async function stubFolderPicker(app: ElectronApplication, dir: string) {
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
  }, dir)
}

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

test('create a workspace, build a POST request, send it, save it, reopen it', async () => {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, token: req.headers['x-token'] ?? null, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/echo`
  const userData = await temp('pml-ud-')
  const dir = await temp('pml-ws-')

  let app = await launch(userData)
  let page = await app.firstWindow()
  await stubFolderPicker(app, dir)
  await page.getByRole('button', { name: 'Open workspace' }).first().click()

  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Name').fill('Demo API')
  await page.getByLabel('Name').press('Enter')
  await page.getByRole('button', { name: 'Actions for Demo API' }).click()
  await page.getByRole('menuitem', { name: 'Add request' }).click()
  await page.getByLabel('Name').fill('Echo')
  await page.getByLabel('Name').press('Enter')

  await page.getByLabel('HTTP method').selectOption('POST')
  await page.getByPlaceholder('Enter URL or paste text').fill(url)
  await page.getByLabel('Key').last().fill('X-Token')
  await page.getByLabel('Value').first().fill('abc')
  await page.getByRole('tab', { name: 'Body' }).click()
  await page.getByLabel('raw').check()
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
    request: { method: 'POST', url, header: [{ key: 'X-Token', value: 'abc' }], body: { mode: 'raw', raw: '{"hello":"world"}' } },
  })
  await app.close()

  // The last workspace reopens on the next launch.
  app = await launch(userData)
  page = await app.firstWindow()
  await expect(page.getByTestId('tree-row').filter({ hasText: 'Demo API' })).toBeVisible()
  await page.getByTestId('tree-row').filter({ hasText: 'Demo API' }).click()
  await page.getByTestId('tree-row').filter({ hasText: 'Echo' }).click()
  await expect(page.getByPlaceholder('Enter URL or paste text')).toHaveValue(url)
  await app.close()
  server.close()
})

test('a failed request shows the reason instead of crashing', async () => {
  const app = await launch(await temp('pml-ud-'))
  const page = await app.firstWindow()
  await stubFolderPicker(app, await temp('pml-ws-'))
  await page.getByRole('button', { name: 'Open workspace' }).first().click()
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Name').press('Enter')
  await page.getByRole('button', { name: 'Actions for New Collection' }).click()
  await page.getByRole('menuitem', { name: 'Add request' }).click()
  await page.getByLabel('Name').press('Enter')
  await page.getByPlaceholder('Enter URL or paste text').fill('http://127.0.0.1:1/')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('response-error')).toContainText('ECONNREFUSED')
  await app.close()
})
