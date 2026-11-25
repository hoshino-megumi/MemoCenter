import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Icon from './components/Icon'
import { formatDue, isOverdue } from './lib/format'
import './styles.css'
import './focus.css'

const COLORS = ['amber', 'blue', 'green', 'pink', 'gray']
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const tempId = () => `tmp-${Math.random().toString(36).slice(2, 9)}`

function todayLabel() {
  const d = new Date()
  return {
    date: `${d.getMonth() + 1} 月 ${d.getDate()} 日`,
    week: WEEK[d.getDay()]
  }
}

function Focus() {
  const [data, setData] = useState(null)
  const [notes, setNotes] = useState([])
  const [tab, setTab] = useState('today')
  const [topmost, setTopmost] = useState(true)
  const editingRef = useRef(false)
  const timers = useRef({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/focus')
      const json = await res.json()
      setData(json)
      if (!editingRef.current) setNotes(json.notes || [])
      if (typeof json.settings?.focusTopmost === 'boolean') setTopmost(json.settings.focusTopmost)
    } catch {
      /* 下次轮询再试 */
    }
  }, [])

  useEffect(() => {
    const theme = localStorage.getItem('memo-theme')
    if (theme) document.documentElement.dataset.theme = theme
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!editingRef.current) load()
    }, 30000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  async function toggleItem(memo) {
    setData((prev) =>
      prev ? { ...prev, items: prev.items.filter((m) => m.id !== memo.id) } : prev
    )
    await fetch(`/api/memos/${memo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    }).catch(() => {})
    setTimeout(load, 400)
  }

  function openMemo(id) {
    if (window.memoDesktop?.openMemo) window.memoDesktop.openMemo(id)
  }

  function close() {
    if (window.memoDesktop?.closeWindow) window.memoDesktop.closeWindow()
    else window.close()
  }

  async function toggleTop() {
    const next = !topmost
    setTopmost(next)
    if (window.memoDesktop?.setTopmost) await window.memoDesktop.setTopmost(next)
    else
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ focusTopmost: next })
      })
  }

  function addNote() {
    const note = { id: null, tmp: tempId(), content: '', color: COLORS[notes.length % COLORS.length] }
    setNotes((prev) => [...prev, note])
    setTab('notes')
  }

  function editNote(note, content) {
    editingRef.current = true
    setNotes((prev) => prev.map((n) => (n.id === note.id && n.tmp === note.tmp ? { ...n, content } : n)))
    const key = note.id || note.tmp
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => saveNote({ ...note, content }), 700)
  }

  async function saveNote(note) {
    if (!note.content.trim()) {
      editingRef.current = false
      return
    }
    try {
      if (note.id) {
        await fetch(`/api/notes/${note.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: note.content, color: note.color })
        })
      } else {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: note.content, color: note.color })
        })
        const created = await res.json()
        setNotes((prev) =>
          prev.map((n) => (n.tmp === note.tmp ? { ...created, tmp: undefined } : n))
        )
      }
    } catch {
      /* 忽略，下次输入重试 */
    } finally {
      editingRef.current = false
    }
  }

  async function removeNote(note) {
    if (note.id) await fetch(`/api/notes/${note.id}`, { method: 'DELETE' }).catch(() => {})
    setNotes((prev) => prev.filter((n) => (n.id ? n.id !== note.id : n.tmp !== note.tmp)))
  }

  async function changeColor(note, color) {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, color } : n)))
    if (note.id) {
      await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color })
      }).catch(() => {})
    }
  }

  const { date, week } = todayLabel()
  const items = data?.items || []
  const stats = data?.stats || { open: 0, doing: 0, overdue: 0, doneToday: 0 }

  return (
    <div className="fx-app">
      <header className="fx-head">
        <span className="fx-date">{date}</span>
        <span className="fx-week">{week}</span>
        <div className="fx-head-tools">
          <button
            type="button"
            className={`fx-tool ${topmost ? 'on' : ''}`}
            onClick={toggleTop}
            title={topmost ? '取消置顶' : '置顶窗口'}
          >
            <Icon name="pin" size={12} />
            置顶
          </button>
          <button type="button" className="fx-tool" onClick={load} title="刷新">
            <Icon name="restore" size={12} />
          </button>
          <button type="button" className="fx-tool" onClick={close} title="关闭">
            <Icon name="close" size={13} />
          </button>
        </div>
      </header>

      <div className="fx-tabs">
        <button type="button" className={`fx-tab ${tab === 'today' ? 'on' : ''}`} onClick={() => setTab('today')}>
          今日 {items.length}
        </button>
        <button type="button" className={`fx-tab ${tab === 'notes' ? 'on' : ''}`} onClick={() => setTab('notes')}>
          便签 {notes.length}
        </button>
      </div>

      <div className="fx-scroll">
        {tab === 'today' ? (
          items.length === 0 ? (
            <div className="fx-empty">
              今天没有紧急事项
              <br />
              可以安心推进手头工作
            </div>
          ) : (
            items.map((memo) => {
              const overdue = isOverdue(memo)
              return (
                <div className="fx-item" key={memo.id}>
                  <span
                    className="fx-check"
                    role="button"
                    tabIndex={0}
                    aria-label="标记完成"
                    onClick={() => toggleItem(memo)}
                    onKeyDown={(e) => e.key === 'Enter' && toggleItem(memo)}
                  />
                  <div className="fx-item-main" onClick={() => openMemo(memo.id)}>
                    <div className="fx-title">{memo.title}</div>
                    <div className="fx-meta">
                      <span className={`prio p-${(memo.priority || 'P2').toLowerCase()}`}>{memo.priority}</span>
                      <span>{memo.type}</span>
                      {memo.repeatLabel && <span className="fx-repeat">{memo.repeatLabel}</span>}
                      {memo.dueAt && (
                        <span className={overdue ? 'fx-overdue' : ''}>
                          {overdue ? '逾期 · ' : ''}
                          {formatDue(memo.dueAt)}
                        </span>
                      )}
                      {memo.snoozeUntil && <span>已延后</span>}
                    </div>
                  </div>
                </div>
              )
            })
          )
        ) : (
          <div className="fx-notes-grid">
            {notes.map((note) => (
              <div className={`fx-note fx-note-${note.color}`} key={note.id || note.tmp}>
                <textarea
                  value={note.content}
                  placeholder="写点什么…"
                  onChange={(e) => editNote(note, e.target.value)}
                  onFocus={() => {
                    editingRef.current = true
                  }}
                  onBlur={(e) => {
                    editingRef.current = false
                    saveNote({ ...note, content: e.target.value })
                  }}
                />
                <div className="fx-note-bar">
                  {COLORS.map((color) => (
                    <span
                      key={color}
                      className={`fx-dot ${color}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`切换为 ${color}`}
                      onClick={() => changeColor(note, color)}
                    />
                  ))}
                  {note.id && (
                    <button type="button" className="fx-note-del" onClick={() => removeNote(note)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" className="fx-add-note" onClick={addNote}>
              + 新建便签
            </button>
          </div>
        )}
      </div>

      <footer className="fx-foot">
        <span>
          逾期 {stats.overdue} · 未完成 {stats.open} · 今日完成 {stats.doneToday}
        </span>
        <span
          className="fx-link"
          role="button"
          tabIndex={0}
          onClick={() => window.memoDesktop?.openMain('')}
        >
          打开完整页面
        </span>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Focus />)
