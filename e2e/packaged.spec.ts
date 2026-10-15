// Smoke test of the packaged app (portable exe / unpacked folder). Run with PM_LOCAL_EXE=<path to the executable>.
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exe = process.env.PM_LOCAL_EXE
test.skip(!exe, 'set PM_LOCAL_EXE to the packaged executable')

const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => r(p))
    })
  })

test('packaged app: request engine, mock server and capture proxy processes all start', async () => {
  const server = http.createServer((_q, r) => r.end('{"packaged":true}'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(http|https|all|no)_proxy$/i.test(k))) as Record<string, string>
  const app = await electron.launch({ executablePath: exe!, env: { ...env, PM_LOCAL_USER_DATA: await mkdtemp(join(tmpdir(), 'pml-pkg-')) } })
  const dir = await mkdtemp(join(tmpdir(), 'pml-pkg-ws-'))
  await app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as typeof dialog.showOpenDialog
  }, dir)
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Open an existing workspace folder…' }).click()

  // Engine process (send).
  await page.getByRole('button', { name: 'New request tab' }).click()
  await page.getByLabel('Request URL').fill(`${base}/x`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  // On failure, say what the response area shows (error text, still sending, …).
  await expect(page.getByTestId('response-body'), await page.waitForTimeout(3000).then(() => page.locator('.response').first().innerText().catch((e) => String(e)))).toContainText('"packaged": true')

  // Capture proxy process.
  const proxyPort = await freePort()
  await page.locator('.status-bar').getByRole('button', { name: /Capture/ }).click()
  await page.getByLabel('Port', { exact: true }).fill(String(proxyPort))
  await page.getByRole('button', { name: 'Start proxy' }).click()
  await expect(page.getByTestId('capture-status')).toHaveText(`Listening on 127.0.0.1:${proxyPort}`)
  await page.getByRole('button', { name: 'Stop proxy' }).click()

  // Mock server process.
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Collection' }).click()
  await page.getByLabel('Name').press('Enter')
  const mockPort = await freePort()
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'Mock Server' }).click()
  await page.getByRole('dialog', { name: 'Create mock server' }).getByLabel('Port').fill(String(mockPort))
  await page.getByRole('button', { name: 'Create Mock Server' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('mock-url')).toHaveText(`http://127.0.0.1:${mockPort}`)

  await app.close()
  server.close()
})
