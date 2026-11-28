/**
 * 生成 Windows 快捷方式（.lnk）—— 指向静默启动器「启动备忘中心.vbs」
 *
 * 为什么借助 Electron：
 *   常规做法是 WScript.Shell.CreateShortcut（COM）或脚本宿主，在受限自动化环境里会被
 *   安全策略拒绝。Electron 内置 Chromium 的 ShellLink 写出实现（shell.writeShortcutLink），
 *   能生成带完整 LinkTargetIDList 的标准快捷方式，且项目本身就依赖 electron，无需新增依赖。
 *
 * 运行：node desktop/make-shortcut.mjs
 * 产物：
 *   %USERPROFILE%\Desktop\备忘中心.lnk
 *   %APPDATA%\Microsoft\Windows\Start Menu\Programs\备忘中心.lnk
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VBS_NAME = '启动备忘中心.vbs'
const LNK_NAME = '备忘中心.lnk'
const DESCRIPTION = '工作备忘记录系统'

const VBS_PATH = path.join(ROOT, VBS_NAME)
const ICO_PATH = path.join(ROOT, 'desktop', 'assets', 'app.ico')
const TARGET_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')
/**
 * 必须与 desktop/main.mjs 里的 APP_ID 完全一致。
 * 写进快捷方式后，Windows 通知（Toast）才能通过该 ID 找到开始菜单快捷方式；
 * 同时任务栏按钮也会按此 ID 归组，固定到任务栏时图标取自下面的 icon。
 */
const APP_ID = 'com.memo.center.desktop'

const LNK_PATHS = [
  path.join(os.homedir(), 'Desktop', LNK_NAME),
  path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    LNK_NAME
  )
]

/**
 * 校验 .lnk 结构（ShellLinkHeader + IDList + LinkInfo + StringData）。
 *
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function parseShortcut(file) {
  const buf = readFileSync(file)
  const headerSize = buf.readUInt32LE(0x00)
  const flags = buf.readUInt32LE(0x14)
  const result = {
    bytes: buf.length,
    headerSize,
    hasIdList: Boolean(flags & 0x01),
    hasLinkInfo: Boolean(flags & 0x02),
    iconIndex: buf.readInt32LE(0x38),
    showCommand: buf.readUInt32LE(0x3c),
    idListItems: 0
  }

  let offset = headerSize
  if (flags & 0x01) {
    const idListSize = buf.readUInt16LE(offset)
    let p = offset + 2
    const end = p + idListSize
    while (p + 2 <= end) {
      const size = buf.readUInt16LE(p)
      if (size === 0) break
      result.idListItems++
      p += size
    }
    offset += 2 + idListSize
  }

  if (flags & 0x02) {
    const linkInfoSize = buf.readUInt32LE(offset)
    const localBasePathOffset = buf.readUInt32LE(offset + 16)
    let end = offset + localBasePathOffset
    const limit = offset + linkInfoSize
    while (end < limit && buf[end] !== 0) end++
    result.targetPath = buf.toString('latin1', offset + localBasePathOffset, end)
    offset += linkInfoSize
  }

  const readString = () => {
    const count = buf.readUInt16LE(offset)
    offset += 2
    if (flags & 0x80) {
      const value = buf.toString('utf16le', offset, offset + count * 2)
      offset += count * 2
      return value
    }
    const value = buf.toString('latin1', offset, offset + count)
    offset += count
    return value
  }

  if (flags & 0x04) result.description = readString()
  if (flags & 0x08) result.relativePath = readString()
  if (flags & 0x10) result.workingDir = readString()
  if (flags & 0x20) result.arguments = readString()
  if (flags & 0x40) result.iconLocation = readString()
  return result
}

/**
 * 检查快捷方式里是否写入了指定的 AppUserModelID。
 * AUMID 以 UTF-16 LE 字符串存放在 ExtraData 的 PropertyStore 块中，
 * 这里直接按字节序列匹配，避免依赖 PropertyStore 的二进制解析细节。
 *
 * @param {string} file
 * @param {string} id
 * @returns {boolean}
 */
function hasAppUserModelId(file, id) {
  const buf = readFileSync(file)
  return buf.includes(Buffer.from(id, 'utf16le'))
}

/**
 * 以时间戳备份已存在的快捷方式，避免覆盖用户手工调整过的文件。
 *
 * @param {string} file
 * @returns {string} 备份路径，未备份时返回空串
 */
function backupIfExists(file) {
  if (!existsSync(file)) return ''
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const backup = `${file}.bak-${stamp}`
  copyFileSync(file, backup)
  return backup
}

// ----------------------------- 主流程 -----------------------------
for (const [label, file] of [
  ['启动器', VBS_PATH],
  ['图标', ICO_PATH],
  ['wscript.exe', TARGET_EXE]
]) {
  if (!existsSync(file)) {
    console.error(`[shortcut] 缺少${label}: ${file}`)
    process.exit(1)
  }
}
if (!existsSync(electronPath)) {
  console.error(`[shortcut] 未找到 Electron 运行时: ${electronPath}（先执行 npm install）`)
  process.exit(1)
}

// 把 Electron 产物目录当作备用目录，确保其在进程退出后清理
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'memo-shortcut-'))
const entryFile = path.join(tmpDir, 'write-shortcut.cjs')
const payload = {
  target: TARGET_EXE,
  args: `"${VBS_PATH}"`,
  cwd: ROOT,
  icon: ICO_PATH,
  iconIndex: 0,
  description: DESCRIPTION,
  appUserModelId: APP_ID
}
writeFileSync(
  entryFile,
  [
    "const { app, shell } = require('electron')",
    'const fs = require("fs")',
    `const payload = ${JSON.stringify(payload)}`,
    `const links = ${JSON.stringify(LNK_PATHS)}`,
    'app.whenReady().then(() => {',
    '  let ok = true',
    '  for (const lnk of links) {',
    '    const created = shell.writeShortcutLink(lnk, "create", payload)',
    '    console.log("write:", created, "->", lnk)',
    '    if (!created) ok = false',
    '  }',
    '  app.exit(ok ? 0 : 1)',
    '})',
    ''
  ].join('\n'),
  'utf8'
)

const env = { ...process.env }
// 宿主要是 Electron 应用，这里必须清掉，否则 electron.exe 会退化成纯 node 进程
delete env.ELECTRON_RUN_AS_NODE

const backups = []
for (const lnk of LNK_PATHS) {
  const backup = backupIfExists(lnk)
  if (backup) backups.push(backup)
  rmSync(lnk, { force: true })
}

const run = spawnSync(electronPath, [entryFile], { env, stdio: 'inherit', timeout: 120000 })
rmSync(tmpDir, { recursive: true, force: true })

if (run.status !== 0) {
  console.error(`[shortcut] 生成失败，electron 退出码: ${run.status ?? 'null'}`, run.error ?? '')
  process.exit(1)
}

for (const backup of backups) console.log(`[shortcut] 已备份原快捷方式: ${backup}`)

let failed = false
for (const lnk of LNK_PATHS) {
  if (!existsSync(lnk)) {
    console.error(`[shortcut] 未生成: ${lnk}`)
    failed = true
    continue
  }
  const info = parseShortcut(lnk)
  console.log(`\n[${lnk}]`)
  console.log(`  bytes        : ${statSync(lnk).size}`)
  console.log(`  idListItems  : ${info.idListItems}`)
  console.log(`  targetPath   : ${info.targetPath}`)
  console.log(`  arguments    : ${info.arguments}`)
  console.log(`  workingDir   : ${info.workingDir}`)
  console.log(`  iconLocation : ${info.iconLocation}`)
  console.log(`  description  : ${info.description}`)

  const checks = [
    ['IDList 存在', info.hasIdList === true && info.idListItems > 0],
    ['target 指向 wscript.exe', /wscript\.exe$/i.test(String(info.targetPath))],
    ['参数指向启动器', String(info.arguments).includes(VBS_NAME)],
    ['工作目录正确', path.resolve(String(info.workingDir)) === ROOT],
    ['图标正确', path.resolve(String(info.iconLocation)) === ICO_PATH],
    ['AppUserModelID 已写入', hasAppUserModelId(lnk, APP_ID)]
  ]
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`)
    if (!ok) failed = true
  }
}

if (failed) {
  console.error('\n[shortcut] 校验未通过')
  process.exit(1)
}
console.log('\n[shortcut] done')
