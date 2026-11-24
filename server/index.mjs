import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './store.mjs'
import { createAppServer } from './app.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 5178)
const HOST = process.env.HOST || '127.0.0.1'

const store = new Store(path.join(ROOT, 'data'))
await store.ready

const server = createAppServer({ store, distDir: path.join(ROOT, 'dist') })

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[server] 端口 ${PORT} 已被占用，已有一个实例在运行。`)
    console.error('         可先关闭那个正在运行的窗口，或设置 PORT 环境变量换一个端口，例如: set PORT=5200\n')
    process.exit(1)
  }
  console.error('[server] 启动失败:', err.message)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`\n  备忘中心已启动: http://${HOST}:${PORT}`)
  console.log(`  数据文件: ${path.join(ROOT, 'data', 'memos.json')}`)
  console.log(`  备份目录: ${path.join(ROOT, 'data', 'backups')}`)
  console.log('  提示: 网页模式不提供系统弹窗，桌面提醒请运行 npm run desktop\n')
})

process.on('SIGINT', () => {
  console.log('\n正在停止服务...')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500)
})
