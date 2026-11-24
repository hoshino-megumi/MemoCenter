import { PRIORITIES, TYPES } from '../lib/format'

export default function FilterBar({
  types,
  priorities,
  showDone,
  onToggleType,
  onTogglePriority,
  onToggleShowDone,
  onReset,
  activeCount
}) {
  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">类型</span>
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={`chip ${types.includes(type) ? 'is-on' : ''}`}
            onClick={() => onToggleType(type)}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">优先级</span>
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`chip prio-chip p-${p.value.toLowerCase()} ${priorities.includes(p.value) ? 'is-on' : ''}`}
            onClick={() => onTogglePriority(p.value)}
          >
            {p.short}
          </button>
        ))}
      </div>

      <div className="filter-end">
        <label className="switch">
          <input type="checkbox" checked={showDone} onChange={onToggleShowDone} />
          <span>含已完成与归档</span>
        </label>
        {activeCount > 0 && (
          <button type="button" className="text-btn" onClick={onReset}>
            清除筛选 ({activeCount})
          </button>
        )}
      </div>
    </div>
  )
}
