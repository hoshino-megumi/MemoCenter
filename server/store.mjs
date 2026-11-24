import { mkdir, readFile, writeFile, rename, copyFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HistoryLog, diffMemos } from './history.mjs'

export const TYPES = ['需求', '缺陷', '会议', '跟进', '日常']
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const STATUSES = ['open', 'done', 'archived']
export const NOTE_COLORS = ['amber', 'blue', 'green', 'pink', 'gray']
const BACKUP_KEEP_DAYS = 30

const STATUS_ALIAS = {
  todo: 'open',
  doing: 'open',
  open: 'open',
  done: 'done',
  archived: 'archived'
}

export const STATUS_LABELS = { open: '未完成', done: '已完成', archived: '归档' }

export const DEFAULT_SETTINGS = {
  notifyEnabled: true,
  quietStart: '22:00',
  quietEnd: '08:00',
  snoozeMinutes: 10,
  focusTopmost: true,
  focusBounds: null,
  digestEnabled: false,
  digestAt: '09:00',
  requireReason: false
}

const nowIso = () => new Date().toISOString()

function str(value, max) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function isoOrNull(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function tagsOf(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const tag = str(raw, 24).replace(/^#/, '')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 8) break
  }
  return out
}

function attachmentsOf(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const id = str(raw.id, 64)
    if (!id) continue
    out.push({
      id,
      name: str(raw.name, 120) || '截图',
      mime: str(raw.mime, 40) || 'image/webp',
      size: Math.max(0, Math.floor(Number(raw.size) || 0)),
      width: Math.max(0, Math.floor(Number(raw.width) || 0)),
      height: Math.max(0, Math.floor(Number(raw.height) || 0)),
      note: str(raw.note, 120),
      at: isoOrNull(raw.at) || nowIso()
    })
    if (out.length >= 20) break
  }
  return out
}

export function sanitize(input, base) {
  const src = input && typeof input === 'object' ? input : {}
  const fallback = base || {}
  const rawStatus = String(src.status || fallback.status || 'open')
  const status = STATUS_ALIAS[rawStatus] || 'open'
  const wasDoing = rawStatus === 'doing' || fallback.isDoing === true
  const priority = PRIORITIES.includes(src.priority) ? src.priority : fallback.priority || 'P2'
  const type = TYPES.includes(src.type) ? src.type : fallback.type || '日常'
  const createdAt = isoOrNull(src.createdAt) || fallback.createdAt || nowIso()

  const completedRaw =
    src.completedAt === null ? null : fallback.completedAt || isoOrNull(src.completedAt) || null
  const archivedRaw =
    src.archivedAt === null ? null : fallback.archivedAt || isoOrNull(src.archivedAt) || null

  return {
    id: fallback.id || str(src.id, 64) || randomUUID(),
    title: str(src.title ?? fallback.title, 200),
    type,
    priority,
    status,
    isDoing: status === 'open' ? Boolean(src.isDoing ?? wasDoing ?? fallback.isDoing ?? false) : false,
    tags: tagsOf(src.tags ?? fallback.tags),
    dueAt: isoOrNull(src.dueAt ?? fallback.dueAt),
    reminderAt: isoOrNull(src.reminderAt ?? fallback.reminderAt),
    reminderFiredAt:
      src.reminderFiredAt === null ? null : fallback.reminderFiredAt || isoOrNull(src.reminderFiredAt) || null,
    snoozeUntil: src.snoozeUntil === null ? null : fallback.snoozeUntil || isoOrNull(src.snoozeUntil) || null,
    note: str(src.note ?? fallback.note, 4000),
    attachments: attachmentsOf(src.attachments ?? fallback.attachments),
    pinned: Boolean(src.pinned ?? fallback.pinned ?? false),
    createdAt,
    updatedAt: isoOrNull(src.updatedAt) || nowIso(),
    completedAt: status === 'done' ? completedRaw || nowIso() : status === 'archived' ? completedRaw : null,
    archivedAt: status === 'archived' ? archivedRaw || nowIso() : null,
    deletedAt: src.deletedAt === null ? null : fallback.deletedAt || isoOrNull(src.deletedAt) || null
  }
}

function sanitizeNote(input, base) {
  const src = input && typeof input === 'object' ? input : {}
  const fallback = base || {}
  const order = Number(src.order ?? fallback.order)
  return {
    id: fallback.id || str(src.id, 64) || randomUUID(),
    content: str(src.content ?? fallback.content, 2000),
    color: NOTE_COLORS.includes(src.color) ? src.color : fallback.color || 'amber',
    pinned: Boolean(src.pinned ?? fallback.pinned ?? false),
    order: Number.isFinite(order) ? order : Date.now(),
    createdAt: isoOrNull(src.createdAt) || fallback.createdAt || nowIso(),
    updatedAt: nowIso()
  }
}

function sanitizeSettings(input, base) {
  const src = input && typeof input === 'object' ? input : {}
  const out = { ...DEFAULT_SETTINGS, ...(base || {}) }
  if (typeof src.notifyEnabled === 'boolean') out.notifyEnabled = src.notifyEnabled
  if (typeof src.requireReason === 'boolean') out.requireReason = src.requireReason
  if (/^\d{2}:\d{2}$/.test(src.quietStart || '')) out.quietStart = src.quietStart
  if (/^\d{2}:\d{2}$/.test(src.quietEnd || '')) out.quietEnd = src.quietEnd
  if (/^\d{2}:\d{2}$/.test(src.digestAt || '')) out.digestAt = src.digestAt
  if (Number.isFinite(Number(src.snoozeMinutes))) {
    out.snoozeMinutes = Math.min(120, Math.max(1, Math.floor(Number(src.snoozeMinutes))))
  }
  if (typeof src.focusTopmost === 'boolean') out.focusTopmost = src.focusTopmost
  if (typeof src.digestEnabled === 'boolean') out.digestEnabled = src.digestEnabled
  if (src.focusBounds && typeof src.focusBounds === 'object') {
    const { x, y, width, height } = src.focusBounds
    if ([x, y, width, height].every((n) => Number.isFinite(Number(n)))) {
      out.focusBounds = {
        x: Math.round(Number(x)),
        y: Math.round(Number(y)),
        width: Math.round(Number(width)),
        height: Math.round(Number(height))
      }
    }
  }
  if (src.focusBounds === null) out.focusBounds = null
  return out
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await copyFile(file, `${file}.corrupt-${stamp}`).catch(() => {})
      console.warn(`[store] 文件损坏，已备份副本: ${path.basename(file)}`)
    }
    return fallback
  }
}

async function atomicWrite(file, payload) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, file)
}

export class Store {
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'memos.json')
    this.notesFile = path.join(dir, 'notes.json')
    this.settingsFile = path.join(dir, 'settings.json')
    this.backupDir = path.join(dir, 'backups')
    this.memos = []
    this.notes = []
    this.settings = { ...DEFAULT_SETTINGS }
    this.queue = Promise.resolve()
    this.history = new HistoryLog(dir)
    this.ready = this.init()
  }

  async init() {
    await mkdir(this.dir, { recursive: true })
    await mkdir(this.backupDir, { recursive: true })

    const memoDoc = await readJson(this.file, { memos: [] })
    const memoList = Array.isArray(memoDoc) ? memoDoc : memoDoc.memos
    this.memos = Array.isArray(memoList) ? memoList.map((m) => sanitize(m, m)) : []

    const noteDoc = await readJson(this.notesFile, { notes: [] })
    const noteList = Array.isArray(noteDoc) ? noteDoc : noteDoc.notes
    this.notes = Array.isArray(noteList) ? noteList.map((n) => sanitizeNote(n, n)) : []

    const settingsDoc = await readJson(this.settingsFile, { settings: DEFAULT_SETTINGS })
    this.settings = sanitizeSettings(settingsDoc.settings || settingsDoc || {}, DEFAULT_SETTINGS)

    await this.persist()
    await this.persistNotes()
    await this.persistSettings()
  }

  persist() {
    this.queue = this.queue
      .then(async () => {
        await atomicWrite(this.file, { version: 3, updatedAt: nowIso(), memos: this.memos })
        await this.dailyBackup('memos', this.file)
      })
      .catch((err) => console.error('[store] 写入失败:', err.message))
    return this.queue
  }

  persistNotes() {
    this.queue = this.queue
      .then(async () => {
        await atomicWrite(this.notesFile, { version: 1, updatedAt: nowIso(), notes: this.listNotes() })
        await this.dailyBackup('notes', this.notesFile)
      })
      .catch((err) => console.error('[store] 便签写入失败:', err.message))
    return this.queue
  }

  persistSettings() {
    this.queue = this.queue
      .then(async () => {
        await atomicWrite(this.settingsFile, { version: 1, settings: this.settings })
      })
      .catch((err) => console.error('[store] 设置写入失败:', err.message))
    return this.queue
  }

  async dailyBackup(prefix, source) {
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(this.backupDir, `${prefix}-${day}.json`)
    try {
      await copyFile(source, target, 1)
    } catch (err) {
      if (err.code && err.code !== 'EEXIST') console.warn('[store] 快照失败:', err.message)
      return
    }
    const files = await readdir(this.backupDir).catch(() => [])
    const limit = Date.now() - BACKUP_KEEP_DAYS * 86400000
    for (const name of files) {
      const match = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.json$`).exec(name)
      if (!match) continue
      if (new Date(`${match[1]}T00:00:00Z`).getTime() < limit) {
        await unlink(path.join(this.backupDir, name)).catch(() => {})
      }
    }
  }

  list() {
    return this.memos
  }

  get(id) {
    return this.memos.find((m) => m.id === id) || null
  }

  log(memoId, action, actor, reason, changes) {
    this.history.append({ memoId, action, actor, reason: str(reason || '', 200), changes: changes || [] })
  }

  async create(payload, meta = {}) {
    const memo = sanitize(payload, {})
    if (!memo.title) throw Object.assign(new Error('标题不能为空'), { status: 400 })
    this.memos.unshift(memo)
    await this.persist()
    this.log(memo.id, 'create', meta.actor || 'web', meta.reason, [])
    return memo
  }

  async update(id, patch, meta = {}) {
    const index = this.memos.findIndex((m) => m.id === id)
    if (index === -1) throw Object.assign(new Error('事项不存在'), { status: 404 })
    const current = this.memos[index]
    const clean = { ...(patch || {}) }
    const reason = clean.reason ?? meta.reason ?? ''
    delete clean.reason

    const merged = { ...current, ...clean, updatedAt: nowIso() }
    if (Object.prototype.hasOwnProperty.call(clean, 'deletedAt') && clean.deletedAt === null) {
      merged.deletedAt = null
    }
    if (Object.prototype.hasOwnProperty.call(clean, 'reminderAt')) {
      const nextReminder = clean.reminderAt ? new Date(clean.reminderAt).getTime() : null
      const curReminder = current.reminderAt ? new Date(current.reminderAt).getTime() : null
      if (nextReminder !== curReminder) {
        merged.reminderFiredAt = null
        merged.snoozeUntil = null
      }
    }
    if (Object.prototype.hasOwnProperty.call(clean, 'status') && clean.status !== current.status) {
      merged.isDoing = clean.status === 'open' ? Boolean(clean.isDoing) : false
    }
    const next = sanitize(merged, current)
    if (!next.title) throw Object.assign(new Error('标题不能为空'), { status: 400 })
    this.memos[index] = next
    await this.persist()

    const changes = diffMemos(current, next)
    if (changes.length) {
      const statusChange = changes.find((c) => c.field === 'status')
      let action = 'update'
      if (statusChange && changes.length === 1) {
        if (statusChange.to === 'archived') action = 'archive'
        else if (statusChange.from === 'archived') action = 'unarchive'
      }
      this.log(id, action, meta.actor || 'web', reason, changes)
    }
    return next
  }

  async remove(id, hard, meta = {}) {
    const index = this.memos.findIndex((m) => m.id === id)
    if (index === -1) throw Object.assign(new Error('事项不存在'), { status: 404 })
    if (hard) {
      this.memos.splice(index, 1)
    } else {
      this.memos[index] = { ...this.memos[index], deletedAt: nowIso(), updatedAt: nowIso() }
    }
    await this.persist()
    this.log(id, hard ? 'purge' : 'delete', meta.actor || 'web', meta.reason, [])
    return { ok: true }
  }

  async restore(id, meta = {}) {
    const memo = await this.update(id, { deletedAt: null }, meta)
    this.log(id, 'restore', meta.actor || 'web', meta.reason, [])
    return memo
  }

  async archive(id, archived, meta = {}) {
    return this.update(id, { status: archived ? 'archived' : 'open' }, meta)
  }

  async emptyTrash(meta = {}) {
    const removed = this.memos.filter((m) => m.deletedAt)
    this.memos = this.memos.filter((m) => !m.deletedAt)
    await this.persist()
    for (const memo of removed) this.log(memo.id, 'purge', meta.actor || 'web', meta.reason, [])
    return { ok: true, count: removed.length }
  }

  async addAttachment(id, meta) {
    const index = this.memos.findIndex((m) => m.id === id)
    if (index === -1) throw Object.assign(new Error('事项不存在'), { status: 404 })
    const current = this.memos[index]
    const att = {
      id: meta.id,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      width: meta.width,
      height: meta.height,
      note: meta.note || '',
      at: nowIso()
    }
    const next = { ...current, attachments: [...(current.attachments || []), att], updatedAt: nowIso() }
    if (next.attachments.length > 20) throw Object.assign(new Error('单条事项最多 20 张截图'), { status: 400 })
    this.memos[index] = next
    await this.persist()
    this.log(id, 'attach', meta.actor || 'web', meta.reason, [{ field: 'attachments', from: '', to: att.name }])
    return att
  }

  async removeAttachment(id, attachmentId, meta = {}) {
    const index = this.memos.findIndex((m) => m.id === id)
    if (index === -1) throw Object.assign(new Error('事项不存在'), { status: 404 })
    const current = this.memos[index]
    const list = current.attachments || []
    const target = list.find((a) => a.id === attachmentId)
    if (!target) throw Object.assign(new Error('截图不存在'), { status: 404 })
    this.memos[index] = {
      ...current,
      attachments: list.filter((a) => a.id !== attachmentId),
      updatedAt: nowIso()
    }
    await this.persist()
    this.log(id, 'detach', meta.actor || 'web', meta.reason, [
      { field: 'attachments', from: target.name, to: '' }
    ])
    return { ok: true }
  }

  async importMemos(list, mode) {
    const incoming = (Array.isArray(list) ? list : []).map((m) => sanitize(m, {}))
    const valid = incoming.filter((m) => m.title)
    if (mode === 'replace') {
      this.memos = valid
    } else {
      const byId = new Map(this.memos.map((m) => [m.id, m]))
      for (const memo of valid) byId.set(memo.id, memo)
      this.memos = Array.from(byId.values())
    }
    await this.persist()
    this.log('__import__', 'import', 'web', '', [{ field: 'count', from: '', to: String(valid.length) }])
    return { ok: true, count: valid.length, total: this.memos.length }
  }

  listNotes() {
    return [...this.notes].sort(
      (a, b) => a.order - b.order || new Date(a.createdAt) - new Date(b.createdAt)
    )
  }

  async createNote(payload) {
    const note = sanitizeNote(payload, {})
    if (!note.content) throw Object.assign(new Error('便签内容不能为空'), { status: 400 })
    this.notes.push(note)
    await this.persistNotes()
    return note
  }

  async updateNote(id, patch) {
    const index = this.notes.findIndex((n) => n.id === id)
    if (index === -1) throw Object.assign(new Error('便签不存在'), { status: 404 })
    const next = sanitizeNote({ ...this.notes[index], ...patch }, this.notes[index])
    if (!next.content) throw Object.assign(new Error('便签内容不能为空'), { status: 400 })
    this.notes[index] = next
    await this.persistNotes()
    return next
  }

  async removeNote(id) {
    const index = this.notes.findIndex((n) => n.id === id)
    if (index === -1) throw Object.assign(new Error('便签不存在'), { status: 404 })
    this.notes.splice(index, 1)
    await this.persistNotes()
    return { ok: true }
  }

  getSettings() {
    return this.settings
  }

  async updateSettings(patch) {
    this.settings = sanitizeSettings(patch || {}, this.settings)
    await this.persistSettings()
    return this.settings
  }
}
