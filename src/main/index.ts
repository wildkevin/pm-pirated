import { app, safeStorage, session, utilityProcess } from 'electron'
import { join } from 'node:path'
import { safeStorageCrypt } from './crypto'
import { EngineClient, type EngineProcess } from './engineClient'
import { registerIpc } from './ipc'
import { systemProxyFor, writeCaBundle } from './netconfig'
import { SecretStore } from './secrets'
import { AppSettings } from './settings'
import { createMainWindow } from './window'

// Lets tests (and a future portable mode) keep app data in a chosen folder.
if (process.env.PM_LOCAL_USER_DATA) app.setPath('userData', process.env.PM_LOCAL_USER_DATA)
else app.setPath('userData', join(app.getPath('appData'), 'pm-local'))

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
    registerIpc({ win, settings, secrets, engine, caBundle: () => writeCaBundle(join(userData, 'ca-bundle.pem'), settings.get()) })
    app.on('second-instance', () => {
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    app.on('before-quit', () => engine.dispose())
  })
  app.on('window-all-closed', () => app.quit())
}
