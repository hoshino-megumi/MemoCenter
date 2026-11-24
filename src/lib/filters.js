import { isToday, isOverdue, startOfDay } from './format'

export const VIEWS = [
  { key: 'all', label: '全部事项' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'overdue', label: '逾期' },
  { key: 'nodue', label: '无截止' },
  { key: 'done', label: '已完成' },
  { key: 'archive', label: '归档' },
  { key: 'trash', label: '回收站' }
]

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }
const ACTIVE_VIEWS = ['all', 'today', 'week', 'overdue', 'nodue']

export function matchView(memo, view) {
  switch (view) {
    case 'today':
      return Boolean(memo.dueAt) && isToday(memo.dueAt)
    case 'week': {
      if (!memo.dueAt) return false
      const due = new Date(memo.dueAt).getTime()
      const from = startOfDay(new Date()).getTime()
      return due >= from && due < from + 7 * 86400000
    }
    case 'overdue':
      return isOverdue(memo)
    case 'nodue':
      return !memo.dueAt
    case 'done':
      return memo.status === 'done'
    case 'archive':
      return memo.status === 'archived'
    case 'trash':
      return Boolean(memo.deletedAt)
    default:
      return true
  }
}

export function countView(memos, view) {
  if (ACTIVE_VIEWS.includes(view)) {
    return memos.filter((m) => !m.deletedAt && m.status === 'open' && matchView(m, view)).length
  }
  return memos.filter((m) => !m.deletedAt && matchView(m, view)).length
}

export function filterMemos(memos, state) {
  const { view = 'all', tag = null, q = '', types = [], priorities = [], showDone = false } = state
  const keyword = q.trim().toLowerCase()

  return memos.filter((memo) => {
    if (view === 'trash') {
      if (!memo.deletedAt) return false
    } else if (memo.deletedAt) {
      return false
    }

    if (!matchView(memo, view)) return false
    if (tag && !(memo.tags || []).includes(tag)) return false
    if (types.length && !types.includes(memo.type)) return false
    if (priorities.length && !priorities.includes(memo.priority)) return false
    if (ACTIVE_VIEWS.includes(view) && !showDone && memo.status !== 'open') return false

    if (keyword) {
      const hay = `${memo.title} ${memo.note || ''} ${(memo.tags || []).join(' ')} ${memo.type}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    return true
  })
}

export function sortMemos(list, sort = 'priority') {
  const dueValue = (memo) => (memo.dueAt ? new Date(memo.dueAt).getTime() : Number.MAX_SAFE_INTEGER)
  const items = [...list]
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt)
    if (sort === 'updated') return new Date(b.updatedAt) - new Date(a.updatedAt)
    if (sort === 'due') {
      const diff = dueValue(a) - dueValue(b)
      if (diff !== 0) return diff
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    }
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (rank !== 0) return rank
    const diff = dueValue(a) - dueValue(b)
    if (diff !== 0) return diff
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
  return items
}

export function groupMemos(list, view) {
  if (view === 'done' || view === 'archive' || view === 'trash') {
    return [{ key: 'flat', label: '', items: list }]
  }
  const groups = [
    { key: 'open', label: '未完成', items: [] },
    { key: 'done', label: '已完成', items: [] },
    { key: 'archived', label: '归档', items: [] }
  ]
  for (const memo of list) {
    const group = groups.find((g) => g.key === memo.status) || groups[0]
    group.items.push(memo)
  }
  return groups.filter((g) => g.items.length > 0)
}

export function collectTags(memos) {
  const map = new Map()
  for (const memo of memos) {
    if (memo.deletedAt) continue
    for (const tag of memo.tags || []) {
      map.set(tag, (map.get(tag) || 0) + 1)
    }
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function computeStats(memos) {
  const active = memos.filter((m) => !m.deletedAt)
  const open = active.filter((m) => m.status === 'open')
  const done = active.filter((m) => m.status === 'done')
  const archived = active.filter((m) => m.status === 'archived')
  const settled = open.length + done.length
  return {
    open: open.length,
    doing: open.filter((m) => m.isDoing).length,
    todayDue: open.filter((m) => m.dueAt && isToday(m.dueAt)).length,
    overdue: active.filter((m) => isOverdue(m)).length,
    done: done.length,
    archived: archived.length,
    total: active.length,
    rate: settled ? Math.round((done.length / settled) * 100) : 0
  }
}
