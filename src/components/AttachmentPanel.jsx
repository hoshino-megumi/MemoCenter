import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { api } from '../lib/api'

const MAX_EDGE = 1600
const QUALITY = 0.82
const LIMIT = 20

async function compress(file) {
  if (!file.type.startsWith('image/')) throw new Error('只能添加图片文件')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
  if (!blob) throw new Error('图片转换失败，换一张试试')
  return { blob, width, height }
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`)

export default function AttachmentPanel({ memoId, attachments = [], onChange, notify }) {
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)
  const busy = useRef(false)

  const handleFiles = useCallback(
    async (files) => {
      if (busy.current) return
      const room = LIMIT - attachments.length
      if (room <= 0) {
        notify(`单条事项最多 ${LIMIT} 张截图`, 'danger')
        return
      }
      const list = Array.from(files)
        .filter((f) => f.type.startsWith('image/'))
        .slice(0, room)
      if (!list.length) return
      busy.current = true
      setUploading(true)
      let ok = 0
      try {
        for (const file of list) {
          const { blob, width, height } = await compress(file)
          const data = await toBase64(blob)
          await api.addAttachment(memoId, {
            data,
            name: file.name || '粘贴截图',
            mime: 'image/webp',
            width,
            height
          })
          ok += 1
        }
        onChange?.()
      } catch (err) {
        notify(err.message, 'danger')
      } finally {
        busy.current = false
        setUploading(false)
      }
      if (ok) notify(`已添加 ${ok} 张截图`)
    },
    [attachments.length, memoId, onChange, notify]
  )

  useEffect(() => {
    function onPaste(event) {
      const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      handleFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFiles])

  async function remove(att) {
    try {
      await api.removeAttachment(memoId, att.id)
      onChange?.()
      notify('已删除截图')
    } catch (err) {
      notify(err.message, 'danger')
    }
  }

  return (
    <div
      className={`attach ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      {attachments.length > 0 && (
        <div className="attach-grid">
          {attachments.map((att) => (
            <figure className="attach-item" key={att.id}>
              <button type="button" className="attach-thumb" onClick={() => setPreview(att)} title={att.name}>
                <img src={api.attachmentUrl(memoId, att.id)} alt={att.name} loading="lazy" />
              </button>
              <button
                type="button"
                className="attach-remove"
                aria-label={`删除截图 ${att.name}`}
                onClick={() => remove(att)}
              >
                <Icon name="close" size={11} />
              </button>
              <figcaption>{sizeText(att.size)}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="attach-actions">
        <button type="button" className="mini-chip" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? '上传中…' : '选择图片'}
        </button>
        <span className="attach-hint">
          {attachments.length
            ? `${attachments.length}/${LIMIT} 张 · 可直接 Ctrl+V 粘贴截图`
            : 'Ctrl+V 粘贴截图，或把图片拖到这里'}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)} role="presentation">
          <img src={api.attachmentUrl(memoId, preview.id)} alt={preview.name} />
          <p>
            {preview.name} · {preview.width}×{preview.height} · {sizeText(preview.size)}
          </p>
        </div>
      )}
    </div>
  )
}
