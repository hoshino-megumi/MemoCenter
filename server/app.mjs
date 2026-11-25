import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { TYPES, PRIORITIES, STATUSES, NOTE_COLORS, STATUS_LABELS } from './store.mjs'
import { AttachmentStore } from './attachments.mjs'
import { FREQS, WEEKDAYS, localDateKey, repeatLabel } from './repeat.mjs'

const MAX_BODY = 12 * 1024 * 1024
const MAX_REPEAT_IN_FOCUS = 2

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

function fail(res, code, message) {
  sendJson(res, code, { error: message })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('请求体过大'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })
  }
}

const dayStart = (d = Date.now()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

const isSameDay = (a, b = Date.now()) => dayStart(a) === dayStart(b)

function buildFocus(store) {
  const now = Date.now()
  const all = store.list()
  const active = all.filter((m) => !m.deletedAt && m.status === 'open')

  const overdue = active.filter((m) => m.dueAt && new Date(m.dueAt).getTime() < now)
  const dueToday = active.filter((m) => m.dueAt && isSameDay(m.dueAt))
  const key = active.filter((m) => m.priority === 'P0' || m.priority === 'P1' || m.isDoing)
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 }

  const seen = new Set()
  const primary = []
  for (const memo of [...overdue, ...dueToday, ...key]) {
    if (seen.has(memo.id)) continue
    seen.add(memo.id)
    primary.push(memo)
  }
  primary.sort((a, b) => {
    const aOver = a.dueAt && new Date(a.dueAt).getTime() < now ? 0 : 1
    const bOver = b.dueAt && new Date(b.dueAt).getTime() < now ? 0 : 1
    if (aOver !== bOver) return aOver - bOver
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority]
    const av = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
    const bv = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
    return av - bv
  })

  // 「不足 3 条从剩余补齐」折叠进同一个候选池：不再有第二段独立补齐逻辑。
  const rest = active
    .filter((m) => !seen.has(m.id))
    .sort((a, b) => rank[a.priority] - rank[b.priority] || new Date(b.updatedAt) - new Date(a.updatedAt))

  const ruleById = new Map(store.listRepeats({ includeDeleted: true }).map((r) => [r.id, r]))
  const picked = []
  let repeatQuota = MAX_REPEAT_IN_FOCUS
  for (const memo of [...primary, ...rest]) {
    if (picked.length >= 6) break
    // 硬上限：即使总条数不足 3，也不放宽重复项配额（软上限等于没做配额）。
    if (memo.repeatId) {
      if (repeatQuota <= 0) continue
      repeatQuota -= 1
    }
    picked.push({
      ...memo,
      repeatLabel: memo.repeatId ? repeatLabel(ruleById.get(memo.repeatId) || null) : null
    })
  }

  return {
    date: new Date().toISOString(),
    items: picked,
    notes: store.listNotes(),
    stats: {
      open: active.length,
      doing: active.filter((m) => m.isDoing).length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      done: all.filter((m) => m.status === 'done' && !m.deletedAt).length,
      archived: all.filter((m) => m.status === 'archived' && !m.deletedAt).length,
      doneToday: all.filter(
        (m) => m.status === 'done' && m.completedAt && isSameDay(m.completedAt) && !m.deletedAt
      ).length
    },
    settings: store.getSettings()
  }
}

export function createAppServer({ store, distDir, onReminderAck }) {
  const attachments = new AttachmentStore(path.join(store.dir, 'attachments'))
  let desktopPing = 0
  const desktopAlive = () => Date.now() - desktopPing < 90000
  const actorOf = (req) => (String(req.headers['x-memo-client'] || '') === 'desktop' ? 'desktop' : 'web')

  async function handleApi(req, res, url) {
    const p = url.pathname
    const method = req.method || 'GET'

    if (p === '/api/desktop/ping' && method === 'POST') {
      desktopPing = Date.now()
      return sendJson(res, 200, { ok: true })
    }

    if (p === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        count: store.list().length,
        notes: store.listNotes().length,
        history: await store.history.count(),
        desktop: desktopAlive(),
        requireReason: Boolean(store.getSettings().requireReason),
        dataFile: store.file,
        types: TYPES,
        priorities: PRIORITIES,
        statuses: STATUSES,
        statusLabels: STATUS_LABELS,
        noteColors: NOTE_COLORS,
        repeats: store.listRepeats().length,
        freqs: FREQS,
        weekdays: WEEKDAYS.map((w) => w.value),
        weekdayLabels: WEEKDAYS
      })
    }

    if (p === '/api/focus' && method === 'GET') {
      // 幂等快路径：同一天几乎零成本；生成与响应内容强相关，必须发生在 buildFocus 之前。
      await store.ensureToday()
      return sendJson(res, 200, buildFocus(store))
    }

    if (p === '/api/repeats') {
      if (method === 'GET') {
        const includeDeleted = url.searchParams.get('includeDeleted') === '1'
        return sendJson(res, 200, { repeats: store.listRepeats({ includeDeleted }) })
      }
      if (method === 'POST') {
        const body = await readBody(req)
        const actor = actorOf(req)
        const repeat = await store.createRepeat(body, { actor, reason: body.reason })
        // 建完立刻生成本次实例；今天不命中（如周二建周三规则）时 memo 为 null。
        await store.ensureToday()
        const memo = store.list().find(
          (m) => m.repeatId === repeat.id && m.repeatDate === localDateKey()
        ) || null
        return sendJson(res, 201, { repeat, memo })
      }
      return fail(res, 405, '不支持的方法')
    }

    const repeatApply = /^\/api\/repeats\/([A-Za-z0-9_-]{1,64})\/apply$/.exec(p)
    if (repeatApply && method === 'POST') {
      const body = await readBody(req)
      const result = await store.applyRepeatToToday(repeatApply[1], body, {
        actor: actorOf(req),
        reason: body.reason
      })
      return sendJson(res, 200, result)
    }

    const repeatSingle = /^\/api\/repeats\/([A-Za-z0-9_-]{1,64})$/.exec(p)
    if (repeatSingle) {
      const id = repeatSingle[1]
      if (method === 'PATCH') {
        const body = await readBody(req)
        return sendJson(res, 200, {
          repeat: await store.updateRepeat(id, body, { actor: actorOf(req), reason: body.reason })
        })
      }
      if (method === 'DELETE') {
        const hard = url.searchParams.get('hard') === '1'
        const body = await readBody(req).catch(() => ({}))
        return sendJson(res, 200, await store.removeRepeat(id, hard, {
          actor: actorOf(req),
          reason: body.reason
        }))
      }
      return fail(res, 405, '不支持的方法')
    }

    if (p === '/api/settings') {
      if (method === 'GET') return sendJson(res, 200, store.getSettings())
      if (method === 'PATCH') return sendJson(res, 200, await store.updateSettings(await readBody(req)))
      return fail(res, 405, '不支持的方法')
    }

    if (p === '/api/memos') {
      if (method === 'GET') {
        await store.ensureToday()
        return sendJson(res, 200, { memos: store.list() })
      }
      if (method === 'POST') {
        const body = await readBody(req)
        return sendJson(res, 201, await store.create(body, { actor: actorOf(req), reason: body.reason }))
      }
      return fail(res, 405, '不支持的方法')
    }

    if (p === '/api/history' && method === 'GET') {
      const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit')) || 200))
      return sendJson(res, 200, { entries: await store.history.recent(limit) })
    }

    if (p === '/api/notes') {
      if (method === 'GET') return sendJson(res, 200, { notes: store.listNotes() })
      if (method === 'POST') return sendJson(res, 201, await store.createNote(await readBody(req)))
      return fail(res, 405, '不支持的方法')
    }

    if (p === '/api/trash' && method === 'DELETE') {
      const body = await readBody(req).catch(() => ({}))
      const doomed = store.list().filter((m) => m.deletedAt)
      for (const memo of doomed) await attachments.removeAll(memo.id)
      return sendJson(res, 200, await store.emptyTrash({ actor: actorOf(req), reason: body.reason }))
    }

    if (p === '/api/export' && method === 'GET') {
      const history = await store.history.recent(5000)
      const payload = JSON.stringify(
        {
          version: 4,
          exportedAt: new Date().toISOString(),
          memos: store.list(),
          notes: store.listNotes(),
          settings: store.getSettings(),
          repeats: store.listRepeats({ includeDeleted: true }),
          history
        },
        null,
        2
      )
      const stamp = new Date().toISOString().slice(0, 10)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="memos-${stamp}.json"`,
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store'
      })
      return res.end(payload)
    }

    if (p === '/api/import' && method === 'POST') {
      const body = await readBody(req)
      const list = Array.isArray(body) ? body : body.memos
      const mode = body && body.mode === 'replace' ? 'replace' : 'merge'
      if (!Array.isArray(list)) return fail(res, 400, '导入数据缺少 memos 数组')
      const result = await store.importMemos(list, mode)
      let repeatCount = 0
      if (Array.isArray(body.repeats)) {
        repeatCount = (await store.importRepeats(body.repeats, mode)).count
      }
      if (Array.isArray(body.notes)) {
        for (const note of body.notes) {
          if (!note || !note.content) continue
          const exists = store.listNotes().some((n) => n.id === note.id)
          if (exists) await store.updateNote(note.id, note)
          else await store.createNote(note)
        }
      }
      return sendJson(res, 200, { ...result, repeatCount })
    }

    const ackMatch = /^\/api\/memos\/([A-Za-z0-9-]{1,64})\/reminder-ack$/.exec(p)
    if (ackMatch && method === 'POST') {
      const id = ackMatch[1]
      const body = await readBody(req)
      const memo = store.list().find((m) => m.id === id)
      if (!memo) return fail(res, 404, '事项不存在')
      const action = body.action || 'dismiss'

      const actor = actorOf(req)

      if (action === 'done') {
        const next = await store.update(
          id,
          {
            status: 'done',
            reminderFiredAt: new Date().toISOString(),
            snoozeUntil: null
          },
          { actor, reason: body.reason || '从提醒弹窗完成' }
        )
        onReminderAck?.({ memo: next, action })
        return sendJson(res, 200, next)
      }
      if (action === 'snooze') {
        const minutes = Number(body.minutes) || store.getSettings().snoozeMinutes || 10
        const until = new Date(Date.now() + Math.min(120, Math.max(1, minutes)) * 60000).toISOString()
        const next = await store.update(
          id,
          { snoozeUntil: until, reminderFiredAt: null },
          { actor, reason: `延后 ${minutes} 分钟` }
        )
        onReminderAck?.({ memo: next, action, until })
        return sendJson(res, 200, next)
      }
      const next = await store.update(
        id,
        {
          reminderFiredAt: new Date().toISOString(),
          snoozeUntil: null
        },
        { actor, reason: body.reason }
      )
      onReminderAck?.({ memo: next, action })
      return sendJson(res, 200, next)
    }

    const skipMatch = /^\/api\/memos\/([A-Za-z0-9-]{1,64})\/skip$/.exec(p)
    if (skipMatch && method === 'POST') {
      const body = await readBody(req).catch(() => ({}))
      const memo = await store.skip(skipMatch[1], {
        actor: actorOf(req),
        reason: body.reason || '跳过本次'
      })
      return sendJson(res, 200, memo)
    }

    const attSingle = /^\/api\/memos\/([A-Za-z0-9-]{1,64})\/attachments\/([A-Za-z0-9]{6,64})$/.exec(p)
    if (attSingle) {
      const [, memoId, attId] = attSingle
      if (method === 'GET') {
        const { buffer, mime } = await attachments.read(memoId, attId)
        res.writeHead(200, {
          'content-type': mime,
          'content-length': buffer.length,
          'cache-control': 'private, max-age=86400'
        })
        return res.end(buffer)
      }
      if (method === 'DELETE') {
        await attachments.remove(memoId, attId)
        return sendJson(res, 200, await store.removeAttachment(memoId, attId, { actor: actorOf(req) }))
      }
      return fail(res, 405, '不支持的方法')
    }

    const memoSub = /^\/api\/memos\/([A-Za-z0-9-]{1,64})\/(restore|archive|history|attachments)$/.exec(p)
    if (memoSub) {
      const id = memoSub[1]
      const sub = memoSub[2]
      if (sub === 'restore' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}))
        return sendJson(res, 200, await store.restore(id, { actor: actorOf(req), reason: body.reason }))
      }
      if (sub === 'archive' && method === 'POST') {
        const body = await readBody(req)
        const memo = await store.archive(id, body.archived !== false, {
          actor: actorOf(req),
          reason: body.reason
        })
        return sendJson(res, 200, memo)
      }
      if (sub === 'history' && method === 'GET') {
        return sendJson(res, 200, { entries: await store.history.forMemo(id) })
      }
      if (sub === 'attachments') {
        if (method === 'GET') {
          const memo = store.get(id)
          if (!memo) return fail(res, 404, '事项不存在')
          return sendJson(res, 200, { attachments: memo.attachments || [] })
        }
        if (method === 'POST') {
          const body = await readBody(req)
          const saved = await attachments.save(id, body.data, {
            name: body.name,
            mime: body.mime,
            width: body.width,
            height: body.height
          })
          const att = await store.addAttachment(id, {
            ...saved,
            note: body.note,
            actor: actorOf(req),
            reason: body.reason
          })
          return sendJson(res, 201, att)
        }
      }
      return fail(res, 405, '不支持的方法')
    }

    const memoSingle = /^\/api\/memos\/([A-Za-z0-9-]{1,64})(\/restore)?$/.exec(p)
    if (memoSingle) {
      const id = memoSingle[1]
      if (memoSingle[2] === '/restore' && method === 'POST') {
        return sendJson(res, 200, await store.restore(id))
      }
      if (method === 'PATCH') {
        const body = await readBody(req)
        return sendJson(res, 200, await store.update(id, body, { actor: actorOf(req), reason: body.reason }))
      }
      if (method === 'DELETE') {
        const hard = url.searchParams.get('hard') === '1'
        const body = await readBody(req).catch(() => ({}))
        if (hard) await attachments.removeAll(id)
        return sendJson(res, 200, await store.remove(id, hard, { actor: actorOf(req), reason: body.reason }))
      }
      return fail(res, 405, '不支持的方法')
    }

    const noteSingle = /^\/api\/notes\/([A-Za-z0-9-]{1,64})$/.exec(p)
    if (noteSingle) {
      const id = noteSingle[1]
      if (method === 'PATCH') return sendJson(res, 200, await store.updateNote(id, await readBody(req)))
      if (method === 'DELETE') return sendJson(res, 200, await store.removeNote(id))
      return fail(res, 405, '不支持的方法')
    }

    return fail(res, 404, '接口不存在')
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '不支持的方法')

    let rel = decodeURIComponent(pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const resolved = path.resolve(path.join(distDir, rel))
    if (!resolved.startsWith(distDir)) return fail(res, 403, '禁止访问')

    try {
      const buf = await readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      })
      if (req.method === 'HEAD') return res.end()
      return res.end(buf)
    } catch {
      if (path.extname(resolved)) return fail(res, 404, '文件不存在')
      try {
        const buf = await readFile(path.join(distDir, 'index.html'))
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': buf.length,
          'cache-control': 'no-cache'
        })
        return res.end(buf)
      } catch {
        return fail(res, 404, '前端未构建，请先执行 npm run build')
      }
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url)
      else await serveStatic(req, res, url.pathname)
    } catch (err) {
      const code = err.status || 500
      if (code >= 500) console.error('[api]', err)
      if (!res.headersSent) fail(res, code, err.message || '服务器内部错误')
    }
  })
}
