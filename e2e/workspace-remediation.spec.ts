import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pml-workspace-qa-'))
  const a = join(root, 'Alpha'), b = join(root, 'Beta')
  for (const [dir, name] of [[a, 'Alpha'], [b, 'Beta']]) {
    await mkdir(dir)
    await writeFile(join(dir, 'workspace.json'), JSON.stringify({ name, formatVersion: 1 }))
  }
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PM_LOCAL_USER_DATA: join(root, 'appdata') } })
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog }, b)
  await page.getByRole('button', { name: 'Open an existing workspace folder…' }).click()
  await expect(page.getByRole('button', { name: 'Create new', exact: true })).toBeVisible()
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog }, a)
  // Fixture setup only; exercise switches through the actual UI below.
  await page.evaluate(async () => {
    await window.api.openWorkspaceDialog()
    const { id } = await window.api.createCollection('Collection')
    await window.api.createRequest(id, 'Saved request')
  })
  await page.reload()
  await expect(page.getByRole('treeitem').filter({ hasText: 'Collection' }).first()).toBeVisible()
  return { root, a, b, app, page }
}
async function switchTo(page: Page, name: string) {
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click()
  await page.getByRole('dialog', { name: 'Switch workspace' }).getByRole('option', { name, exact: true }).click()
  await expect(page.locator('.workspace-name')).toHaveText(name)
}
async function resize(app: ElectronApplication, width: number, height: number, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(width, height)
    win.webContents.setZoomFactor(zoom)
  }, { width, height, zoom })
}

test('quick workspace switches preserve draft tabs and favorites', async () => {
  const { a, app, page } = await fixture()
  try {
    const collection = page.getByRole('treeitem').filter({ hasText: 'Collection' }).first()
    await collection.hover()
    await collection.getByRole('button', { name: 'Favorite Collection', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(join(a, '.pmlocal', 'state.json'), 'utf8').catch(() => '{}')).favorites).toEqual(['collections/Collection'])
    await page.keyboard.press('ControlOrMeta+t')
    await expect(page.getByLabel('Request URL')).toBeFocused()
    await page.getByLabel('Request URL').fill('https://example.test/fast-draft')
    await switchTo(page, 'Beta')
    await switchTo(page, 'Alpha')
    await expect(page.getByLabel('Request URL')).toHaveText('https://example.test/fast-draft')
    await expect(collection.getByRole('button', { name: 'Unfavorite Collection', exact: true })).toHaveCount(1)
    const disk = JSON.parse(await readFile(join(a, '.pmlocal', 'state.json'), 'utf8'))
    expect(disk.tabs.some((t: any) => t.item.request.url === 'https://example.test/fast-draft')).toBe(true)
  } finally { await app.close() }
})

test('dirty tabs offer save, discard and cancel without losing a draft', async () => {
  const { a, app, page } = await fixture()
  try {
    await page.keyboard.press('ControlOrMeta+t')
    await page.getByLabel('Request URL').fill('https://example.test/kept')
    await page.keyboard.press('ControlOrMeta+w')
    const confirm = page.getByRole('dialog', { name: 'Save changes?', exact: true })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByLabel('Request URL')).toHaveText('https://example.test/kept')
    await page.keyboard.press('ControlOrMeta+w')
    await confirm.getByRole('button', { name: 'Save', exact: true }).click()
    const save = page.getByRole('dialog', { name: 'Save request', exact: true })
    await save.getByLabel('Request name').fill('Kept')
    await save.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(save).not.toBeVisible()
    await expect(page.getByRole('tab', { name: /Kept/ })).toHaveCount(0)
    expect(JSON.parse(await readFile(join(a, 'collections', 'Collection', 'Kept.request.json'), 'utf8')).request.url).toBe('https://example.test/kept')
    await page.keyboard.press('ControlOrMeta+t')
    await page.getByLabel('Request URL').fill('https://example.test/discard')
    await page.keyboard.press('ControlOrMeta+w')
    await confirm.getByRole('button', { name: "Don't save", exact: true }).click()
    await expect(page.getByLabel('Request URL')).toHaveCount(0)
  } finally { await app.close() }
})

test('workspace stays in loading state until saved tabs finish restoring', async () => {
  const { app, page } = await fixture()
  try {
    const ui = await page.evaluate(() => window.api.readUiState())
    await app.evaluate(({ ipcMain }, state) => {
      ipcMain.removeHandler('ui:read')
      ipcMain.handle('ui:read', async () => { await new Promise((resolve) => setTimeout(resolve, 750)); return state })
    }, ui)
    await page.reload()
    await expect(page.getByRole('status').filter({ hasText: 'Opening workspace' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New request tab', exact: true })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+t')
    await expect(page.getByRole('treeitem').filter({ hasText: 'Collection' }).first()).toBeVisible()
    await page.keyboard.press('ControlOrMeta+t')
    await expect(page.getByLabel('Request URL')).toBeFocused()
    await page.getByLabel('Request URL').fill('https://example.test/restored')
    await expect(page.getByLabel('Request URL')).toHaveText('https://example.test/restored')
  } finally { await app.close() }
})

test('zoom and resize preserve a usable editor, visible active tab and accessible overlays', async ({}, testInfo) => {
  const { app, page } = await fixture()
  try {
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'New request tab', exact: true }).click()
    for (const zoom of [1, 1.2, 1.44, 1]) {
      await resize(app, 1024, 700, zoom)
      await expect.poll(() => page.locator('.request-main').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(400)
      await expect(page.getByRole('button', { name: 'New request tab', exact: true })).toBeInViewport()
      await expect(page.getByLabel('Request URL')).toBeInViewport()
      expect(await page.locator('.request-main').evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(200)
      await expect(page.locator('.tab.active')).toBeInViewport()
      expect(await page.getByLabel('Request URL').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(160)
    }
    const right = await page.getByRole('complementary', { name: 'Right panel' }).boundingBox()
    expect(right!.width).toBeLessThan(270)
    await resize(app, 900, 560)
    await expect.poll(() => page.locator('.request-main').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(600)
    await page.getByRole('button', { name: /right panel/ }).last().click()
    await expect(page.locator('.panel-overlay.right')).toBeVisible()
    await page.locator('.panel-overlay.right').getByRole('button', { name: 'Close right panel' }).click()
    await expect(page.locator('.panel-overlay.right')).toHaveCount(0)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('workspace-remediation-900.png'), Buffer.from(png, 'base64'))
  } finally { await app.close() }
})
