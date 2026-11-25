import Icon from './Icon'
import { repeatLabel } from '../lib/repeat'

/**
 * 列表与抽屉共用的重复标识。
 *
 * 统一灰色小图标 + 文案，避免和 P0/P1 的彩色优先级角标抢视觉权重；
 * rule 为 null（规则被硬删、悬空 repeatId）时由 repeatLabel 降级为「重复」。
 */
export default function RepeatBadge({ rule = null, compact = false }) {
  const label = repeatLabel(rule)
  return (
    <span className={`repeat-badge ${compact ? 'is-compact' : ''}`} title={`重复事项 · ${label}`}>
      <Icon name="repeat" size={compact ? 12 : 13} />
      <span>{label}</span>
    </span>
  )
}
