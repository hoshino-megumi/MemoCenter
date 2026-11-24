import Icon from './Icon'
import { DOING_LABEL, formatDue, formatDate, isOverdue, STATUS_LABEL } from '../lib/format'

function MemoRow({ memo, view, active, onSelect, onToggle, onDelete, onRestore, onPurge, onArchive }) {
  const overdue = isOverdue(memo)
  const isTrash = view === 'trash'
  const done = memo.status === 'done'
  const archived = memo.status === 'archived'
  const attachCount = (memo.attachments || []).length

  return (
    <div
      className={`memo ${done ? 'is-done' : ''} ${archived ? 'is-archived' : ''} ${active ? 'is-active' : ''} ${
        isTrash ? 'is-trash' : ''
      }`}
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
          className={`check ${done ? 'is-checked' : ''}`}
          aria-label={done ? '标记为未完成' : '标记为已完成'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(memo)
          }}
        >
          {done && <Icon name="check" size={12} />}
        </button>
      )}

      <div className="memo-main">
        <div className="memo-title">
          {memo.pinned && <Icon name="pin" size={13} className="pin-icon" />}
          <span>{memo.title}</span>
        </div>
        <div className="memo-meta">
          <span className={`prio p-${(memo.priority || 'P2').toLowerCase()}`}>{memo.priority}</span>
          <span className="meta-type">{memo.type}</span>
          {memo.isDoing && <span className="meta-state">{DOING_LABEL}</span>}
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
  onEmptyTrash
}) {
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
                onSelect={onSelect}
                onToggle={onToggle}
                onDelete={onDelete}
                onRestore={onRestore}
                onPurge={onPurge}
                onArchive={onArchive}
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
