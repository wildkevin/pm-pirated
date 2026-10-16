import { _electron as electron, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function verifyWindowsTray(exe?: string) {
  test.skip(process.platform !== 'win32', 'Windows system tray behavior')
  const root = await mkdtemp(join(tmpdir(), 'pm-tray-'))
  const env = { ...process.env, PM_LOCAL_USER_DATA: join(root, 'appdata') }
  const args = exe ? [] : ['.']
  const app = await electron.launch({ ...(exe ? { executablePath: exe } : {}), args, env })
  const child = app.process()
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    }, root)
    await page.getByRole('button', { name: 'Open an existing workspace folder…' }).click()
    await page.getByRole('button', { name: 'New request tab', exact: true }).click()
    await page.getByLabel('Request URL').fill('https://example.test/tray-draft')
    await expect(page.locator('.tabs .tab-dirty')).toHaveCount(1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.isVisible()))).toEqual([false])
    expect(child.exitCode).toBeNull()
    // Exercise the actual single-instance path by launching the executable again.
    const executable = await app.evaluate(() => process.execPath)
    await promisify(execFile)(executable, args, { env, timeout: 15_000 })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => win.isVisible()))).toEqual([true])
    await expect(page.getByLabel('Request URL')).toHaveText('https://example.test/tray-draft')
    // Quit while hidden must bypass close-to-tray rather than keeping a headless process alive.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  } finally { await app.close() }
  expect(child.exitCode).toBe(0)
}
