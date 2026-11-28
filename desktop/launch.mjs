import { spawn } from 'node:child_process'
import { existsSync, openSync, closeSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LOG_LIMIT = 2 * 1024 * 1024

const require = createRequire(import.meta.url)
/**
 * 解析 Electron 可执行文件路径。
 *
 * 这里刻意不用 `import electronPath from 'electron'`：在 ELECTRON_RUN_AS_NODE
 * 模式下运行本文件时（静默启动器找不到系统 Node，改用项目自带的 Electron 兜底），
 * 该包的 ESM 默认导出是空对象，只有 CJS require 才能拿到真实路径。
 * 两种运行方式下 require 的返回值都一致，故统一走 createRequire。
 */
const electronPath = require('electron')

const foreground = process.argv.includes('--foreground')
const extraArgs = process.argv.slice(2).filter((arg) => arg !== '--foreground')

if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('\n[desktop] 前端未构建，请先执行: npm run build\n')
  process.exit(1)
}

if (!existsSync(electronPath)) {
  console.error('\n[desktop] 未找到 Electron 运行时，请重新执行: npm install\n')
  console.error(`         期望路径: ${electronPath}\n`)
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

if (foreground) {
  const child = spawn(electronPath, [ROOT, ...extraArgs], { stdio: 'inherit', env })
  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (err) => {
    console.error('[desktop] 启动失败:', err.message)
    process.exit(1)
  })
} else {
  const dataDir = path.join(ROOT, 'data')
  mkdirSync(dataDir, { recursive: true })
  const logPath = path.join(dataDir, 'desktop.log')
  try {
    if (existsSync(logPath) && statSync(logPath).size > LOG_LIMIT) writeFileSync(logPath, '')
  } catch {
    /* 日志轮转失败可忽略 */
  }

  const logFd = openSync(logPath, 'a')
  let failure = null

  const child = spawn(electronPath, [ROOT, ...extraArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env
  })

  child.on('error', (err) => {
    failure = err
  })
  child.unref()

  setTimeout(() => {
    try {
      closeSync(logFd)
    } catch {
      /* 已关闭 */
    }
    if (failure) {
      console.error('[desktop] 启动失败:', failure.message)
      console.error(`[desktop] 日志: ${logPath}`)
      process.exit(1)
    }
    console.log(`[desktop] 已在后台启动，日志: ${logPath}`)
    process.exit(0)
  }, 900)
}
