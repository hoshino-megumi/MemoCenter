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
      // 生成实例与「是否弹窗」无关，必须放在 notifyEnabled / 静默时段判断之前。
      // 桌面独占模式传入的是 HTTP 适配器（没有 ensureToday），此处做能力探测，
      // 避免把整个 tick 判成异常而漏掉提醒。
      if (typeof store.ensureToday === 'function') {
        await store.ensureToday().catch((err) => logger.warn('[scheduler] 生成实例失败:', err.message))
      }
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

        // 注意：reminderFiredAt 不在 history.mjs 的 TRACKED_FIELDS 里，
        // 这里只改该字段时 diffMemos() 返回空，store.update() 不会写 history。
        // 产品决定：提醒是系统行为，不入变更流水账（否则每天每条提醒都记一笔，
        // 会把真正的人工修改埋掉），因此原 actor/reason 参数是死参数，已移除。
        if (now - due > CATCH_UP_LIMIT) {
          await store.update(memo.id, { reminderFiredAt: new Date().toISOString() })
          continue
        }

        const last = attempted.get(memo.id) || 0
        if (now - last < RETRY_COOLDOWN) continue
        attempted.set(memo.id, now)

        try {
          await onDue(memo)
          // 同上：此处写回 reminderFiredAt 不产生审计记录（产品决定），无需传 actor/reason。
          await store.update(memo.id, { reminderFiredAt: new Date().toISOString() })
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
    /**
     * 进程内定时驱动。
     *
     * ⚠️ 当前**没有任何调用点**（`grep 'scheduler.start'` 为空）：桌面端在
     * `startReminderLoop()` 里用 `setInterval(tick, 20000)` 外部驱动 `tick()`。
     * 因此 `[scheduler] 已启动` 这句话在当前版本永远不会打印，日志里若出现只能是历史残留；
     * 排查复用模式时请以 `[desktop] 提醒轮询已启动`（独占模式）/
     * `[desktop] 复用模式：不启动提醒调度`（复用模式）作为判据。
     *
     * 当前 T01 已把「固定事项生成」放进 tick() 首行，但桌面端仍由外部轮询驱动，
     * 本方法依旧没有调用点。将来若要改用 `if (ownsServer) scheduler.start()`，
     * **必须同时移除**桌面端的外部轮询，否则两处各跑一个 20s 定时器 =
     * 双重调度 → 重复弹窗。
     */
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
