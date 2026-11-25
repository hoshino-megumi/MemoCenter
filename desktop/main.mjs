import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  shell,
  Notification,
  nativeTheme
} from 'electron'
import path from 'node:path'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS } from '../server/store.mjs'
import { createAppServer } from '../server/app.mjs'
import { createScheduler } from '../server/scheduler.mjs'
import { createLazyStore } from '../server/lazy-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 5178)
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = path.join(ROOT, 'data')
const PRELOAD = path.join(__dirname, 'preload.cjs')
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png')

const TOAST_W = 420
const TOAST_H = 198
const TOAST_LIFE = 14000
const TRAY_CLICK_DELAY = 220

const REMINDER_INTERVAL = 20000
const TRAY_REFRESH_INTERVAL = 60000
const PING_INTERVAL = 30000
/** 轮询失败后多久内，托盘提示显示「服务不可达」 */
const OFFLINE_HINT_MS = 90000

/** 桌面端标记：服务端据此把审计 actor 记为 desktop */
const DESKTOP_HEADERS = { 'x-memo-client': 'desktop' }

let tray = null
let mainWindow = null
let focusWindow = null
let toastWindow = null
let activeToast = null
let quitting = false
const toastQueue = []

/**
 * 运行模式：
 *   exclusive —— 本进程抢到端口，独占持有 Store 并对外提供 HTTP 服务
 *   shared    —— 端口已被占用（如先双击了 start.bat），本进程**不创建 Store、不写盘**，
 *                只做窗口 + 托盘，所有数据读写走已有服务的 HTTP API
 * @type {'exclusive'|'shared'}
 */
let mode = 'exclusive'
let lastPollErrorAt = 0
let pollTimer = null

/** 本地缓存：托盘与焦点窗需要同步读取，不能每次 await */
let cachedMemos = []
let cachedSettings = { ...DEFAULT_SETTINGS }

let server = null
let ownsServer = false

/**
 * 门面：允许先占用端口、listen 成功后才真正构造 Store。
 * 这是本文件最关键的安全约束 —— 未拿到端口前绝不写 memos.json。
 */
const lazyStore = createLazyStore(DATA_DIR)

// ---------------------------------------------------------------------------
// HTTP 数据访问层（桌面端是纯 HTTP 客户端，从不直接碰 Store 的读写方法）
// ---------------------------------------------------------------------------

/**
 * 发起一次本地 API 请求。
 * @param {string} pathname 例如 '/api/memos'
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function request(pathname, options = {}) {
  const { method = 'GET', body } = options
  const headers = { ...DESKTOP_HEADERS }
  if (body !== undefined) headers['content-type'] = 'application/json'

  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `请求失败 (HTTP ${res.status})`
    throw Object.assign(new Error(message), { status: res.status })
  }
  return data
}

/** 拉取设置与事项到本地缓存 */
async function refreshCache() {
  const [settings, memoDoc] = await Promise.all([request('/api/settings'), request('/api/memos')])
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    cachedSettings = { ...DEFAULT_SETTINGS, ...settings }
  }
  if (memoDoc && Array.isArray(memoDoc.memos)) {
    cachedMemos = memoDoc.memos
  }
  lastPollErrorAt = 0
  return cachedSettings
}

/**
 * 写入设置（本地缓存同步更新）。
 * @param {Record<string, unknown>} patch
 */
async function applySettings(patch) {
  try {
    const next = await request('/api/settings', { method: 'PATCH', body: patch })
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      cachedSettings = { ...DEFAULT_SETTINGS, ...next }
    }
  } catch (err) {
    console.warn('[desktop] 保存设置失败:', err.message)
  }
  return cachedSettings
}

/** 统计未完成条数 */
function countPending() {
  return cachedMemos.filter((m) => !m.deletedAt && m.status === 'open').length
}

// ---------------------------------------------------------------------------
// 服务启动 / 模式判定
// ---------------------------------------------------------------------------

/**
 * 端口是否已被别的进程占用。
 *
 * 只做 TCP connect 探测，**不 bind**：这样即使端口被占用，本进程也绝不会
 * 因为探测动作而创建 Store（构造即写盘）。
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortTaken(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    const done = (taken) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(taken)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

/**
 * 启动服务并判定运行模式。
 *
 * 顺序（唯一不变量：只有 listen 成功的进程才允许 attach，进而写盘）：
 *   1. connect 预检 —— **仅用于提前给出友好提示，不作为独占依据**
 *      （探测只能说明「探测那一刻被占着」，不能证明之后没人抢）
 *   2. createAppServer(门面) → listen()
 *   3. listen 成功 = 内核授予的独占证明；此时才在 bootstrap 里 attach + await ready
 *   4. EADDRINUSE = 别人持有端口 → **优雅降级为复用模式，绝不构造 Store**
 *
 * 「listen 后才加载数据」产生的空数据窗口由门面 503 闸门兜住，
 * 因此不存在「POST 201 后被 init 覆盖丢失」，也不需要拿探测去换独占证明。
 *
 * @returns {Promise<'exclusive'|'shared'>} shared 表示端口被占用（不创建 Store）
 */
async function startServer() {
  if (await isPortTaken(PORT, '127.0.0.1')) {
    // 此时 lazyStore 尚未 attach，本进程没有写过任何业务文件
    console.log('[desktop] 端口已被占用，进入复用模式（不创建 Store、不写数据）')
    return 'shared'
  }

  return new Promise((resolve, reject) => {
    const s = createAppServer({ store: lazyStore.facade, distDir: path.join(ROOT, 'dist') })
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // 真正的独占判定：内核拒绝 bind 说明别人持有端口。优雅降级为复用模式，
        // 本进程绝不 attach（构造 Store 即写盘），不会形成第二个可写 Store。
        console.log('[desktop] 端口已被占用，进入复用模式（不创建 Store、不写数据）')
        resolve('shared')
        return
      }
      reject(err)
    })
    s.listen(PORT, '127.0.0.1', () => {
      ownsServer = true
      server = s
      resolve('exclusive')
    })
  })
}

function pingDesktop() {
  fetch(`${BASE}/api/desktop/ping`, { method: 'POST', headers: DESKTOP_HEADERS }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

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
    backgroundColor: nativeTheme.themeSource === 'dark' ? '#15161a' : '#f6f6f3',
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

  const settings = cachedSettings
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
    backgroundColor: nativeTheme.themeSource === 'dark' ? '#15161a' : '#ffffff',
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
    applySettings({ focusBounds: focusWindow.getBounds() }).catch(() => {})
  }
  focusWindow.on('moved', saveBounds)
  focusWindow.on('resized', saveBounds)
  focusWindow.on('closed', () => {
    focusWindow = null
  })
  return focusWindow
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------

function buildTrayMenu() {
  const settings = cachedSettings
  const pending = countPending()
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    { label: `未完成 ${pending} 条`, enabled: false },
    { type: 'separator' }
  ]

  if (mode === 'shared') {
    template.push({
      label: `复用已有服务 ${BASE.replace(/^http:\/\//, '')}（提醒不可用）`,
      enabled: false
    })
    template.push({
      label: '如需桌面提醒：先关闭已运行的服务窗口，再启动桌面端',
      enabled: false
    })
    template.push({ type: 'separator' })
  }

  template.push(
    { label: '今日焦点', click: () => createFocusWindow() },
    { label: '打开主界面', click: () => createMainWindow() },
    { label: '新建待办', click: () => createMainWindow('?quick=1') },
    { type: 'separator' },
    {
      label: mode === 'shared' ? '启用提醒（复用模式下不生效）' : '启用提醒',
      type: 'checkbox',
      enabled: mode !== 'shared',
      checked: Boolean(settings.notifyEnabled),
      click: (item) => {
        applySettings({ notifyEnabled: item.checked }).then(() => {
          if (tray) tray.setContextMenu(buildTrayMenu())
        })
      }
    },
    {
      label: '变更原因必填',
      type: 'checkbox',
      checked: Boolean(settings.requireReason),
      click: (item) => {
        applySettings({ requireReason: item.checked }).then(() => {
          if (tray) tray.setContextMenu(buildTrayMenu())
        })
      }
    },
    { label: '打开数据目录', click: () => shell.openPath(DATA_DIR) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  )

  return Menu.buildFromTemplate(template)
}

function refreshTray() {
  if (!tray) return
  const pending = countPending()
  const offline = lastPollErrorAt && Date.now() - lastPollErrorAt < OFFLINE_HINT_MS
  const parts = [`备忘中心 · 未完成 ${pending} 条`]
  if (mode === 'shared') parts.push('复用已有服务（提醒不可用）')
  if (offline) parts.push('服务不可达')
  if (activeUncaughtCount() > 0) parts.push('内部异常')
  tray.setToolTip(parts.join(' · '))
  tray.setContextMenu(buildTrayMenu())
}

// ---------------------------------------------------------------------------
// 提醒调度（仅独占模式）
//
// 复用模式（端口被别的进程占着）下绝不创建 scheduler：
//   · 本进程没有 Store，写 reminderFiredAt 只能走别人的 API，语义上等于第二个调度器
//   · 一旦将来服务端自己也开始调度，就会出现双弹窗
// 因此复用模式直接放弃提醒，并在托盘/系统通知里明确告知用户，不做静默降级。
// ---------------------------------------------------------------------------

/** HTTP 适配器：让 server/scheduler.mjs 的扫描/去重/免打扰逻辑可以作用在 HTTP 数据源上 */
const reminderStore = {
  getSettings: () => cachedSettings,
  list: () => cachedMemos,
  update: (id, patch, meta) =>
    request(`/api/memos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...patch, reason: (meta && meta.reason) || '' }
    })
}

let polling = false

/**
 * 一轮：刷新缓存 → 交给 scheduler 判定 → 弹窗（scheduler 内部负责写回 reminderFiredAt）
 */
async function pollOnce(scheduler) {
  if (polling) return
  polling = true
  try {
    await refreshCache()
    await scheduler.tick()
    // 一轮完整成功 = 托盘数据已刷新，清零异常熔断计数
    markTrayRefreshSuccess()
  } catch (err) {
    lastPollErrorAt = Date.now()
    console.warn('[desktop] 提醒轮询失败:', err.message)
  } finally {
    polling = false
  }
}

function startReminderLoop() {
  const scheduler = createScheduler({
    store: reminderStore,
    onDue: async (memo) => {
      notify(memo)
    }
  })

  const tick = () => {
    pollOnce(scheduler).catch((err) => console.warn('[desktop] 轮询异常:', err.message))
  }

  const first = setTimeout(tick, 1200)
  if (typeof first.unref === 'function') first.unref()
  // 同样不 unref：这是常驻进程的心跳之一
  pollTimer = setInterval(tick, REMINDER_INTERVAL)
  console.log(`[desktop] 提醒轮询已启动，间隔 ${REMINDER_INTERVAL / 1000}s（模式: ${mode}）`)
  return scheduler
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/**
 * 让 Electron 原生层（系统对话框、窗口背景）跟随页面主题。
 * 页面主题存在 localStorage，Electron 外壳默认不知道，需由页面在切换时通知。
 * 顶部原生菜单栏已通过 setApplicationMenu(null) 移除，这里主要影响系统对话框与窗口底色。
 */
function applyNativeTheme(theme) {
  const source = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system'
  nativeTheme.themeSource = source
  const bg = theme === 'dark' ? '#15161a' : '#f6f6f3'
  for (const win of [mainWindow, focusWindow]) {
    if (win && !win.isDestroyed()) win.setBackgroundColor(bg)
  }
  return source
}

function setupIpc() {
  ipcMain.handle('focus:topmost', async (_event, value) => {
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.setAlwaysOnTop(Boolean(value), 'floating')
    }
    await applySettings({ focusTopmost: Boolean(value) })
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

  ipcMain.handle('app:set-theme', (_event, theme) => applyNativeTheme(theme))
}

// ---------------------------------------------------------------------------
// 启动流程
// ---------------------------------------------------------------------------

/** 复用模式下明确告知用户，避免静默降级 */
function noticeSharedMode() {
  const lines = [
    `检测到 ${BASE} 已有服务在运行，桌面端以「复用模式」启动。`,
    '',
    '· 本窗口不创建 Store、不写 memos.json，避免与已有服务互相覆写数据',
    '· 复用模式下**不提供桌面提醒**（提醒调度归持有数据的那个进程）',
    '· 需要提醒时：先关闭正在运行的服务窗口，再重新启动桌面端'
  ]
  console.log(`[desktop] ${lines.join('\n[desktop] ')}`)
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: '备忘中心 · 复用已有服务（提醒不可用）',
        body: '数据交由已有服务持有。需要桌面提醒请先关闭已运行的服务窗口，再启动桌面端。'
      }).show()
    }
  } catch (err) {
    console.warn('[desktop] 通知发送失败:', err.message)
  }
}

async function bootstrap() {
  // 移除窗口顶部的原生菜单栏（File / Edit / View / Window）。
  // 只影响应用主菜单，托盘右键菜单（buildTrayMenu）不受影响。
  // 网页内文本选择、复制粘贴等仍由 Chromium 自带处理，不依赖这条菜单。
  Menu.setApplicationMenu(null)

  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    const { dialog } = await import('electron')
    dialog.showErrorBox('前端未构建', '请先在项目目录执行 npm run build，再启动桌面端。')
    app.quit()
    return
  }

  // 1) 先 listen 占住端口，只有抢到的进程才允许构造 Store（顺序见 startServer 注释）
  mode = await startServer()

  if (mode === 'exclusive') {
    // listen 已成功 = 端口归本进程独占，此刻才允许 attach（构造即写盘）。
    // 加载期间门面统一 503，不会把空数组暴露给任何请求。
    const owned = lazyStore.attach()
    await owned.ready
    // 复用模式没有本地 Store，因此不在这里生成；本进程是端口独占者，生成只发生一次。
    // 注意：这里不调用 scheduler.start() —— 桌面端仍由 startReminderLoop() 外部轮询驱动，
    // 两者并存会造成双重调度与重复弹窗（见 server/scheduler.mjs 的权威注释）。
    await owned.ensureToday()
    console.log('[desktop] 独占模式：本进程持有数据与提醒调度')
  } else {
    noticeSharedMode()
  }

  // 2) 初始数据（失败不阻塞窗口，轮询会补上）
  try {
    await refreshCache()
  } catch (err) {
    lastPollErrorAt = Date.now()
    console.warn('[desktop] 初始数据加载失败:', err.message)
  }

  // 3) 托盘
  const icon = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('备忘中心')
  tray.setContextMenu(buildTrayMenu())
  refreshTray()

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

  // 4) 提醒：只有独占端口的那一个进程才允许跑调度器（杜绝双弹窗）
  if (mode === 'exclusive') {
    startReminderLoop()
  } else {
    console.log('[desktop] 复用模式：不启动提醒调度，避免与已有服务重复弹窗')
  }

  // 注意：以下两个 setInterval **不能** unref。
  // 后台启动时 stdio 指向文件而不是终端，Node 事件循环只剩这些定时器在撑着；
  // 若全部 unref，主进程会在启动几秒后静默退出（托盘/窗口随之消失）。
  setInterval(pingDesktop, PING_INTERVAL)
  pingDesktop()

  // 复用模式没有 20s 轮询，这里顺手把「未完成 N 条」刷新一次（只读 GET）
  setInterval(() => {
    syncTrayData().catch((err) => {
      lastPollErrorAt = Date.now()
      console.warn('[desktop] 托盘数据刷新失败:', err.message)
    })
  }, TRAY_REFRESH_INTERVAL)

  if (process.env.MEMO_OPEN_FOCUS === '1') createFocusWindow()
}

/**
 * 托盘周期的数据同步：复用模式拉一次只读 GET，独占模式**不主动刷缓存**。
 *
 * ⚠️ 独占模式下这里的 refreshTray() 只是把已有 cachedMemos 画到托盘，
 * 真正的缓存刷新依赖 startReminderLoop() 里 pollOnce() 的 20s 周期。
 * 将来若删掉/停用 reminder loop，独占模式的托盘计数会冻结在旧值 —— 那不是缓存坏了。
 *
 * 另外必须返回 Promise（调用 refreshCache()，不是 refreshCache 本身），
 * 否则调用方 .catch 会抛 TypeError 把主进程带崩。
 * @returns {Promise<void>}
 */
async function syncTrayData() {
  if (mode === 'shared') await refreshCache()
  refreshTray()
  // 托盘刷新成功：清零异常熔断计数（UI 层的 refreshTray 自身不算，见 markTrayRefreshSuccess 注释）
  markTrayRefreshSuccess()
}

// ---------------------------------------------------------------------------
// 兜底 + 熔断：定时器/异步回调抛错不允许带崩主进程，
// 但也不能变成「活着但全瘫」——同一异常累计 3 次就主动退出。
//
// 日志前缀固定为 `[desktop][UNCAUGHT]`，机器可 grep（回归脚本依赖这个串）。
// ---------------------------------------------------------------------------
const UNCAUGHT_PREFIX = '[desktop][UNCAUGHT]'
const UNCAUGHT_LIMIT = 3
const UNCAUGHT_WINDOW_MS = 10 * 60 * 1000

/** @type {Map<string, number[]>} 各签名的发生时间戳（只保留 10 分钟窗口内的） */
const uncaughtCounts = new Map()
/** 系统通知整个进程只弹一次，避免反复打扰 */
let uncaughtNotified = false

/** 生成用于聚合的异常签名 */
function uncaughtSignature(err) {
  if (!err) return 'unknown'
  const name = err.name || (err.constructor && err.constructor.name) || 'Error'
  const message = typeof err.message === 'string' ? err.message : String(err)
  return `${name}: ${message}`.slice(0, 180)
}

/** 清理窗口外的记录，返回窗口内异常总数 */
function activeUncaughtCount() {
  const cutoff = Date.now() - UNCAUGHT_WINDOW_MS
  let total = 0
  for (const [signature, times] of uncaughtCounts) {
    const fresh = times.filter((t) => t >= cutoff)
    if (fresh.length) uncaughtCounts.set(signature, fresh)
    else uncaughtCounts.delete(signature)
    total += fresh.length
  }
  return total
}

/**
 * 托盘数据刷新成功后清零熔断计数。
 *
 * 注意：**UI 层的 refreshTray() 不算**——异常兜底里也会写 tooltip，
 * 若把那次也算作「刷新成功」，计数会在每次异常时立刻归零，熔断永远不会触发。
 */
function markTrayRefreshSuccess() {
  uncaughtCounts.clear()
}

/**
 * 统一的异常兜底处理。
 * @param {'uncaughtException'|'unhandledRejection'} kind
 * @param {unknown} err
 */
function handleUncaught(kind, err) {
  const signature = uncaughtSignature(err)
  const now = Date.now()
  const cutoff = now - UNCAUGHT_WINDOW_MS
  const times = (uncaughtCounts.get(signature) || []).filter((t) => t >= cutoff)
  times.push(now)
  uncaughtCounts.set(signature, times)
  const count = times.length
  const total = activeUncaughtCount()

  const detail = err && err.stack ? err.stack : String(err)
  console.error(
    `${UNCAUGHT_PREFIX} (${kind}) 同名第 ${count} 次 / 窗口内累计 ${total} 次 | 签名: ${signature}\n${detail}`
  )

  // 直接写 tooltip，不走 refreshTray() —— 那条链路本身可能就是出错点。
  // 提示代码自己 try/catch 包死，防止二次抛错崩掉主进程。
  try {
    if (tray && !tray.isDestroyed()) tray.setToolTip('备忘中心 · 内部异常，功能可能异常')
  } catch (tooltipErr) {
    console.warn(`${UNCAUGHT_PREFIX} tooltip 更新失败:`, tooltipErr && tooltipErr.message)
  }

  if (!uncaughtNotified) {
    uncaughtNotified = true
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: '备忘中心 · 内部异常',
          body: '桌面端遇到内部异常，部分功能可能异常。详见 desktop.log。'
        }).show()
      }
    } catch (notifyErr) {
      console.warn(`${UNCAUGHT_PREFIX} 通知发送失败:`, notifyErr && notifyErr.message)
    }
  }

  if (count >= UNCAUGHT_LIMIT) {
    console.error(
      `${UNCAUGHT_PREFIX} circuit-breaker 同名异常在 ${UNCAUGHT_WINDOW_MS / 60000} 分钟内累计 ${count} 次，主动退出以免「活着但全瘫」: ${signature}`
    )
    quitting = true
    try {
      app.quit()
    } catch {
      process.exit(1)
    }
  }
}

process.on('uncaughtException', (err) => handleUncaught('uncaughtException', err))
process.on('unhandledRejection', (reason) => handleUncaught('unhandledRejection', reason))

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

  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[desktop] 启动失败:', err)
    app.quit()
  })

  app.on('activate', () => {
    if (!mainWindow) createMainWindow()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，不随窗口关闭退出
  })

  app.on('before-quit', () => {
    quitting = true
    if (pollTimer) clearInterval(pollTimer)
    if (server && ownsServer) server.close()
  })
}
