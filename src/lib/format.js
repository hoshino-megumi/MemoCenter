export const PRIORITIES = [
  { value: 'P0', label: 'P0 紧急', short: 'P0' },
  { value: 'P1', label: 'P1 高', short: 'P1' },
  { value: 'P2', label: 'P2 中', short: 'P2' },
  { value: 'P3', label: 'P3 低', short: 'P3' }
]

export const TYPES = ['需求', '缺陷', '会议', '跟进', '日常']

export const STATUS_LABEL = { open: '未完成', done: '已完成', archived: '归档' }

export const DOING_LABEL = '进行中'

export const STATUS_ORDER = ['open', 'done', 'archived']

export const FIELD_LABEL = {
  title: '标题',
  type: '类型',
  priority: '优先级',
  status: '状态',
  tags: '标签',
  dueAt: '截止时间',
  reminderAt: '提醒时间',
  note: '备注',
  pinned: '置顶',
  isDoing: '进行中标记',
  attachments: '截图'
}

export function fieldText(field, value) {
  if (field === 'status') return STATUS_LABEL[value] || value || '—'
  if (field === 'pinned' || field === 'isDoing') return value ? '是' : '否'
  if (field === 'priority') return value || '—'
  if (field === 'dueAt' || field === 'reminderAt') return value ? formatDate(value) : '—'
  if (value === '' || value === null || value === undefined) return '—'
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

export const priorityLabel = (value) =>
  (PRIORITIES.find((p) => p.value === value) || PRIORITIES[2]).label

export const priorityShort = (value) => (value || 'P2').slice(0, 2)

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function isToday(iso) {
  if (!iso) return false
  const a = startOfDay(iso).getTime()
  const b = startOfDay(new Date()).getTime()
  return a === b
}

export function isOverdue(memo) {
  if (!memo.dueAt || memo.status !== 'open') return false
  return new Date(memo.dueAt).getTime() < Date.now()
}

export function formatDue(iso) {
  if (!iso) return ''
  const due = new Date(iso)
  const today = startOfDay(new Date())
  const target = startOfDay(due)
  const diff = Math.round((target - today) / 86400000)
  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0
  const time = hasTime
    ? `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
    : ''
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][due.getDay()]

  if (diff === 0) return time ? `今天 ${time}` : '今天'
  if (diff === 1) return time ? `明天 ${time}` : '明天'
  if (diff === -1) return time ? `昨天 ${time}` : '昨天'
  if (diff > 1 && diff < 7) return time ? `${week} ${time}` : week
  const md = `${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
  return time ? `${md} ${time}` : md
}

export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
