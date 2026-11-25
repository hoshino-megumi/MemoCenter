import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import ConfirmDialog from './ConfirmDialog'
import { PRIORITIES, TYPES } from '../lib/format'
import { weekdayLabel, normalizeTimeInput } from '../lib/repeat'

const LEADS = [0, 15, 30, 60]

const FALLBACK_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: weekdayLabel(value) }))

function toForm(rule) {
  return {
    title: rule?.title || '',
    type: rule?.type || '日常',
    priority: rule?.priority || 'P2',
    tags: (rule?.tags || []).join(', '),
    freq: rule?.freq || 'daily',
    weekday: rule?.weekday || 3,
    // 规则里 dueTime=null 表示不设截止，编辑时要保持空值，不能被默认值回填
    dueTime: rule ? rule.dueTime || '' : '18:00',
    reminderLead: rule?.reminderLead ?? 30,
    note: rule?.note || ''
  }
}

const MODE_META = {
  create: { title: '新建重复规则', hint: '定义一次，每天 / 每周自动出现；已完成当天不会自动生成明天。', save: '创建规则' },
  edit: { title: '修改重复规则', hint: '这里改的是规则本身；今天已经生成的那条不会跟着变。', save: '保存规则' },
  apply: { title: '改整个系列', hint: '规则与今天仍处于未完成的那条一起更新；已完成 / 已跳过的不会动。', save: '改整个系列' }
}

/**
 * 规则编辑弹窗。三种模式共用同一套控件：
 *   create —— 新建规则，保存后服务端立即生成今天这条
 *   edit   —— 只改规则，今天已有实例保持不变
 *   apply  —— 改规则 + 同步覆盖今天仍 open 的实例，进入前先二次确认
 */
export default function RepeatDialog({ open, mode = 'create', rule = null, weekdays, onCancel, onSave, notify }) {
  const [form, setForm] = useState(() => toForm(rule))
  const [ack, setAck] = useState(mode !== 'apply')
  const [saving, setSaving] = useState(false)

  const dayOptions = useMemo(() => {
    if (Array.isArray(weekdays) && weekdays.length === 7) return weekdays
    return FALLBACK_WEEKDAYS
  }, [weekdays])

  useEffect(() => {
    if (!open) return
    setForm(toForm(rule))
    setAck(mode !== 'apply')
    setSaving(false)
  }, [open, mode, rule])

  if (!open) return null

  const meta = MODE_META[mode] || MODE_META.create

  function change(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit() {
    const title = form.title.trim()
    if (!title) {
      notify?.('规则标题不能为空', 'danger')
      return
    }
    if (form.freq === 'weekly' && !dayOptions.some((d) => d.value === Number(form.weekday))) {
      notify?.('请选择星期几', 'danger')
      return
    }
    const tags = form.tags
      .split(/[,，]/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 8)
    const payload = {
      title,
      type: form.type,
      priority: form.priority,
      tags,
      freq: form.freq,
      weekday: form.freq === 'weekly' ? Number(form.weekday) : null,
      dueTime: normalizeTimeInput(form.dueTime) || null,
      reminderLead: Number(form.reminderLead),
      note: form.note.trim()
    }
    setSaving(true)
    try {
      await onSave(payload)
    } catch (err) {
      notify?.(err.message || '保存失败', 'danger')
      setSaving(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={mode === 'apply' && !ack}
        title="确定改整个系列？"
        body={`「${rule?.title || ''}」的规则会被修改，并同步覆盖今天仍处于未完成的那一条。`}
        detail="今天这条若被单独改过，会被系列设置覆盖；已完成或已跳过的不会改动。"
        confirmText="继续修改"
        onCancel={onCancel}
        onConfirm={() => setAck(true)}
      />

      {ack && (
        <div className="repeat-mask" role="presentation" onClick={onCancel}>
          <div
            className="repeat-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={meta.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="repeat-dialog-head">
              <div className="repeat-dialog-heading">
                <Icon name="repeat" size={16} />
                <h3>{meta.title}</h3>
              </div>
              <button type="button" className="icon-btn" onClick={onCancel} aria-label="关闭">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className="repeat-dialog-body">
              <p className="repeat-dialog-hint">{meta.hint}</p>

              <div className="field">
                <label className="field-label">标题</label>
                <input
                  type="text"
                  value={form.title}
                  maxLength={200}
                  placeholder="例如：每日站会"
                  onChange={(e) => change('title', e.target.value)}
                />
              </div>

              <div className="field-grid">
                <div className="field">
                  <label className="field-label">类型</label>
                  <select value={form.type} onChange={(e) => change('type', e.target.value)}>
                    {TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">优先级</label>
                  <select value={form.priority} onChange={(e) => change('priority', e.target.value)}>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field-label">频率</label>
                <div className="segmented">
                  <button
                    type="button"
                    className={form.freq === 'daily' ? 'is-on' : ''}
                    onClick={() => change('freq', 'daily')}
                  >
                    每日
                  </button>
                  <button
                    type="button"
                    className={form.freq === 'weekly' ? 'is-on' : ''}
                    onClick={() => change('freq', 'weekly')}
                  >
                    每周
                  </button>
                </div>
              </div>

              {form.freq === 'weekly' && (
                <div className="field">
                  <label className="field-label">星期（只选一天）</label>
                  <div className="repeat-day-chips">
                    {dayOptions.map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        className={`chip ${Number(form.weekday) === Number(day.value) ? 'is-on' : ''}`}
                        aria-pressed={Number(form.weekday) === Number(day.value)}
                        onClick={() => change('weekday', Number(day.value))}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field-grid">
                <div className="field">
                  <label className="field-label">截止时分</label>
                  <input
                    type="time"
                    step="60"
                    value={form.dueTime}
                    onChange={(e) => change('dueTime', e.target.value)}
                  />
                  <p className="field-hint">清空表示不设截止，不会进「今天」视图</p>
                </div>
                <div className="field">
                  <label className="field-label">提前提醒</label>
                  <select value={form.reminderLead} onChange={(e) => change('reminderLead', e.target.value)}>
                    {LEADS.map((min) => (
                      <option key={min} value={min}>
                        {min === 0 ? '截止时' : `${min} 分钟`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field-label">标签（逗号分隔）</label>
                <input
                  type="text"
                  value={form.tags}
                  maxLength={200}
                  placeholder="例如：日常, 健康"
                  onChange={(e) => change('tags', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label">规则备注</label>
                <textarea
                  rows={3}
                  value={form.note}
                  maxLength={4000}
                  placeholder="记录这条规则的背景或例外情况"
                  onChange={(e) => change('note', e.target.value)}
                />
              </div>

              {mode === 'apply' && (
                <p className="repeat-hint">今天这条若被单独改过，会被系列设置覆盖。</p>
              )}
            </div>

            <footer className="repeat-dialog-foot">
              <button type="button" className="ghost-btn" onClick={onCancel}>
                取消
              </button>
              <button type="button" className="primary-btn" onClick={submit} disabled={saving}>
                {saving ? '保存中…' : meta.save}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
