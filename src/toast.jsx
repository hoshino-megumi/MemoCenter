import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './toast.css'

const TOTAL = 14
const pad = (n) => String(n).padStart(2, '0')

function dueText(dueAt) {
  if (!dueAt) return ''
  const due = new Date(dueAt)
  const diff = due.getTime() - Date.now()
  const abs = Math.abs(diff)
  const label =
    abs < 3600000
      ? `${Math.max(1, Math.round(abs / 60000))} 分钟`
      : abs < 86400000
        ? `${Math.round(abs / 3600000)} 小时`
        : `${Math.round(abs / 86400000)} 天`
  const time = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  return diff >= 0 ? `${time} 截止 · 还有 ${label}` : `已逾期 ${label}`
}

function closeWindow() {
  if (window.memoDesktop?.closeWindow) window.memoDesktop.closeWindow()
  else window.close()
}

function Toast() {
  const id = new URLSearchParams(location.search).get('id')
  const [memo, setMemo] = useState(null)
  const [state, setState] = useState('loading')
  const [snoozeMin, setSnoozeMin] = useState(10)
  const [remaining, setRemaining] = useState(TOTAL)
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const theme = localStorage.getItem('memo-theme')
    if (theme) document.documentElement.dataset.theme = theme
    let alive = true
    Promise.all([
      fetch('/api/memos').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()).catch(() => null)
    ])
      .then(([list, settings]) => {
        if (!alive) return
        const found = (list.memos || []).find((m) => m.id === id)
        if (settings && Number(settings.snoozeMinutes)) setSnoozeMin(Number(settings.snoozeMinutes))
        setMemo(found || null)
        setState(found ? 'ready' : 'gone')
      })
      .catch(() => alive && setState('gone'))
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (state !== 'ready') return
    if (paused) return
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 0.25)), 250)
    return () => clearInterval(timer)
  }, [state, paused])

  useEffect(() => {
    if (state === 'ready' && remaining <= 0) closeWindow()
  }, [remaining, state])

  useEffect(() => {
    if (state !== 'gone') return
    const timer = setTimeout(closeWindow, 2600)
    return () => clearTimeout(timer)
  }, [state])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') closeWindow()
      if (e.key === 'Enter' && memo) act('done')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function act(action) {
    if (!memo || busy) return
    setBusy(true)
    try {
      if (action === 'open') {
        if (window.memoDesktop?.openMemo) window.memoDesktop.openMemo(memo.id)
        else window.open(`/?memo=${memo.id}`, '_blank')
        closeWindow()
        return
      }
      await fetch(`/api/memos/${memo.id}/reminder-ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, minutes: snoozeMin })
      })
      closeWindow()
    } catch {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return <div className="toast-wrap"><div className="toast-empty">正在载入提醒…</div></div>
  }

  if (state === 'gone' || !memo) {
    return <div className="toast-wrap"><div className="toast-empty">这条事项已不存在或已完成</div></div>
  }

  const p = (memo.priority || 'P2').toLowerCase()

  return (
    <div
      className="toast-wrap"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="toast-card">
        <div className={`toast-head ${p}`}>
          <span>{memo.priority || 'P2'}</span>
          <span>{memo.title ? '待办提醒' : ''}</span>
          <span className="toast-due">{memo.snoozeUntil ? '延后提醒' : dueText(memo.dueAt)}</span>
        </div>
        <div className="toast-body-inner">
          <p className="toast-title">{memo.title}</p>
          {memo.note && <p className="toast-note">{memo.note}</p>}
          <div className="toast-actions">
            <button type="button" className="toast-btn primary" disabled={busy} onClick={() => act('done')}>
              完成
            </button>
            <button type="button" className="toast-btn" disabled={busy} onClick={() => act('snooze')}>
              延后 {snoozeMin} 分钟
            </button>
            <button type="button" className="toast-btn" disabled={busy} onClick={() => act('open')}>
              打开详情
            </button>
          </div>
        </div>
        <div className="toast-progress">
          <span style={{ width: `${(remaining / TOTAL) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Toast />)
