import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import StatsBar from './components/StatsBar'
import QuickAdd from './components/QuickAdd'
import FilterBar from './components/FilterBar'
import MemoList from './components/MemoList'
import MemoDrawer from './components/MemoDrawer'
import NotesView from './components/NotesView'
import ConfirmDialog from './components/ConfirmDialog'
import Icon from './components/Icon'
import { api } from './lib/api'
import { useMemos } from './hooks/useMemos'
import {
  VIEWS,
  collectTags,
  computeStats,
  countView,
  filterMemos,
  groupMemos,
  sortMemos
} from './lib/filters'

function emptyFor(view, tag, q) {
  if (q) return { title: '没有匹配的事项', sub: '换个关键词，或者清除筛选条件再试' }
  if (tag) return { title: `#${tag} 下暂无事项`, sub: '在事项详情里添加这个标签即可归入' }
  switch (view) {
    case 'today':
      return { title: '今天没有到期事项', sub: '可以往前推进几条待办，或者安排点新任务' }
    case 'week':
      return { title: '本周暂无安排', sub: '给重要事项设个截止时间，会出现在这里' }
    case 'overdue':
      return { title: '没有逾期事项', sub: '节奏保持得不错' }
    case 'nodue':
      return { title: '所有事项都设了截止时间', sub: '空档也可以用来处理临时插入的任务' }
    case 'done':
      return { title: '还没有已完成的事项', sub: '完成一条就会出现在这里' }
    case 'archive':
      return { title: '还没有归档的事项', sub: '做完不想留在列表里的事项，归档后仍可查' }
    case 'trash':
      return { title: '回收站是空的', sub: '删除的事项会先放到这里，随时可以恢复' }
    default:
      return { title: '还没有任何事项', sub: '在上方输入框敲一条，回车即存' }
  }
}

export default function App() {
  const [view, setView] = useState('all')
  const [tag, setTag] = useState(null)
  const [q, setQ] = useState('')
  const [types, setTypes] = useState([])
  const [priorities, setPriorities] = useState([])
  const [showDone, setShowDone] = useState(false)
  const [sort, setSort] = useState('priority')
  const [selectedId, setSelectedId] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirmState, setConfirmState] = useState(null)
  const [desktopAlive, setDesktopAlive] = useState(false)
  const [noteCount, setNoteCount] = useState(0)
  const [requireReason, setRequireReason] = useState(false)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('memo-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const searchRef = useRef(null)
  const quickRef = useRef(null)
  const fileRef = useRef(null)
  const toastTimer = useRef(null)
  const deepLinkDone = useRef(false)

  const notify = useCallback((msg, tone = 'info') => {
    setToast({ msg, tone })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  const askConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmState({
        ...options,
        onCancel: () => {
          setConfirmState(null)
          resolve(false)
        },
        onConfirm: () => {
          setConfirmState(null)
          resolve(true)
        }
      })
    })
  }, [])

  const {
    memos,
    ready,
    create,
    update,
    remove,
    restore,
    purge,
    emptyTrash,
    importJson,
    reload
  } = useMemos((message) => notify(message, 'danger'))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('memo-theme', theme)
  }, [theme])

  useEffect(() => {
    let alive = true
    const check = () => {
      api
        .health()
        .then((h) => {
          if (!alive) return
          setDesktopAlive(Boolean(h.desktop))
          setNoteCount(h.notes || 0)
          setRequireReason(Boolean(h.requireReason))
        })
        .catch(() => {})
    }
    check()
    const timer = setInterval(check, 30000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    function onKey(event) {
      const el = event.target
      const tagName = (el.tagName || '').toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || el.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        quickRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!ready || deepLinkDone.current) return
    deepLinkDone.current = true
    const params = new URLSearchParams(location.search)
    const memoId = params.get('memo')
    if (memoId && memos.some((m) => m.id === memoId)) setSelectedId(memoId)
    if (params.get('quick') === '1') setTimeout(() => quickRef.current?.focus(), 200)
  }, [ready, memos])

  const filtered = useMemo(    () => sortMemos(filterMemos(memos, { view, tag, q, types, priorities, showDone }), sort),
    [memos, view, tag, q, types, priorities, showDone, sort]
  )
  const groups = useMemo(() => groupMemos(filtered, view), [filtered, view])
  const stats = useMemo(() => computeStats(memos), [memos])
  const tags = useMemo(() => collectTags(memos), [memos])
  const counts = useMemo(
    () => ({
      all: countView(memos, 'all'),
      today: countView(memos, 'today'),
      week: countView(memos, 'week'),
      overdue: countView(memos, 'overdue'),
      nodue: countView(memos, 'nodue'),
      done: countView(memos, 'done'),
      archive: countView(memos, 'archive'),
      trash: countView(memos, 'trash')
    }),
    [memos]
  )

  const selectedMemo = selectedId ? memos.find((m) => m.id === selectedId) || null : null
  const currentView =
    view === 'notes' ? { key: 'notes', label: '便签' } : VIEWS.find((v) => v.key === view) || VIEWS[0]
  const activeFilters =
    types.length + priorities.length + (showDone ? 1 : 0) + (tag ? 1 : 0) + (q.trim() ? 1 : 0)

  const handleCreate = useCallback(
    async (title, expand) => {
      try {
        const memo = await create({ title })
        notify('已添加')
        if (expand) setSelectedId(memo.id)
      } catch (err) {
        notify(err.message, 'danger')
      }
    },
    [create, notify]
  )

  const handleView = useCallback((key) => {
    setView(key)
    setTag(null)
    if (key === 'trash' || key === 'done' || key === 'archive' || key === 'notes') setSelectedId(null)
  }, [])

  const handleFocus = useCallback(() => {
    if (window.memoDesktop?.openFocus) {
      window.memoDesktop.openFocus()
    } else {
      notify('桌面端未运行：请在项目目录执行 npm run desktop', 'danger')
    }
  }, [notify])

  const handleTag = useCallback((name) => {
    setTag(name)
    if (name) setView('all')
  }, [])

  const handleToggle = useCallback(
    async (memo) => {
      const nextStatus = memo.status === 'open' ? 'done' : 'open'
      try {
        await update(memo.id, { status: nextStatus })
      } catch {
        /* 已回滚并提示 */
      }
    },
    [update]
  )

  const handleArchive = useCallback(
    async (memo, archived = true) => {
      try {
        if (!archived) {
          await update(memo.id, { status: 'open' })
          notify('已取消归档')
          return
        }
        if (memo.status === 'done') {
          const ok = await askConfirm({
            title: '归档这条已完成事项？',
            body: `「${memo.title}」会从已完成列表移到归档。`,
            detail: '归档后不再提醒、不计入逾期，可随时恢复到未完成。',
            confirmText: '归档'
          })
          if (!ok) return
        }
        await api.archive(memo.id, true)
        notify('已归档')
      } catch (err) {
        notify(err.message, 'danger')
      }
    },
    [update, askConfirm, notify]
  )

  const handleDelete = useCallback(
    async (memo) => {
      const ok = await askConfirm({
        title: '移入回收站？',
        body: `「${memo.title}」将从列表中移除。`,
        detail: '可在回收站恢复到未完成，或彻底删除。',
        confirmText: '移入回收站'
      })
      if (!ok) return false
      try {
        await remove(memo.id)
        if (selectedId === memo.id) setSelectedId(null)
        notify('已移入回收站')
        return true
      } catch {
        /* 已回滚并提示 */
        return false
      }
    },
    [remove, selectedId, askConfirm, notify]
  )

  const handleRestore = useCallback(
    async (memo) => {
      try {
        await restore(memo.id)
        notify('已恢复到未完成')
      } catch {
        /* 已回滚并提示 */
      }
    },
    [restore, notify]
  )

  const handlePurge = useCallback(
    async (memo) => {
      const hasAttachments = (memo.attachments || []).length > 0
      const ok = await askConfirm({
        title: '彻底删除这条事项？',
        body: `「${memo.title}」将被永久删除。`,
        detail: hasAttachments
          ? `此操作不可恢复，${memo.attachments.length} 张截图附件会一并删除。`
          : '此操作不可恢复。',
        confirmText: '永久删除',
        tone: 'danger'
      })
      if (!ok) return false
      try {
        await purge(memo.id)
        if (selectedId === memo.id) setSelectedId(null)
        notify('已彻底删除')
        return true
      } catch {
        /* 已回滚并提示 */
        return false
      }
    },
    [purge, selectedId, askConfirm, notify]
  )

  const handleEmptyTrash = useCallback(async () => {
    const count = memos.filter((m) => m.deletedAt).length
    if (!count) {
      notify('回收站已经是空的')
      return
    }
    const ok = await askConfirm({
      title: `清空回收站？`,
      body: `回收站内 ${count} 条事项将被永久删除。`,
      detail: '包含这些事项的截图附件，此操作不可恢复。',
      confirmText: '全部永久删除',
      tone: 'danger'
    })
    if (!ok) return
    try {
      await emptyTrash()
      notify('回收站已清空')
    } catch {
      /* 已回滚并提示 */
    }
  }, [emptyTrash, memos, askConfirm, notify])

  const handleSave = useCallback(
    async (id, patch) => {
      await update(id, patch)
    },
    [update]
  )

  const handleExport = useCallback(() => {
    const link = document.createElement('a')
    link.href = '/api/export'
    link.download = `memos-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    notify('已导出 JSON 备份')
  }, [notify])

  const handleImportFile = useCallback(
    async (event) => {
      const file = event.target.files && event.target.files[0]
      event.target.value = ''
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const list = Array.isArray(parsed) ? parsed : parsed.memos
        if (!Array.isArray(list)) throw new Error('文件里没有 memos 数组')
        const result = await importJson({ memos: list, mode: 'merge' })
        notify(`已导入 ${result.count} 条，当前共 ${result.total} 条`)
      } catch (err) {
        notify(`导入失败：${err.message}`, 'danger')
      }
    },
    [importJson, notify]
  )

  const resetFilters = useCallback(() => {
    setTypes([])
    setPriorities([])
    setShowDone(false)
    setTag(null)
    setQ('')
  }, [])

  const toggleType = useCallback((type) => {
    setTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }, [])

  const togglePriority = useCallback((priority) => {
    setPriorities((prev) =>
      prev.includes(priority) ? prev.filter((p) => p !== priority) : [...prev, priority]
    )
  }, [])

  return (
    <div className={`app ${selectedMemo ? 'has-drawer' : ''}`}>
      <Sidebar
        counts={counts}
        view={view}
        tag={tag}
        tags={tags}
        noteCount={noteCount}
        desktopAlive={desktopAlive}
        onView={handleView}
        onTag={handleTag}
        onFocus={handleFocus}
        onExport={handleExport}
        onImport={() => fileRef.current?.click()}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{tag ? `#${tag}` : currentView.label}</h1>
            <p className="topbar-sub">
              {view === 'notes'
                ? `${noteCount} 条便签 · 随手记，不进待办列表`
                : `${filtered.length} 条结果 · 未完成 ${stats.open} 条 · 已完成 ${stats.done} 条${
                    stats.archived ? ` · 归档 ${stats.archived} 条` : ''
                  }`}
            </p>
          </div>
          <div className="topbar-tools">
            <select
              className="sort-select mobile-only"
              value={tag ? 'all' : view}
              onChange={(e) => handleView(e.target.value)}
              aria-label="切换视图"
            >
              {VIEWS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
              <option value="notes">便签</option>
            </select>
            <div className="search">
              <Icon name="search" size={14} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索标题、备注、标签"
                aria-label="搜索事项"
              />
              {q && (
                <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="清除搜索">
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
            <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序方式">
              <option value="priority">按优先级</option>
              <option value="due">按截止时间</option>
              <option value="created">按创建时间</option>
              <option value="updated">按更新时间</option>
            </select>
          </div>
        </header>

        {view === 'notes' ? (
          <NotesView notify={notify} onCount={setNoteCount} />
        ) : (
          <>
            <StatsBar stats={stats} />

            {view !== 'trash' && <QuickAdd ref={quickRef} onCreate={handleCreate} />}

            <FilterBar
              types={types}
              priorities={priorities}
              showDone={showDone}
              onToggleType={toggleType}
              onTogglePriority={togglePriority}
              onToggleShowDone={() => setShowDone((v) => !v)}
              onReset={resetFilters}
              activeCount={activeFilters}
            />

            <MemoList
              groups={groups}
              view={view}
              total={filtered.length}
              ready={ready}
              counts={stats}
              emptyText={emptyFor(view, tag, q)}
              selectedId={selectedId}
              onSelect={(memo) => setSelectedId(memo.id)}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onPurge={handlePurge}
              onArchive={handleArchive}
              onEmptyTrash={handleEmptyTrash}
            />
          </>
        )}
      </main>

      {selectedMemo && (
        <MemoDrawer
          key={selectedMemo.id}
          memo={selectedMemo}
          onClose={() => setSelectedId(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onPurge={handlePurge}
          onArchive={handleArchive}
          notify={notify}
          desktopAlive={desktopAlive}
          askConfirm={askConfirm}
          requireReason={requireReason}
          onRefresh={reload}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        body={confirmState?.body}
        detail={confirmState?.detail}
        confirmText={confirmState?.confirmText}
        cancelText={confirmState?.cancelText}
        tone={confirmState?.tone}
        onCancel={confirmState?.onCancel || (() => setConfirmState(null))}
        onConfirm={confirmState?.onConfirm || (() => setConfirmState(null))}
      />

      {toast && <div className={`toast ${toast.tone}`}>{toast.msg}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        style={{ display: 'none' }}
      />
    </div>
  )
}
