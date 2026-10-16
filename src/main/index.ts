/// <reference types="electron-vite/node" />
import { app, Menu, safeStorage, session, utilityProcess, type Tray } from 'electron'
// Copied into out/ by electron-vite, so `npm start` shows our icon instead of Electron's.
import icon from '../../build/icon.png?asset'
import { join } from 'node:path'
import { safeStorageCrypt } from './crypto'
import { CAPTURE_EVENT, MOCK_EVENT } from '../shared/ipc'
import type { FromLoad, FromProxy, ToLoad, ToProxy, UpstreamProxy } from '../shared/engine'
import { LoadClient } from './loadtest'
import { sessionProxyConfig, upstreamFor } from './capture'
import { CaptureManager, ProxyClient } from './captureManager'
import type { FromMocks, ToMocks } from '../shared/mock'
import { EngineClient, type ChildProcess, type EngineProcess } from './engineClient'
import { MockClient, MockManager } from './mocks'
import { registerIpc } from './ipc'
import { systemProxyFor, writeCaBundle } from './netconfig'
import { SecretStore } from './secrets'
import { AppSettings } from './settings'
import { allowRendererPermission, applicationMenuTemplate, createMainWindow, rendererLocation } from './window'
import { createWindowsTray, restoreWindow } from './tray'

app.setName('PM Local')

// Lets tests (and a future portable mode) keep app data in a chosen folder.
if (process.env.PM_LOCAL_USER_DATA) app.setPath('userData', process.env.PM_LOCAL_USER_DATA)
else app.setPath('userData', join(app.getPath('appData'), 'pm-local'))

function forkMocks(): ChildProcess<ToMocks, FromMocks> {
  const child = utilityProcess.fork(join(__dirname, 'mocks.js'), [], { serviceName: 'PM Local Mock Servers' })
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.on('exit', cb),
    kill: () => void child.kill(),
  }
}

function forkProxy(): ChildProcess<ToProxy, FromProxy> {
  const child = utilityProcess.fork(join(__dirname, 'proxy.js'), [], { serviceName: 'PM Local Capture Proxy' })
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.on('exit', cb),
    kill: () => void child.kill(),
  }
}

function forkLoad(): ChildProcess<ToLoad, FromLoad> {
  const child = utilityProcess.fork(join(__dirname, 'loadtest.js'), [], { serviceName: 'PM Local Load Test' })
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.on('exit', cb),
    kill: () => void child.kill(),
  }
}

function forkEngine(): EngineProcess {
  const child = utilityProcess.fork(join(__dirname, 'engine.js'), [], { serviceName: 'PM Local Engine' })
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => child.on('message', cb),
    onExit: (cb) => child.on('exit', cb),
    kill: () => void child.kill(),
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    const userData = app.getPath('userData')
    const crypt = safeStorageCrypt(safeStorage)
    const settings = new AppSettings(join(userData, 'settings.json'), crypt)
    const secrets = new SecretStore(join(userData, 'secrets.json'), crypt)
    const engine = new EngineClient(
      forkEngine,
      (url) => systemProxyFor((u) => session.defaultSession.resolveProxy(u), url, settings.get()),
      (code) => console.error(`Engine process exited with code ${code}`),
    )
    // Remember the zoom level between sessions (keyboard and View-menu zoom alike).
    const saveZoom = (zoomLevel: number) => {
      if (zoomLevel !== settings.get().zoomLevel) void settings.save({ ...settings.get(), zoomLevel })
    }
    app.dock?.setIcon(icon)
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate(process.platform, !!process.env.ELECTRON_RENDERER_URL, saveZoom)))
    let quitting = false
    let tray: Tray | undefined
    const win = createMainWindow(saveZoom, icon, () => !!tray && !quitting)
    tray = createWindowsTray(win, icon, () => app.quit())
    app.on('quit', () => tray?.destroy())
    // Copy buttons are permitted only in our trusted main renderer.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(wc === win.webContents && allowRendererPermission(permission, wc.getURL(), details.requestingUrl, rendererLocation()))
    })
    win.webContents.on('did-finish-load', () => win.webContents.setZoomLevel(settings.get().zoomLevel))
    win.on('close', () => saveZoom(win.webContents.getZoomLevel()))
    const mockClient = new MockClient(forkMocks, (code) => console.error(`Mock server process exited with code ${code}`))
    const mocks = new MockManager(mockClient, (e) => !win.isDestroyed() && win.webContents.send(MOCK_EVENT, e))
    // Upstream for captured traffic: the proxy Windows used before capture took over (incl. PAC).
    let upstreamSession: { key: string; session: Electron.Session } | undefined
    const resolverFor = async () => {
      const previous = await capture.previousSystemSettings()
      if (!previous) return session.defaultSession
      const config = sessionProxyConfig(previous)
      const key = JSON.stringify(config)
      if (upstreamSession?.key !== key) {
        const s = session.fromPartition('pmlocal-upstream')
        await s.setProxy(config)
        upstreamSession = { key, session: s }
      }
      return upstreamSession.session
    }
    const proxyClient: ProxyClient = new ProxyClient(
      forkProxy,
      async (url): Promise<UpstreamProxy | null> => {
        const resolver = await resolverFor()
        return upstreamFor(url, settings.get(), capture.port, (u) => resolver.resolveProxy(u))
      },
      (code) => console.error(`Capture proxy process exited with code ${code}`),
    )
    const capture: CaptureManager = new CaptureManager(proxyClient, join(userData, 'proxy'), crypt, (e) => !win.isDestroyed() && win.webContents.send(CAPTURE_EVENT, e))
    void capture.init()
    const load = new LoadClient(
      forkLoad,
      (url) => systemProxyFor((u) => session.defaultSession.resolveProxy(u), url, settings.get()),
      (code) => console.error(`Load test process exited with code ${code}`),
    )
    registerIpc({ win, settings, secrets, engine, mocks, capture, load, caBundle: () => writeCaBundle(join(userData, 'ca-bundle.pem'), settings.get()) })
    // Windows proxy settings must be given back before the app exits.
    let restored = false
    app.on('will-quit', (e) => {
      if (restored) return
      e.preventDefault()
      // Also let pending settings writes (e.g. the zoom level saved on close) reach the disk.
      void Promise.allSettled([capture.shutdown(), settings.flush()]).finally(() => {
        restored = true
        app.quit()
      })
    })
    app.on('second-instance', () => {
      restoreWindow(win)
    })
    app.on('before-quit', () => {
      quitting = true
      engine.dispose()
      mockClient.dispose()
      load.dispose()
    })
  })
  app.on('window-all-closed', () => app.quit())
}
