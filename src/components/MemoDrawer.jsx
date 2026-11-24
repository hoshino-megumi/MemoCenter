import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import AttachmentPanel from './AttachmentPanel'
import HistoryTimeline from './HistoryTimeline'
import { PRIORITIES, STATUS_LABEL, TYPES, fromLocalInput, formatDate, toLocalInput } from '../lib/format'

const STATUS_OPTIONS = [
  { key: 'open', label: '未完成' },
  { key: 'done', label: '已完成' },
  { key: 'archived', label: '归档' }
]

const REASON_CHIPS = ['需求变更', '范围调整', '阻塞解除', '重复项', '误建', '已上线', '不再跟进']

const toForm = (memo) => ({
  title: memo.title || '',
  type: memo.type || '日常',
  priority: memo.priority || 'P2',
  status: memo.status || 'open',
  isDoing: Boolean(memo.isDoing),
  tags: [...(memo.tags || [])],
  due: toLocalInput(memo.dueAt),
  reminder: toLocalInput(memo.reminderAt),
  note: memo.note || '',
  pinned: Boolean(memo.pinned)
})

const pad = (n) => String(n).padStart(2, '0')
const timeText = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

export default function MemoDrawer({
  memo,
  onClose,
  onSave,
  onDelete,
  onRestore,
  onPurge,
  notify,
  desktopAlive = false,
  requireReason = false,
  onRefresh
}) {
  const [form, setForm] = useState(() => toForm(memo))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [pending, setPending] = useState(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const formRef = useRef(form)
  const timer = useRef(null)
  const mounted = useRef(true)
  const saveRef = useRef(onSave)
  const idRef = useRef(memo.id)
  const titleRef = useRef(null)
  const reasonRef = useRef(null)

  saveRef.current = onSave
  idRef.current = memo.id

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  useEffect(() => {
    const next = toForm(memo)
    formRef.current = next
    setForm(next)
    setSavedAt(null)
    setTagInput('')
    setPending(null)
    clearTimeout(timer.current)
  }, [memo.id])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 104)}px`
  }, [form.title, memo.id])

  useEffect(() => {
    if (pending) setTimeout(() => reasonRef.current?.focus(), 40)
  }, [pending])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeDrawer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function commit(next, reason) {
    if (!next.title.trim()) return
    const patch = {
      title: next.title.trim(),
      type: next.type,
      priority: next.priority,
      status: next.status,
      isDoing: next.status === 'open' ? Boolean(next.isDoing) : false,
      tags: next.tags,
      dueAt: fromLocalInput(next.due),
      reminderAt: fromLocalInput(next.reminder),
      note: next.note,
      pinned: next.pinned
    }
    if (reason) patch.reason = reason
    if (mounted.current) setSaving(true)
    try {
      await saveRef.current(idRef.current, patch)
      if (mounted.current) {
        setSavedAt(new Date())
        setHistoryVersion((v) => v + 1)
      }
    } catch {
      /* 错误由上层提示 */
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  function update(key, value, immediate = false) {
    const next = { ...formRef.current, [key]: value }
    formRef.current = next
    setForm(next)
    clearTimeout(timer.current)
    if (immediate) {
      commit(next)
      return
    }
    timer.current = setTimeout(() => commit(next), 550)
  }

  function flush() {
    clearTimeout(timer.current)
    if (formRef.current.title.trim()) commit(formRef.current)
  }

  function closeDrawer() {
    if (pending) {
      submitPending(false)
    } else {
      flush()
    }
    onClose()
  }

  function chooseStatus(next) {
    if (next === formRef.current.status) return
    const from = formRef.current.status
    const draft = {
      ...formRef.current,
      status: next,
      isDoing: next === 'open' ? formRef.current.isDoing : false
    }
    formRef.current = draft
    setForm(draft)
    clearTimeout(timer.current)
    setPending({ from, status: next, reason: '' })
  }

  async function submitPending(skip) {
    const current = pending
    if (!current) return
    const reason = skip ? '' : (current.reason || '').trim()
    if (!skip && requireReason && !reason) {
      notify('已开启「变更原因必填」，请填写原因或关闭该设置', 'danger')
      return
    }
    setPending(null)
    await commit(formRef.current, reason)
  }

  function addTag() {
    const value = tagInput.trim().replace(/^#/, '').replace(/[,，]/g, '')
    if (!value) return
    if (!formRef.current.tags.includes(value) && formRef.current.tags.length < 8) {
      update('tags', [...formRef.current.tags, value], true)
    }
    setTagInput('')
  }

  function quickReminder(kind) {
    if (kind === 'clear') return update('reminder', '', true)
    const d = new Date()
    if (kind === 'beforeDue') {
      if (!formRef.current.due) return
      const base = new Date(formRef.current.due)
      base.setMinutes(base.getMinutes() - 30)
      return update('reminder', toLocalInput(base.toISOString()), true)
    }
    if (kind === 'in30') {
      d.setTime(Date.now() + 30 * 60000)
      return update('reminder', toLocalInput(d.toISOString()), true)
    }
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    update('reminder', toLocalInput(d.toISOString()), true)
  }

  function quickDue(kind) {
    if (kind === 'clear') return update('due', '', true)
    const d = new Date()
    if (kind === 'today') {
      d.setHours(18, 0, 0, 0)
      if (d.getTime() < Date.now()) {
        d.setHours(23, 0, 0, 0)
      }
    } else {
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
    }
    update('due', toLocalInput(d.toISOString()), true)
  }

  if (memo.deletedAt) {
    return (
      <aside className="drawer">
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">已删除事项</p>
            <p className="drawer-hint">删除于 {formatDate(memo.deletedAt)}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="drawer-body">
          <p className="drawer-title-static">{memo.title}</p>
          <div className="memo-meta drawer-meta-row">
            <span className={`prio p-${(memo.priority || 'P2').toLowerCase()}`}>{memo.priority}</span>
            <span className="meta-type">{memo.type}</span>
            {(memo.tags || []).map((tag) => (
              <span className="meta-tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
          {memo.note && <p className="drawer-note">{memo.note}</p>}
          <div className="field">
            <label className="field-label">变更记录</label>
            <HistoryTimeline memoId={memo.id} refreshKey={historyVersion} />
          </div>
        </div>
        <footer className="drawer-foot">
          <button
            type="button"
            className="danger-btn"
            onClick={async () => {
              if (await onPurge(memo)) onClose()
            }}
          >
            彻底删除
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={async () => {
              await onRestore(memo)
              onClose()
            }}
          >
            恢复为未完成
          </button>
        </footer>
      </aside>
    )
  }

  return (
    <aside className="drawer">
      <header className="drawer-head">
        <div>
          <p className="drawer-kicker">编辑事项</p>
          <p className="drawer-hint">
            {saving ? '保存中…' : savedAt ? `已保存 ${timeText(savedAt)}` : '修改后自动保存'}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={closeDrawer} aria-label="关闭">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="drawer-pin">
        <textarea
          ref={titleRef}
          className="drawer-title"
          value={form.title}
          rows={1}
          placeholder="事项标题"
          onChange={(e) => update('title', e.target.value)}
          onBlur={() => flush()}
        />

        <div className="drawer-pin-row">
          <div className="field">
            <label className="field-label">状态</label>
            <div className="segmented">
              {STATUS_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={form.status === item.key ? 'is-on' : ''}
                  onClick={() => chooseStatus(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">优先级</label>
            <div className="segmented">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  title={p.label}
                  className={form.priority === p.value ? 'is-on' : ''}
                  onClick={() => update('priority', p.value, true)}
                >
                  {p.short}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {pending && (
        <div className="reason-bar">
          <p className="reason-title">
            状态由 <b>{STATUS_LABEL[pending.from]}</b> 改为 <b>{STATUS_LABEL[pending.status]}</b>
            {pending.status === 'archived' && <span className="reason-note">归档后不再提醒、不计入逾期</span>}
          </p>
          <div className="reason-input-row">
            <input
              ref={reasonRef}
              value={pending.reason}
              placeholder="填写变更原因（可选，例如：需求变更 / 已上线）"
              onChange={(e) => setPending((p) => (p ? { ...p, reason: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitPending(false)
                }
                if (e.nativeEvent.isComposing) e.stopPropagation()
              }}
            />
            <button type="button" className="primary-btn sm" onClick={() => submitPending(false)}>
              保存
            </button>
            <button
              type="button"
              className="ghost-btn sm"
              onClick={() => submitPending(true)}
              disabled={requireReason}
              title={requireReason ? '已开启原因必填' : '不填原因直接保存'}
            >
              跳过
            </button>
          </div>
          <div className="reason-chips">
            {REASON_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className={`mini-chip ${pending.reason === chip ? 'is-on' : ''}`}
                onClick={() => setPending((p) => (p ? { ...p, reason: chip } : p))}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="drawer-body">
        <div className="field">
          <label className="field-label">类型</label>
          <select value={form.type} onChange={(e) => update('type', e.target.value, true)}>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">截止时间</label>
          <input
            type="datetime-local"
            value={form.due}
            onChange={(e) => update('due', e.target.value, true)}
          />
          <div className="quick-row">
            <button type="button" className="mini-chip" onClick={() => quickDue('today')}>
              今天 18:00
            </button>
            <button type="button" className="mini-chip" onClick={() => quickDue('tomorrow')}>
              明天 09:00
            </button>
            <button type="button" className="mini-chip" onClick={() => quickDue('clear')}>
              清除
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field-label">提醒时间</label>
          <input
            type="datetime-local"
            value={form.reminder}
            onChange={(e) => update('reminder', e.target.value, true)}
          />
          <div className="quick-row">
            {form.due && (
              <button type="button" className="mini-chip" onClick={() => quickReminder('beforeDue')}>
                截止前 30 分钟
              </button>
            )}
            <button type="button" className="mini-chip" onClick={() => quickReminder('in30')}>
              30 分钟后
            </button>
            <button type="button" className="mini-chip" onClick={() => quickReminder('tomorrow')}>
              明天 09:00
            </button>
            <button type="button" className="mini-chip" onClick={() => quickReminder('clear')}>
              清除
            </button>
          </div>
          {!desktopAlive && <p className="field-hint">桌面端未运行，提醒不会弹出；运行 npm run desktop 后生效</p>}
          {form.status === 'archived' && <p className="field-hint">事项已归档，提醒不会触发</p>}
        </div>

        <div className="field">
          <label className="field-label">标签</label>
          <div className="tag-editor">
            {form.tags.map((tag) => (
              <span className="tag-pill" key={tag}>
                #{tag}
                <button
                  type="button"
                  aria-label={`移除标签 ${tag}`}
                  onClick={() => update('tags', form.tags.filter((t) => t !== tag), true)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              placeholder="输入后回车"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
                if (e.key === 'Backspace' && !tagInput && form.tags.length) {
                  update('tags', form.tags.slice(0, -1), true)
                }
                if (e.nativeEvent.isComposing) e.stopPropagation()
              }}
              onBlur={addTag}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label">备注</label>
          <textarea
            className="drawer-note-input"
            rows={5}
            value={form.note}
            placeholder="补充背景、结论或后续动作"
            onChange={(e) => update('note', e.target.value)}
            onBlur={() => flush()}
          />
        </div>

        <div className="field">
          <label className="field-label">截图佐证</label>
          <AttachmentPanel
            memoId={memo.id}
            attachments={memo.attachments || []}
            onChange={() => {
              onRefresh?.()
              setHistoryVersion((v) => v + 1)
            }}
            notify={notify}
          />
        </div>

        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={form.pinned} onChange={(e) => update('pinned', e.target.checked, true)} />
            <span>置顶显示</span>
          </label>
          {form.status === 'open' && (
            <label className="switch">
              <input
                type="checkbox"
                checked={form.isDoing}
                onChange={(e) => update('isDoing', e.target.checked, true)}
              />
              <span>标记为进行中</span>
            </label>
          )}
        </div>

        <div className="field">
          <button type="button" className="section-toggle" onClick={() => setHistoryOpen((v) => !v)}>
            <Icon name="history" size={13} />
            变更记录
            <span className="section-toggle-hint">{historyOpen ? '收起' : '展开'}</span>
          </button>
          {historyOpen && <HistoryTimeline memoId={memo.id} refreshKey={historyVersion} />}
        </div>

        <div className="drawer-meta">
          <span>创建 {formatDate(memo.createdAt)}</span>
          <span>更新 {formatDate(memo.updatedAt)}</span>
          {memo.archivedAt && <span>归档 {formatDate(memo.archivedAt)}</span>}
        </div>
      </div>

      <footer className="drawer-foot">
        <button
          type="button"
          className="danger-btn"
          onClick={async () => {
            if (await onDelete(memo)) onClose()
          }}
        >
          删除
        </button>
        <button type="button" className="primary-btn" onClick={closeDrawer}>
          完成编辑
        </button>
      </footer>
    </aside>
  )
}
