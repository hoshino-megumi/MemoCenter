import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app.mjs'
import { createLazyStore } from './lazy-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 5178)
const HOST = process.env.HOST || '127.0.0.1'
const DATA_DIR = path.join(ROOT, 'data')

/**
 * 启动顺序（唯一不变量：只有 listen 成功的进程才允许 attach，进而写盘）：
 *
 *   1. createAppServer(门面) —— 构造期只读 `dir`，绝不构造 Store
 *   2. listen() —— **内核授予的独占证明，不可伪造**
 *   3. listen 成功回调里 attach() + await ready
 *
 * `new Store(dir)` 构造即 `persist()`，所以「抢到端口之前构造 Store」会用自己的
 * 旧快照覆写另一个进程刚写入的数据（历史事故）。反过来，「listen 后才加载数据」
 * 产生的空数据窗口由门面的 503 闸门兜住（`!instance || !ready`），
 * 因此不存在「请求看到 count:0」或「POST 201 后被 init 覆盖」的问题。
 */
const lazyStore = createLazyStore(DATA_DIR)

/**
 * 端口占用预检，**仅用于友好提示，不作为独占依据**。
 *
 * TCP connect 只能说明「探测那一刻端口被占着」，反过来「探测时空闲」也不能
 * 保证之后没人抢（TOCTOU）。真正的独占性一律由 listen 的 EADDRINUSE 判定。
 * 绝不把这个探测结果当作 attach 的前提 —— 那会把不可伪造的内核证明降级成可伪造的探测。
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

/** 0.0.0.0 / :: 这类通配地址要换成本机回环去探测 */
function probeHost(host) {
  if (host === '0.0.0.0' || host === '::' || host === '') return '127.0.0.1'
  return host
}

/** @type {import('node:http').Server|null} */
let server = null

function onDataError(err) {
  console.error('[server] 数据初始化失败:', err.message)
  server?.close(() => process.exit(1))
  setTimeout(() => process.exit(1), 1500)
}

async function main() {
  // 只做提示：即便这里误判为空闲，后面的 listen 仍会用 EADDRINUSE 兜底，且此时尚未 attach。
  if (await isPortTaken(PORT, probeHost(HOST))) {
    console.error(`\n[server] 端口 ${PORT} 已被占用，已有一个实例在运行。`)
    console.error('         本次启动未触碰任何数据文件，可直接关闭此窗口。')
    console.error('         可先关闭那个正在运行的窗口，或设置 PORT 环境变量换一个端口，例如: set PORT=5200\n')
    process.exit(1)
    return
  }

  server = createAppServer({ store: lazyStore.facade, distDir: path.join(ROOT, 'dist') })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[server] 端口 ${PORT} 已被占用，本次启动未构造 Store、未触碰任何数据文件。\n`)
      process.exit(1)
      return
    }
    console.error('[server] 启动失败:', err.message)
    process.exit(1)
  })

  server.listen(PORT, HOST, async () => {
    try {
      // 只有 listen 成功（端口归本进程独占）才允许构造 Store。
      const store = lazyStore.attach()
      await store.ready
      // 端口独占 + 数据加载完成后才生成今日实例，避免空快照窗口里写盘。
      await store.ensureToday()
      console.log(`\n  备忘中心已启动: http://${HOST}:${PORT}`)
      console.log(`  数据文件: ${store.file}`)
      console.log(`  备份目录: ${store.backupDir}`)
      console.log('  提示: 网页模式不提供系统弹窗，桌面提醒请运行 npm run desktop\n')
    } catch (err) {
      onDataError(err)
    }
  })
}

main().catch((err) => {
  console.error('[server] 启动失败:', err && err.message ? err.message : err)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\n正在停止服务...')
  if (!server) process.exit(0)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
})
