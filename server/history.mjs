import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_MEMO_ENTRIES = 300
const MAX_GLOBAL_ENTRIES = 200

export const TRACKED_FIELDS = [
  'title',
  'type',
  'priority',
  'status',
  'tags',
  'dueAt',
  'reminderAt',
  'note',
  'pinned',
  'isDoing'
]

const same = (field, a, b) => {
  if (field === 'tags') return JSON.stringify(a || []) === JSON.stringify(b || [])
  return (a ?? null) === (b ?? null)
}

export function diffMemos(prev, next) {
  const changes = []
  for (const field of TRACKED_FIELDS) {
    if (same(field, prev[field], next[field])) continue
    const pick = (v) => {
      if (field === 'tags') return (v || []).join('、')
      if (v === null || v === undefined) return ''
      return v
    }
    changes.push({ field, from: pick(prev[field]), to: pick(next[field]) })
  }
  return changes
}

export class HistoryLog {
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'history.jsonl')
    this.cache = null
    this.loading = null
    this.queue = Promise.resolve()
    this.ready = mkdir(dir, { recursive: true }).catch(() => {})
  }

  async entries() {
    if (this.cache) return this.cache
    if (!this.loading) {
      this.loading = (async () => {
        await this.ready
        const text = await readFile(this.file, 'utf8').catch(() => '')
        const list = []
        for (const line of text.split('\n')) {
          const raw = line.trim()
          if (!raw) continue
          try {
            const item = JSON.parse(raw)
            if (item && item.memoId) list.push(item)
          } catch {
            /* 跳过损坏行，不影响后续读取 */
          }
        }
        this.cache = list
        return list
      })()
    }
    return this.loading
  }

  append(entry) {
    const record = {
      id: randomUUID().slice(0, 12),
      at: new Date().toISOString(),
      actor: 'web',
      action: 'update',
      reason: '',
      changes: [],
      ...entry
    }
    if (this.cache && !this.cache.includes(record)) this.cache.push(record)
    this.queue = this.queue
      .then(async () => {
        await this.ready
        const list = await this.entries()
        if (!list.includes(record)) list.push(record)
        await appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8')
      })
      .catch((err) => console.error('[history] 写入失败:', err.message))
    return record
  }

  async forMemo(memoId, limit = MAX_MEMO_ENTRIES) {
    await this.queue
    const list = await this.entries()
    return list.filter((e) => e.memoId === memoId).slice(-limit)
  }

  async recent(limit = MAX_GLOBAL_ENTRIES) {
    await this.queue
    const list = await this.entries()
    return list.slice(-limit).reverse()
  }

  async count() {
    await this.queue
    return (await this.entries()).length
  }
}
