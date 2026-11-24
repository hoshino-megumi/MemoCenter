import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Store } from '../server/store.mjs'
import { createAppServer } from '../server/app.mjs'
import { createScheduler } from '../server/scheduler.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 5178)
const BASE = `http://127.0.0.1:${PORT}`
const PRELOAD = path.join(__dirname, 'preload.cjs')
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png')

const TOAST_W = 420
const TOAST_H = 198
const TOAST_LIFE = 14000
const TRAY_CLICK_DELAY = 220

let tray = null
let mainWindow = null
let focusWindow = null
let toastWindow = null
let activeToast = null
let quitting = false
const toastQueue = []

const store = new Store(path.join(ROOT, 'data'))
await store.ready

let server = null
let ownsServer = false

function startServer() {
  return new Promise((resolve, reject) => {
    const s = createAppServer({ store, distDir: path.join(ROOT, 'dist') })
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log('[desktop] 端口已被占用，复用现有服务')
        resolve(false)
      } else {
        reject(err)
      }
    })
    s.listen(PORT, '127.0.0.1', () => {
      ownsServer = true
      server = s
      resolve(true)
    })
  })
}

function pingDesktop() {
  fetch(`${BASE}/api/desktop/ping`, { method: 'POST' }).catch(() => {})
}

function workArea() {
  const display = screen.getPrimaryDisplay()
  return display.workArea
}

function createToastWindow(memo) {
  const area = workArea()
  const win = new BrowserWindow({
    width: TOAST_W,
    height: TOAST_H,
    x: area.x + area.width - TOAST_W - 18,
    y: area.y + area.height - TOAST_H - 18,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL(`${BASE}/toast.html?id=${encodeURIComponent(memo.id)}`)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => {
    if (toastWindow === win) toastWindow = null
    if (activeToast === memo.id) activeToast = null
    setTimeout(pumpToasts, 260)
  })

  setTimeout(() => {
    if (!win.isDestroyed()) win.close()
  }, TOAST_LIFE + 6000)

  return win
}

function pumpToasts() {
  if (toastWindow || !toastQueue.length) return
  const memo = toastQueue.shift()
  activeToast = memo.id
  toastWindow = createToastWindow(memo)
}

function notify(memo) {
  if (toastQueue.length >= 5) toastQueue.shift()
  toastQueue.push(memo)
  pumpToasts()
}

function createMainWindow(query = '') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    if (query) mainWindow.loadURL(`${BASE}/${query}`)
    return mainWindow
  }
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#f6f6f3',
    title: '备忘中心',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadURL(`${BASE}/${query}`)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
  })
  return mainWindow
}

function createFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show()
    focusWindow.focus()
    return focusWindow
  }

  const settings = store.getSettings()
  const area = workArea()
  const bounds = settings.focusBounds || {
    width: 384,
    height: 560,
    x: area.x + area.width - 384 - 24,
    y: area.y + 72
  }

  focusWindow = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 420,
    frame: false,
    title: '今日焦点',
    backgroundColor: '#ffffff',
    show: false,
    skipTaskbar: false,
    alwaysOnTop: Boolean(settings.focusTopmost),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (settings.focusTopmost) focusWindow.setAlwaysOnTop(true, 'floating')
  focusWindow.loadURL(`${BASE}/focus.html`)
  focusWindow.once('ready-to-show', () => focusWindow.show())

  const saveBounds = () => {
    if (!focusWindow || focusWindow.isDestroyed() || focusWindow.isMinimized()) return
    store.updateSettings({ focusBounds: focusWindow.getBounds() }).catch(() => {})
  }
  focusWindow.on('moved', saveBounds)
  focusWindow.on('resized', saveBounds)
  focusWindow.on('closed', () => {
    focusWindow = null
  })
  return focusWindow
}

function buildTrayMenu() {
  const settings = store.getSettings()
  const pending = store.list().filter((m) => !m.deletedAt && m.status === 'open').length
  return Menu.buildFromTemplate([
    { label: `未完成 ${pending} 条`, enabled: false },
    { type: 'separator' },
    { label: '今日焦点', click: () => createFocusWindow() },
    { label: '打开主界面', click: () => createMainWindow() },
    { label: '新建待办', click: () => createMainWindow('?quick=1') },
    { type: 'separator' },
    {
      label: '启用提醒',
      type: 'checkbox',
      checked: settings.notifyEnabled,
      click: (item) => {
        store.updateSettings({ notifyEnabled: item.checked }).then(() => {
          if (tray) tray.setContextMenu(buildTrayMenu())
        })
      }
    },
    { label: '打开数据目录', click: () => shell.openPath(path.join(ROOT, 'data')) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function refreshTray() {
  if (!tray) return
  const pending = store.list().filter((m) => !m.deletedAt && m.status === 'open').length
  tray.setToolTip(`备忘中心 · 未完成 ${pending} 条`)
  tray.setContextMenu(buildTrayMenu())
}

function setupIpc() {
  ipcMain.handle('focus:topmost', async (_event, value) => {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.setAlwaysOnTop(Boolean(value), 'floating')
    }
    await store.updateSettings({ focusTopmost: Boolean(value) })
    return Boolean(value)
  })

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
    return true
  })

  ipcMain.handle('app:open-main', (_event, query) => {
    createMainWindow(typeof query === 'string' ? query : '')
    return true
  })

  ipcMain.handle('app:open-focus', () => {
    createFocusWindow()
    return true
  })

  ipcMain.handle('app:open-memo', (_event, id) => {
    createMainWindow(id ? `?memo=${encodeURIComponent(id)}` : '')
    return true
  })
}

async function bootstrap() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    const { dialog } = await import('electron')
    dialog.showErrorBox('前端未构建', '请先在项目目录执行 npm run build，再启动桌面端。')
    app.quit()
    return
  }

  await startServer()

  const icon = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('备忘中心')
  tray.setContextMenu(buildTrayMenu())

  let clickTimer = null
  let suppressClickUntil = 0
  tray.on('click', () => {
    if (Date.now() < suppressClickUntil) return
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => createFocusWindow(), TRAY_CLICK_DELAY)
  })
  tray.on('double-click', () => {
    suppressClickUntil = Date.now() + 400
    clearTimeout(clickTimer)
    createMainWindow()
  })

  setupIpc()

  const scheduler = createScheduler({
    store,
    onDue: async (memo) => {
      notify(memo)
    }
  })
  scheduler.start()

  setInterval(pingDesktop, 30000)
  pingDesktop()

  setInterval(refreshTray, 60000)

  if (process.env.MEMO_OPEN_FOCUS === '1') createFocusWindow()
}

app.setAppUserModelId('com.memo.center')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.show()
      focusWindow.focus()
    } else {
      createMainWindow()
    }
  })

  app.whenReady().then(bootstrap)

  app.on('activate', () => {
    if (!mainWindow) createMainWindow()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不随窗口关闭退出
  })

  app.on('before-quit', () => {
    quitting = true
    if (server && ownsServer) server.close()
  })
}
