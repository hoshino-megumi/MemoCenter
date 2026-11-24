export default function StatsBar({ stats }) {
  const settled = stats.open + stats.done
  const items = [
    {
      key: 'open',
      label: '未完成',
      value: stats.open,
      sub: `今日到期 ${stats.todayDue}`
    },
    { key: 'done', label: '已完成', value: stats.done },
    { key: 'archived', label: '归档', value: stats.archived },
    { key: 'overdue', label: '已逾期', value: stats.overdue, tone: stats.overdue > 0 ? 'danger' : '' },
    { key: 'rate', label: '完成率', value: `${stats.rate}%`, sub: `${stats.done}/${settled}` }
  ]

  return (
    <div className="stats">
      {items.map((item) => (
        <div className={`stat ${item.tone || ''}`} key={item.key}>
          <div className="stat-head">
            <span>{item.label}</span>
            {item.sub && <span className="stat-sub">{item.sub}</span>}
          </div>
          <div className="stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
