/**
 * 重复规则引擎（零第三方依赖）。
 *
 * 本模块只负责：规则规范化、本地日期计算、命中判定、实例字段派生。
 * 所有日期键都基于本地时间，禁止使用 toISOString().slice(0,10)（UTC+8 早 8 点前会算成前一天）。
 *
 * ⚠️ 不得从本模块 import store.mjs —— store.mjs 会 import 本模块，否则形成循环依赖。
 * 枚举与 str/tagsOf 在本文件内镜像一份（项目已有 TYPES 在 store.mjs / format.js 双写的先例）。
 */

import { randomUUID } from 'node:crypto'

export const FREQS = ['daily', 'weekly']
export const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]

const TYPES = ['需求', '缺陷', '会议', '跟进', '日常']
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/
// 浏览器 <input type="time"> 在部分环境/输入方式下会产出 HH:mm:ss（如 17:30:00）。
// 规则只精确到分钟：接受带秒形式并丢弃秒（秒非 00 也接受，直接截断到分）。
const TIME_WITH_SECONDS = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/

/**
 * 归一化截止时刻：HH:mm 原样返回，HH:mm:ss 截断为 HH:mm；空值返回 null；非法返回 undefined。
 * 统一走这里，避免「浏览器带秒 / API 直接调用带秒」卡在 buildRule 的格式校验上。
 */
function normalizeTimeOfDay(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  if (TIME_OF_DAY.test(text)) return text
  const matched = TIME_WITH_SECONDS.exec(text)
  if (matched) return `${matched[1]}:${matched[2]}`
  return undefined
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

/** 本地日期键 YYYY-MM-DD。绝不使用 UTC 截取。 */
export function localDateKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** JS getDay(): 0=周日；规则里的 weekday 是 ISO 1=周一 … 7=周日。 */
export function isoWeekday(now = new Date()) {
  return now.getDay() || 7
}

function dayKeyToDate(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return new Date()
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** 幂等键：只在服务端内存 Set 里使用，不落盘。 */
export const repeatKey = (repeatId, dateKey) => `${repeatId}@${dateKey}`

/**
 * 校验并规范化一条规则。与 store.sanitize 同风格：白名单 + 默认值 + 无损回填。
 *
 * @param {object} input 客户端/导入数据
 * @param {object} [base] 已有规则（更新时传入，未提供的字段从 base 继承）
 * @returns {object} 规范化后的 RepeatRule
 * @throws {Error} status=400，字段非法时由 app.mjs 转为 400
 */
export function buildRule(input = {}, base = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const old = base && typeof base === 'object' ? base : {}
  const bad = (message) => Object.assign(new Error(message), { status: 400 })

  const title = str(src.title ?? old.title, 200)
  if (!title) throw bad('规则标题不能为空')

  const freq = FREQS.includes(src.freq) ? src.freq : old.freq || 'daily'
  if (!FREQS.includes(freq)) throw bad('重复频率只能是 daily 或 weekly')

  let weekday = null
  if (freq === 'weekly') {
    const raw = Object.prototype.hasOwnProperty.call(src, 'weekday') ? src.weekday : old.weekday
    const num = Number(raw)
    if (!Number.isInteger(num) || num < 1 || num > 7) throw bad('每周规则必须选择星期几（1=周一 … 7=周日）')
    weekday = num
  }

  let dueTime = null
  if (Object.prototype.hasOwnProperty.call(src, 'dueTime')) {
    const normalized = normalizeTimeOfDay(src.dueTime)
    if (normalized === undefined) throw bad('截止时刻格式应为 HH:mm')
    dueTime = normalized
  } else {
    const inherited = normalizeTimeOfDay(old.dueTime)
    dueTime = inherited === undefined ? '18:00' : inherited
  }

  let reminderLead = 30
  if (Object.prototype.hasOwnProperty.call(src, 'reminderLead')) {
    if (src.reminderLead === null) {
      reminderLead = null
    } else {
      const num = Number(src.reminderLead)
      if (!Number.isInteger(num) || num < 0 || num > 720) throw bad('提前提醒分钟数应为 0..720 或 null')
      reminderLead = num
    }
  } else if (Object.prototype.hasOwnProperty.call(old, 'reminderLead')) {
    reminderLead = old.reminderLead
  }

  const rawStart = src.startDate ?? old.startDate ?? localDateKey()
  if (!DATE_KEY.test(String(rawStart))) throw bad('开始日期格式应为 YYYY-MM-DD')

  const rawId = src.id || old.id
  const id = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(String(rawId))
    ? String(rawId)
    : `rp_${randomUUID().slice(0, 12)}`

  return {
    id,
    title,
    type: TYPES.includes(src.type) ? src.type : old.type || '日常',
    priority: PRIORITIES.includes(src.priority) ? src.priority : old.priority || 'P2',
    tags: Object.prototype.hasOwnProperty.call(src, 'tags') ? tagsOf(src.tags) : tagsOf(old.tags),
    note: Object.prototype.hasOwnProperty.call(src, 'note') ? str(src.note, 4000) : str(old.note, 4000),
    freq,
    weekday,
    dueTime,
    reminderLead,
    enabled: Object.prototype.hasOwnProperty.call(src, 'enabled')
      ? Boolean(src.enabled)
      : old.enabled !== false,
    startDate: String(rawStart),
    createdAt: isoOrNull(src.createdAt) || isoOrNull(old.createdAt) || nowIso(),
    updatedAt: isoOrNull(src.updatedAt) || nowIso(),
    deletedAt: src.deletedAt === null
      ? null
      : isoOrNull(src.deletedAt) || isoOrNull(old.deletedAt) || null
  }
}

/** buildRule 的文档别名，方便与 store 侧 sanitize* 命名保持一致。 */
export const sanitizeRepeat = buildRule

/** today（本地日期键）是否命中该规则。 */
export function matchRule(rule, dayKey, now) {
  if (!rule || !rule.enabled || rule.deletedAt) return false
  if (rule.freq === 'daily') return true
  if (rule.freq === 'weekly') return isoWeekday(now instanceof Date ? now : dayKeyToDate(dayKey)) === rule.weekday
  return false
}

/** hitsOn 的兼容别名（参数顺序与 matchRule 不同，保持文档中的调用习惯）。 */
export const hitsOn = (rule, now = new Date()) => matchRule(rule, localDateKey(now), now)

/**
 * 由规则 + 本地日期键派生实例字段。
 *
 * 「错过不补」：若提醒时刻已过（如下午才打开、规则是早 9 点），把 reminderFiredAt
 * 钉成 reminderAt 同一时刻，scheduler 的 `firedAt >= due` 判断会自动跳过，
 * 避免打开页面时突然补弹旧提醒。
 *
 * @param {object} rule 已规范化的规则
 * @param {string} dayKey 本地 YYYY-MM-DD
 * @param {Date} [now] 用于提醒抑制判定的当前时刻（可注入以便测试）
 */
export function instanceFields(rule, dayKey, now = new Date()) {
  const [y, m, d] = String(dayKey).split('-').map(Number)
  let dueAt = null
  let reminderAt = null
  let reminderFiredAt = null

  if (rule.dueTime) {
    const [hh, mm] = String(rule.dueTime).split(':').map(Number)
    const base = new Date(y, m - 1, d, hh, mm, 0, 0)
    dueAt = base.toISOString()
    if (rule.reminderLead !== null && rule.reminderLead !== undefined) {
      const rt = new Date(base.getTime() - Number(rule.reminderLead) * 60000)
      reminderAt = rt.toISOString()
      if (rt.getTime() <= now.getTime()) reminderFiredAt = reminderAt
    }
  }

  return {
    title: rule.title,
    type: rule.type,
    priority: rule.priority,
    tags: [...(rule.tags || [])],
    note: rule.note || '',
    dueAt,
    reminderAt,
    reminderFiredAt,
    status: 'open',
    isDoing: false
  }
}

/** 生成一条实例数据（尚未写入 Store）。 */
export function instanceFrom(rule, dayKey, now = new Date()) {
  return {
    ...instanceFields(rule, dayKey, now),
    repeatId: rule.id,
    repeatDate: String(dayKey)
  }
}

export const buildInstance = instanceFrom

/** 规则文案；规则不存在（硬删）时降级为「重复」。 */
export function repeatLabel(rule) {
  if (!rule) return '重复'
  if (rule.freq === 'daily') return '每日'
  const found = WEEKDAYS.find((w) => w.value === rule.weekday)
  return `每${found ? found.label : '周'}`
}
