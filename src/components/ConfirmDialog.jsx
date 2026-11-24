import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  open,
  title,
  body,
  detail,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'default',
  onCancel,
  onConfirm
}) {
  const btnRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const timer = setTimeout(() => btnRef.current?.focus(), 40)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(timer)
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-mask" onClick={onCancel} role="presentation">
      <div
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="confirm-title">{title}</h3>
        {body && <p className="confirm-body">{body}</p>}
        {detail && <p className="confirm-detail">{detail}</p>}
        <div className="confirm-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            ref={btnRef}
            type="button"
            className={`primary-btn ${tone === 'danger' ? 'is-danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
