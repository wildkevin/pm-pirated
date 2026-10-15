import { app, safeStorage, session, utilityProcess } from 'electron'
import { join } from 'node:path'
import { safeStorageCrypt } from './crypto'
import { CAPTURE_EVENT, MOCK_EVENT } from '../shared/ipc'
import type { FromProxy, ToProxy, UpstreamProxy } from '../shared/engine'
import { sessionProxyConfig, upstreamFor } from './capture'
import { CaptureManager, ProxyClient } from './captureManager'
import type { FromMocks, ToMocks } from '../shared/mock'
import { EngineClient, type ChildProcess, type EngineProcess } from './engineClient'
import { MockClient, MockManager } from './mocks'
import { registerIpc } from './ipc'
import { systemProxyFor, writeCaBundle } from './netconfig'
import { SecretStore } from './secrets'
import { AppSettings } from './settings'
import { createMainWindow } from './window'

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
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    const userData = app.getPath('userData')
    const crypt = safeStorageCrypt(safeStorage)
    const settings = new AppSettings(join(userData, 'settings.json'), crypt)
    const secrets = new SecretStore(join(userData, 'secrets.json'), crypt)
    const engine = new EngineClient(
      forkEngine,
      (url) => systemProxyFor((u) => session.defaultSession.resolveProxy(u), url, settings.get()),
      (code) => console.error(`Engine process exited with code ${code}`),
    )
    const win = createMainWindow()
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
    registerIpc({ win, settings, secrets, engine, mocks, capture, caBundle: () => writeCaBundle(join(userData, 'ca-bundle.pem'), settings.get()) })
    // Windows proxy settings must be given back before the app exits.
    let restored = false
    app.on('will-quit', (e) => {
      if (restored) return
      e.preventDefault()
      void capture.shutdown().finally(() => {
        restored = true
        app.quit()
      })
    })
    app.on('second-instance', () => {
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    app.on('before-quit', () => {
      engine.dispose()
      mockClient.dispose()
    })
  })
  app.on('window-all-closed', () => app.quit())
}
