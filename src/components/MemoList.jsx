import Icon from './Icon'
import RepeatBadge from './RepeatBadge'
import { DOING_LABEL, formatDue, formatDate, isOverdue, STATUS_LABEL } from '../lib/format'
import { repeatLabel } from '../lib/repeat'

function MemoRow({
  memo,
  view,
  active,
  rule = null,
  onSelect,
  onToggle,
  onDelete,
  onRestore,
  onPurge,
  onArchive,
  onSkip
}) {
  const overdue = isOverdue(memo)
  const isTrash = view === 'trash'
  const done = memo.status === 'done'
  const archived = memo.status === 'archived'
  const attachCount = (memo.attachments || []).length

  return (
    <div
      className={`memo ${done ? 'is-done' : ''} ${archived ? 'is-archived' : ''} ${active ? 'is-active' : ''} ${
        isTrash ? 'is-trash' : ''
      } ${memo.skippedAt ? 'is-skipped' : ''}`}
      onClick={() => onSelect(memo)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(memo)
        }
      }}
    >
      {!isTrash && !archived && (
        <button
          type="button"
          className={`check ${done ? 'is-checked' : ''} ${!done && memo.isDoing ? 'is-doing' : ''}`}
          aria-label={done ? '标记为未完成' : memo.isDoing ? '进行中，点击标记为已完成' : '标记为已完成'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(memo)
          }}
        >
          {done ? <Icon name="check" size={12} /> : memo.isDoing ? <span className="check-dot" /> : null}
        </button>
      )}

      <div className="memo-main">
        <div className="memo-title">
          {memo.pinned && <Icon name="pin" size={13} className="pin-icon" />}
          {memo.repeatId && <RepeatBadge rule={rule} compact />}
          <span>{memo.title}</span>
        </div>
        <div className="memo-meta">
          <span className={`prio p-${(memo.priority || 'P2').toLowerCase()}`}>{memo.priority}</span>
          <span className="meta-type">{memo.type}</span>
          {memo.repeatId && <span className="meta-repeat">{repeatLabel(rule)}</span>}
          {memo.skippedAt && <span className="meta-skipped">已跳过</span>}
          {memo.isDoing && <span className="meta-state is-doing">{DOING_LABEL}</span>}
          {archived && (
            <span className="meta-state is-archived" title={memo.archivedAt ? `归档于 ${formatDate(memo.archivedAt)}` : '已归档'}>
              {STATUS_LABEL.archived}
            </span>
          )}
          {(memo.tags || []).map((tag) => (
            <span className="meta-tag" key={tag}>
              #{tag}
            </span>
          ))}
          {memo.dueAt && (
            <span className={`meta-due ${overdue ? 'is-overdue' : ''}`}>
              {overdue ? '逾期 · ' : ''}
              {formatDue(memo.dueAt)}
            </span>
          )}
          {memo.reminderAt && memo.status === 'open' && (
            <span className="meta-alarm" title={`提醒时间 ${formatDate(memo.reminderAt)}`}>
              <Icon name="bell" size={11} />
              {formatDue(memo.reminderAt)}
            </span>
          )}
          {attachCount > 0 && (
            <span className="meta-note" title={`${attachCount} 张截图`}>
              <Icon name="image" size={12} />
              {attachCount}
            </span>
          )}
          {memo.note && (
            <span className="meta-note" title={memo.note}>
              <Icon name="note" size={12} />
              备注
            </span>
          )}
          {isTrash && memo.deletedAt && <span className="meta-due">删除于 {formatDate(memo.deletedAt)}</span>}
        </div>
      </div>

      <div className="memo-actions">
        {isTrash ? (
          <>
            <button
              type="button"
              className="mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                onRestore(memo)
              }}
            >
              恢复
            </button>
            <button
              type="button"
              className="mini-btn danger"
              onClick={(e) => {
                e.stopPropagation()
                onPurge(memo)
              }}
            >
              彻底删除
            </button>
          </>
        ) : (
          <>
            {memo.repeatId && (
              <button
                type="button"
                className="mini-btn"
                title={memo.skippedAt ? '取消跳过，回到未完成' : '只跳过今天，明天照常出现'}
                onClick={(e) => {
                  e.stopPropagation()
                  onSkip?.(memo, !memo.skippedAt)
                }}
              >
                {memo.skippedAt ? '取消跳过' : '跳过'}
              </button>
            )}
            {archived ? (
              <button
                type="button"
                className="mini-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onArchive(memo, false)
                }}
              >
                取消归档
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                aria-label="归档"
                title="归档"
                onClick={(e) => {
                  e.stopPropagation()
                  onArchive(memo, true)
                }}
              >
                <Icon name="archive" size={15} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="删除"
              title="移入回收站"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(memo)
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function MemoList({
  groups,
  view,
  counts,
  total,
  ready,
  emptyText,
  selectedId,
  onSelect,
  onToggle,
  onDelete,
  onRestore,
  onPurge,
  onArchive,
  onEmptyTrash,
  rules = [],
  onSkip
}) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))

  if (!ready) {
    return (
      <div className="list-area">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton short" />
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="list-area empty">
        <div className="empty-mark">
          <Icon name="note" size={22} />
        </div>
        <p className="empty-title">{emptyText.title}</p>
        <p className="empty-sub">{emptyText.sub}</p>
      </div>
    )
  }

  return (
    <div className="list-area">
      {view === 'trash' && total > 0 && (
        <div className="list-head">
          <span>回收站共 {total} 条</span>
          <button type="button" className="text-btn danger" onClick={onEmptyTrash}>
            清空回收站
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section className="group" key={group.key}>
          {group.label && (
            <header className="group-head">
              <span>{group.label}</span>
              <span className="group-count">{group.items.length}</span>
            </header>
          )}
          <div className="group-body">
            {group.items.map((memo) => (
              <MemoRow
                key={memo.id}
                memo={memo}
                view={view}
                active={selectedId === memo.id}
                rule={memo.repeatId ? ruleById.get(memo.repeatId) || null : null}
                onSelect={onSelect}
                onToggle={onToggle}
                onDelete={onDelete}
                onRestore={onRestore}
                onPurge={onPurge}
                onArchive={onArchive}
                onSkip={onSkip}
              />
            ))}
          </div>
        </section>
      ))}
      <p className="list-foot">
        当前显示 {total} 条
        {counts ? ` · 共 ${counts.total} 条` : ''}
      </p>
    </div>
  )
}
