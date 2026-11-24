import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { FIELD_LABEL, fieldText, formatDate } from '../lib/format'

const ACTION_LABEL = {
  create: '创建事项',
  update: '修改',
  delete: '移入回收站',
  restore: '从回收站恢复',
  purge: '彻底删除',
  archive: '归档',
  unarchive: '取消归档',
  attach: '添加截图',
  detach: '删除截图',
  import: '导入数据'
}

const ACTOR_LABEL = { web: '网页', desktop: '桌面端', system: '系统' }
const COLLAPSED = 5

function when(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const p = (n) => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (sameDay) return `今天 ${time}`
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`
}

export default function HistoryTimeline({ memoId, refreshKey }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .history(memoId)
      .then((list) => {
        if (!alive) return
        setEntries([...list].reverse())
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [memoId, refreshKey])

  if (loading) return <p className="history-empty">读取变更记录…</p>
  if (!entries.length) return <p className="history-empty">还没有变更记录</p>

  const visible = expanded ? entries : entries.slice(0, COLLAPSED)

  return (
    <div className="history">
      <ol className="history-list">
        {visible.map((entry) => (
          <li className="history-item" key={entry.id}>
            <span className={`history-dot action-${entry.action}`} />
            <div className="history-main">
              <p className="history-head">
                <span className="history-action">{ACTION_LABEL[entry.action] || entry.action}</span>
                <span className="history-time">{when(entry.at)}</span>
                <span className="history-actor">{ACTOR_LABEL[entry.actor] || entry.actor}</span>
              </p>
              {entry.action === 'create' ? (
                <p className="history-diff">建立了这条事项</p>
              ) : entry.changes && entry.changes.length ? (
                <ul className="history-diff">
                  {entry.changes.map((change, index) => (
                    <li key={`${entry.id}-${index}`}>
                      <span className="history-field">{FIELD_LABEL[change.field] || change.field}</span>
                      <span className="history-from">{fieldText(change.field, change.from)}</span>
                      <span className="history-arrow">→</span>
                      <span className="history-to">{fieldText(change.field, change.to)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="history-diff">{entry.action === 'purge' ? '永久删除，不可恢复' : '无字段变化'}</p>
              )}
              {entry.reason && <p className="history-reason">原因：{entry.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
      {entries.length > COLLAPSED && (
        <button type="button" className="text-btn history-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `展开全部 ${entries.length} 条`}
        </button>
      )}
      <p className="history-foot">最近记录来自 {formatDate(entries[0].at)}</p>
    </div>
  )
}
