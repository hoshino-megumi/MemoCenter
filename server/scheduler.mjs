const CATCH_UP_LIMIT = 6 * 3600 * 1000
const RETRY_COOLDOWN = 120000

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function inQuietHours(settings, now = new Date()) {
  const start = minutesOf(settings.quietStart)
  const end = minutesOf(settings.quietEnd)
  if (start === null || end === null || start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

/**
 * 每 20 秒扫描一次，把到点未提醒的事项交给 onDue。
 * 去重依赖 reminderFiredAt >= 生效时间；延后会清空 reminderFiredAt 并写入 snoozeUntil。
 */
export function createScheduler({ store, onDue, intervalMs = 20000, logger = console }) {
  const attempted = new Map()
  let timer = null
  let running = false

  function effectiveTime(memo) {
    const raw = memo.snoozeUntil || memo.reminderAt
    if (!raw) return null
    const time = new Date(raw).getTime()
    return Number.isNaN(time) ? null : time
  }

  async function tick() {
    if (running) return
    running = true
    try {
      const settings = store.getSettings()
      if (!settings.notifyEnabled) return
      const now = Date.now()
      if (inQuietHours(settings, new Date(now))) return

      for (const memo of store.list()) {
        if (memo.deletedAt || memo.status !== 'open') continue
        const due = effectiveTime(memo)
        if (due === null || due > now) continue

        const firedAt = memo.reminderFiredAt ? new Date(memo.reminderFiredAt).getTime() : 0
        if (firedAt >= due) continue

        if (now - due > CATCH_UP_LIMIT) {
          await store.update(memo.id, { reminderFiredAt: new Date().toISOString() }, { actor: 'system' })
          continue
        }

        const last = attempted.get(memo.id) || 0
        if (now - last < RETRY_COOLDOWN) continue
        attempted.set(memo.id, now)

        try {
          await onDue(memo)
          await store.update(
            memo.id,
            { reminderFiredAt: new Date().toISOString() },
            { actor: 'system', reason: '提醒已弹出' }
          )
        } catch (err) {
          logger.warn('[scheduler] 弹窗失败，稍后重试:', err.message)
        }
      }
    } catch (err) {
      logger.error('[scheduler] 扫描异常:', err.message)
    } finally {
      running = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(tick, intervalMs)
      timer.unref?.()
      setTimeout(tick, 1500).unref?.()
      logger.log(`[scheduler] 已启动，扫描间隔 ${intervalMs / 1000}s`)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    tick
  }
}
