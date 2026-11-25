/**
 * 重复事项文案工具（纯函数，不依赖 React）。
 * 枚举值镜像服务端 server/repeat.mjs；页面运行时可优先读取 /api/health 下发的 weekdays。
 */

/**
 * 本地日期键 YYYY-MM-DD。跨天检测用它，禁止 toISOString().slice(0,10)
 * （UTC+8 早 8 点前会被算成前一天）。
 */
export function localDateKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 归一化时间输入：<input type="time"> 在部分浏览器/输入方式下会返回 HH:mm:ss（如 17:30:00），
 * 而规则只精确到分钟。这里在提交前截断到 HH:mm，避免把带秒的值发给服务端触发格式错误。
 * 空值返回 ''（表示不设截止）；无法识别时也返回原值，让服务端给出明确报错。
 */
export function normalizeTimeInput(value) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  if (!text) return ''
  const matched = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text)
  return matched ? `${matched[1]}:${matched[2]}` : text
}

/** ISO 星期：1=周一 … 7=周日 */
export function weekdayLabel(n) {
  const num = Number(n)
  const labels = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }
  return labels[num] || '周'
}

/**
 * 规则文案。规则被硬删（悬空 repeatId）时传入 null，降级显示「重复」。
 * @param {object|null} rule 重复规则
 * @returns {string}
 */
export function repeatLabel(rule) {
  if (!rule) return '重复'
  if (rule.freq === 'daily') return '每日'
  return `每${weekdayLabel(rule.weekday)}`
}
