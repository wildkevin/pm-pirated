import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('response copy, search, saved examples, image and non-UTF-8 preview work in the app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pml-response-qa-'))
  const server = http.createServer((req, res) => {
    if (req.url === '/latin') { res.setHeader('content-type', 'text/plain; charset=iso-8859-1'); res.end(Buffer.from([99, 97, 102, 233])); return }
    if (req.url === '/image') { res.setHeader('content-type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64')); return }
    res.setHeader('content-type', 'application/json'); res.setHeader('set-cookie', 'qa=one; Max-Age=3600; Path=/')
    res.end(JSON.stringify({ marker: 'find-this-response', url: req.url }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/_proxy$/i.test(key)))
  const app = await electron.launch({ args: ['.'], env: { ...env, PM_LOCAL_USER_DATA: join(root, 'appdata') } })
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const page = await app.firstWindow()
    const ws = join(root, 'workspace')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, ws)
    await page.getByRole('button', { name: 'Open an existing workspace folder…' }).click()
    await expect(page.getByRole('button', { name: 'Create new', exact: true })).toBeVisible()
    await page.evaluate(async (base) => {
      const { id } = await window.api.createCollection('Responses')
      await window.api.createRequest(id, 'Request', { name: 'Request', request: { method: 'GET', url: `${base}/json`, header: [] } })
    }, base)
    await page.reload()
    const col = page.getByRole('treeitem').filter({ has: page.getByText('Responses', { exact: true }) }).first()
    await col.getByRole('button', { name: 'Expand', exact: true }).click()
    await page.getByRole('treeitem').filter({ has: page.getByText('Request', { exact: true }) }).dblclick()
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await send.click()
    await expect(page.getByTestId('response-body')).toContainText('find-this-response')
    await page.getByRole('button', { name: 'Copy response body' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('find-this-response')
    await page.getByRole('button', { name: 'Search response body' }).click()
    const search = page.locator('.response .cm-search input[name="search"]')
    await search.pressSequentially('find-this-response')
    await expect(page.locator('.response .cm-searchMatch')).toHaveCount(1)
    await search.press('Escape')
    await page.locator('.response').getByRole('tab', { name: /^Cookies/ }).click()
    await expect(page.locator('.response')).not.toContainText('Session')
    await page.locator('.response').getByRole('tab', { name: 'Body', exact: true }).click()
    await page.getByRole('button', { name: 'Response options' }).click()
    await page.getByRole('menuitem', { name: 'Save as example', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Example saved' })).toBeVisible()
    const saved = JSON.parse(await readFile(join(ws, 'collections', 'Responses', 'Request.request.json'), 'utf8'))
    expect(saved.response).toHaveLength(1)
    await page.getByLabel('Saved examples').selectOption('0')
    await expect(page.getByTestId('response-body')).toContainText('find-this-response')
    await page.getByRole('tab', { name: 'Code', exact: true }).click()
    await expect(page.getByTestId('code-snippet')).toContainText('/json')
    await page.getByRole('button', { name: 'Copy snippet', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('/json')
    await page.getByLabel('Request URL').fill(`${base}/latin`)
    await send.click()
    await expect(page.getByLabel('Response body', { exact: true })).toHaveText('café')
    // Saving a selected historical example must download that example, not the current Latin response.
    await page.getByLabel('Saved examples').selectOption('0')
    await expect(page.getByTestId('response-body')).toContainText('find-this-response')
    const exported = join(root, 'example.json')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, exported)
    await page.getByRole('button', { name: 'Response options' }).click()
    await page.getByRole('menuitem', { name: 'Save response to file', exact: true }).click()
    await expect.poll(async () => readFile(exported, 'utf8').catch(() => '')).toContain('find-this-response')
    await page.getByLabel('Request URL').fill(`${base}/image`)
    await send.click()
    await expect(page.getByAltText('Response preview')).toBeVisible()
    expect(await page.getByAltText('Response preview').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1)
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard)
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
