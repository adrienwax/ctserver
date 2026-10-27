// waxyct as one app: this Electron main process runs the router (the HTTP panel, the owners, the claim
// watch) in-process and shows the panel in its own window. No console, no browser, one exe.
//
//   one instance     Electron's lock; a second launch brings this window forward and quits
//   the CT modules   shipped in resources/ct (connect-ct, ct-claim, ct-draw, serialport, loupedeck)
//   the config       %APPDATA%\waxyct\config, seeded from the shipped one on first run; editable in
//                    the window or any text editor, with the last-good fallback as before
//   the tray         waxyct lives in the notification area: closing or minimising the window hides it there,
//                    the tray's Quit is the real exit. --start-in-tray (the Windows startup entry) starts hidden
//   closing          every owner waxyct started closes the CT itself before the app exits
import { app, BrowserWindow, Menu, Tray, dialog, shell, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { upgradeConfig } from '../host/config-upgrade.mjs'
import {homeWindowBounds} from '../host/home-window.mjs'
import {initHomeCandidate} from '../host/home-candidate.mjs'

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Plain files, not archives: the router reads EDENA's app.asar byte for byte to see whether that build has
// the hand-off hooks. With Electron's asar support on, that read fails and every EDENA build looked
// hook-less, so the CT was never handed to it (1 Oct). waxyct itself is not packed as asar.
process.noAsar = true

const homeCandidate=initHomeCandidate(app,APP_DIR)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let win = null, tray = null, quitting = false
  let routerPromise, shutdownTask = null, shutdownComplete = false, errorDialog = null
  const startInTray = process.argv.includes('--start-in-tray')
  const showWin = () => { if (!win || quitting || shutdownComplete) return; if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  // the real exit: the tray's Quit (and POST /api/quit, the same function). The owners close the CT first.
  const quitApp = () => app.quit()
  app.on('second-instance', showWin)   // a second launch (or the Start menu) brings the window out of the tray

  // Where things live. Packaged: the CT modules beside the app, the config in the user's AppData.
  // From source: the versioned integrations/ct-td-control directory and the repo's config, as the bat uses.
  const packaged = app.isPackaged
  if (packaged) {
    process.env.WAXYCT_BRIDGE ||= path.join(process.resourcesPath, 'ct')
    // ponytail: the CT modules' dependencies ship as "modules" (electron-builder drops node_modules from
    // extra resources) and are renamed back here. The portable exe unpacks to a fresh, writable temp
    // folder on every launch; an install into a read-only folder would need them copied to AppData.
    const nm = path.join(process.resourcesPath, 'ct', 'node_modules'), shipped = path.join(process.resourcesPath, 'ct', 'modules')
    if (!fs.existsSync(nm) && fs.existsSync(shipped)) fs.renameSync(shipped, nm)
    const cfg = homeCandidate ? process.env.WAXYCT_CONFIG : path.join(app.getPath('appData'), 'waxyct', 'config')
    process.env.WAXYCT_CONFIG ||= cfg
    const update = upgradeConfig({ shipped: path.join(APP_DIR, 'config'), user: process.env.WAXYCT_CONFIG, version: app.getVersion() })
    const kept = update.files.filter(f => f.status === 'preserved')
    if (kept.length) console.log(`waxyct: kept ${kept.length} user configuration files; shipped alternatives are in ${path.join(process.env.WAXYCT_CONFIG, '.updates', 'incoming')}`)
    const routerCfg = path.join(app.getPath('appData'), 'waxyct', 'config.json')   // port, where EDENA lives: optional
    if (!homeCandidate && fs.existsSync(routerCfg)) process.env.WAXYCT_ROUTER_CONFIG ||= routerCfg
    // Legacy companion paths are configured explicitly by the user, never seeded from a studio install.
  }

  // Install before the asynchronous router import: even an early or repeated Quit must wait
  // for its owners to settle. Only a successful shutdown opens the normal Electron quit path.
  app.on('window-all-closed', quitApp)
  app.on('before-quit', (e) => {
    if (shutdownComplete) return
    e.preventDefault()
    quitting = true
    if (shutdownTask) return
    shutdownTask = Promise.resolve().then(() => routerPromise)
      .then(router => router.shutdown('the app is closing'))
      .then(() => { shutdownComplete = true; app.quit() }, error => {
        shutdownTask = null
        quitting = false
        showShutdownFailure(error)
      })
  })

  function showShutdownFailure(error) {
    if (errorDialog) return
    errorDialog = (async () => {
      await app.whenReady()
      if (shutdownComplete) return
      showWin()
      const { response } = await dialog.showMessageBox({
        type: 'error', title: 'CT server could not close',
        message: 'A controller owner has not closed. CT server will stay open.',
        detail: `${error?.message || error}\n\nNew controller connections remain paused. Choose Retry to release the controller and quit, or Keep open to inspect the app and try Quit again.`,
        buttons: ['Retry', 'Keep open'], defaultId: 0, cancelId: 1, noLink: true,
      })
      if (response === 0) quitApp()
      else { await openWindow(); showWin() }
    })().catch(dialogError => {
      console.error('waxyct: could not display shutdown recovery', dialogError)
      try { dialog.showErrorBox('CT server is still open', `Shutdown failed: ${error?.message || error}. Choose Quit again to retry.`) } catch { /* the original shutdown failure must not become an unhandled rejection */ }
    }).finally(() => { errorDialog = null })
  }

  routerPromise = import('../router.mjs').then(router => { router.hooks.quit = quitApp; router.hooks.guides=async file=>{const message=await shell.openPath(file);if(message)throw Error(message)}; router.hooks.panel=async intent=>{if(!['setup','device'].includes(intent))throw Error('Unknown panel');await openWindow();showWin()}; return router })

  async function openWindow() {
    await app.whenReady()
    if (quitting || shutdownComplete || win) return
    Menu.setApplicationMenu(null)
    const router = await routerPromise
    const r = await router.ready
    if (quitting || shutdownComplete || win) return
    if (r.error) {
      dialog.showErrorBox('waxyct', `waxyct could not start: ${r.error}.`)
      return app.quit()
    }
    win = new BrowserWindow({
      ...homeWindowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea),
      title: homeCandidate?'CTserver Home candidate r04':'CTserver · KRAB v1.0', icon: path.join(APP_DIR, 'waxyct.ico'),
      backgroundColor: '#0b0d10', show: false, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    })
    win.once('ready-to-show', () => { if (!startInTray && !quitting && !shutdownComplete) win.show() })
    // exit-to-tray: closing the window hides it; the CT stays held and the deck keeps running. Minimise does the same.
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide() } })
    win.on('minimize', () => win.hide())
    win.on('session-end', () => { quitting = true })   // Windows logging off or shutting down: a real close, the CT released first
    tray = new Tray(path.join(APP_DIR, 'waxyct.ico'))
    tray.setToolTip(homeCandidate?'CTserver Home candidate r04':'CTserver · KRAB v1.0')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open CTserver', click: showWin },
      { type: 'separator' },
      { label: 'Quit CTserver (releases the CT)', click: quitApp },
    ]))
    tray.on('click', showWin)
    tray.on('double-click', showWin)
    // links out of the panel (none today) open in the browser, never in a second app window
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
    await win.loadURL(r.url)
  }
  openWindow().catch(error => {
    if (quitting || shutdownComplete) return
    dialog.showErrorBox('CT server could not start', `${error?.message || error}`)
    quitApp()
  })
}
