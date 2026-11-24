import { forwardRef, useState } from 'react'
import Icon from './Icon'

const QuickAdd = forwardRef(function QuickAdd({ onCreate }, ref) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(expand) {
    const title = value.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      await onCreate(title, expand)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="quick-add">
      <Icon name="plus" size={16} className="quick-icon" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit(e.ctrlKey || e.metaKey)
          }
          if (e.key === 'Escape') setValue('')
        }}
        placeholder="添加待办，回车即存 · Ctrl+Enter 补充详情"
        aria-label="快速添加事项"
        spellCheck={false}
      />
      <button type="button" className="primary-btn" onClick={() => submit(false)} disabled={!value.trim() || busy}>
        添加
      </button>
    </div>
  )
})

export default QuickAdd
