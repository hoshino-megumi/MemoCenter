import Icon from './Icon'
import { VIEWS } from '../lib/filters'

export default function Sidebar({
  counts,
  view,
  tag,
  tags,
  noteCount = 0,
  desktopAlive = false,
  onView,
  onTag,
  onFocus,
  onExport,
  onImport,
  theme,
  onToggleTheme
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div>
          <p className="brand-name">备忘中心</p>
          <p className="brand-sub">Memo Center</p>
        </div>
      </div>

      <nav className="nav">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item ${view === item.key && !tag ? 'is-active' : ''}`}
            onClick={() => onView(item.key)}
          >
            <span className="nav-label">{item.label}</span>
            <span className="nav-count">{counts[item.key] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={`nav-item ${view === 'notes' ? 'is-active' : ''}`}
          onClick={() => onView('notes')}
        >
          <span className="nav-label">便签</span>
          <span className="nav-count">{noteCount}</span>
        </button>
      </nav>

      <div className="side-block">
        <p className="side-title">
          标签
          {tag && (
            <button type="button" className="side-clear" onClick={() => onTag(null)}>
              清除
            </button>
          )}
        </p>
        {tags.length === 0 ? (
          <p className="side-empty">还没有标签，编辑事项时添加</p>
        ) : (
          <div className="tag-list">
            {tags.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`tag-chip ${tag === item.name ? 'is-active' : ''}`}
                onClick={() => onTag(tag === item.name ? null : item.name)}
              >
                <span className="tag-text">#{item.name}</span>
                <span className="tag-count">{item.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="side-foot">
        <button type="button" className="ghost-btn" onClick={onFocus}>
          <Icon name="bell" size={15} />
          今日焦点窗
          <span className={`status-dot ${desktopAlive ? 'on' : ''}`} />
        </button>
        <button type="button" className="ghost-btn" onClick={onExport}>
          <Icon name="download" size={15} />
          导出备份
        </button>
        <button type="button" className="ghost-btn" onClick={onImport}>
          <Icon name="upload" size={15} />
          导入数据
        </button>
        <button type="button" className="ghost-btn" onClick={onToggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          {theme === 'dark' ? '浅色模式' : '深色模式'}
        </button>
        <p className="side-hint">
          桌面提醒：{desktopAlive ? '运行中' : '未运行'}
          <br />
          数据在 data/memos.json，每日快照
        </p>
      </div>
    </aside>
  )
}
