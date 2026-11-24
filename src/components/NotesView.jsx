import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { api } from '../lib/api'

const COLORS = ['amber', 'blue', 'green', 'pink', 'gray']

export default function NotesView({ notify, onCount }) {
  const [notes, setNotes] = useState([])
  const [ready, setReady] = useState(false)
  const timers = useRef({})

  const load = useCallback(async () => {
    try {
      setNotes(await api.listNotes())
    } catch (err) {
      notify?.(err.message, 'danger')
    } finally {
      setReady(true)
    }
  }, [notify])

  useEffect(() => {
    load()
    return () => Object.values(timers.current).forEach(clearTimeout)
  }, [load])

  useEffect(() => {
    onCount?.(notes.filter((n) => n.content.trim()).length)
  }, [notes, onCount])

  function addNote() {
    const draft = { id: null, tmp: `tmp-${Date.now()}`, content: '', color: COLORS[notes.length % COLORS.length] }
    setNotes((prev) => [draft, ...prev])
  }

  function editNote(note, content) {
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id && n.tmp === note.tmp ? { ...n, content } : n))
    )
    const key = note.id || note.tmp
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => save({ ...note, content }), 700)
  }

  async function save(note) {
    const content = note.content.trim()
    if (!content) return
    try {
      if (note.id) {
        await api.updateNote(note.id, { content, color: note.color })
      } else {
        const created = await api.createNote({ content, color: note.color })
        setNotes((prev) => prev.map((n) => (n.tmp === note.tmp ? { ...created } : n)))
      }
    } catch (err) {
      notify?.(err.message, 'danger')
    }
  }

  async function remove(note) {
    if (note.id) {
      try {
        await api.removeNote(note.id)
      } catch (err) {
        notify?.(err.message, 'danger')
        return
      }
    }
    setNotes((prev) => prev.filter((n) => (note.id ? n.id !== note.id : n.tmp !== note.tmp)))
  }

  async function changeColor(note, color) {
    setNotes((prev) => prev.map((n) => (n.id === note.id && n.tmp === note.tmp ? { ...n, color } : n)))
    if (note.id) {
      api.updateNote(note.id, { color }).catch((err) => notify?.(err.message, 'danger'))
    }
  }

  return (
    <div className="notes-view">
      <div className="notes-grid">
        <button type="button" className="note-add" onClick={addNote}>
          <Icon name="plus" size={16} />
          新建便签
        </button>
        {ready && notes.length === 0 && (
          <p className="notes-empty">还没有便签。随手记的短内容放在这里，不会混进待办列表。</p>
        )}
        {notes.map((note) => (
          <div className={`note-card note-${note.color}`} key={note.id || note.tmp}>
            <textarea
              value={note.content}
              placeholder="写点什么…"
              onChange={(e) => editNote(note, e.target.value)}
              onBlur={(e) => save({ ...note, content: e.target.value })}
            />
            <div className="note-bar">
              {COLORS.map((color) => (
                <span
                  key={color}
                  className={`note-dot ${color}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`切换为 ${color}`}
                  onClick={() => changeColor(note, color)}
                />
              ))}
              <button type="button" className="note-del" onClick={() => remove(note)} aria-label="删除便签">
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
