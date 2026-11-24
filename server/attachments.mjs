import { mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const ALLOWED = new Map([
  ['image/webp', '.webp'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg']
])

const MAX_BYTES = 6 * 1024 * 1024

function sniffMime(buffer) {
  if (!buffer || buffer.length < 12) return 'application/octet-stream'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

export class AttachmentStore {
  constructor(dir) {
    this.dir = dir
  }

  safeId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9-]{6,64}$/.test(value) ? value : null
  }

  filePath(memoId, attId) {
    const memo = this.safeId(memoId)
    const id = this.safeId(attId)
    if (!memo || !id) return null
    return path.join(this.dir, memo, `${id}.webp`)
  }

  async save(memoId, base64, meta = {}) {
    const memo = this.safeId(memoId)
    if (!memo) throw Object.assign(new Error('事项编号不合法'), { status: 400 })
    const mime = String(meta.mime || 'image/webp').toLowerCase()
    if (!ALLOWED.has(mime)) throw Object.assign(new Error('仅支持 PNG / JPEG / WebP 图片'), { status: 400 })
    const cleaned = String(base64 || '').replace(/^data:[^;]+;base64,/, '')
    if (!cleaned) throw Object.assign(new Error('图片内容为空'), { status: 400 })
    const buffer = Buffer.from(cleaned, 'base64')
    if (!buffer.length) throw Object.assign(new Error('图片解码失败'), { status: 400 })
    if (buffer.length > MAX_BYTES) throw Object.assign(new Error('单张截图不能超过 6MB'), { status: 413 })

    const id = randomUUID().replace(/-/g, '').slice(0, 20)
    const dir = path.join(this.dir, memo)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${id}.webp`), buffer)
    return {
      id,
      name: String(meta.name || '截图').slice(0, 120),
      mime: 'image/webp',
      size: buffer.length,
      width: Math.max(0, Math.floor(Number(meta.width) || 0)),
      height: Math.max(0, Math.floor(Number(meta.height) || 0))
    }
  }

  async read(memoId, attId) {
    const target = this.filePath(memoId, attId)
    if (!target) throw Object.assign(new Error('截图不存在'), { status: 404 })
    try {
      const buffer = await readFile(target)
      return { buffer, mime: sniffMime(buffer) }
    } catch {
      throw Object.assign(new Error('截图文件已丢失'), { status: 404 })
    }
  }

  async remove(memoId, attId) {
    const target = this.filePath(memoId, attId)
    if (!target) return
    await unlink(target).catch(() => {})
  }

  async removeAll(memoId) {
    const memo = this.safeId(memoId)
    if (!memo) return
    await rm(path.join(this.dir, memo), { recursive: true, force: true }).catch(() => {})
  }
}
