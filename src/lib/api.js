const isDesktop = typeof window !== 'undefined' && Boolean(window.memoDesktop?.available)

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(isDesktop ? { 'x-memo-client': 'desktop' } : {}),
      ...(options.headers || {})
    }
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败 (${res.status})`)
  }
  return data
}

export const api = {
  health: () => request('/api/health'),
  focus: () => request('/api/focus'),
  list: () => request('/api/memos').then((d) => d.memos || []),
  create: (payload) => request('/api/memos', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, patch) => request(`/api/memos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  archive: (id, archived, reason) =>
    request(`/api/memos/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived, reason }) }),
  history: (id) => request(`/api/memos/${id}/history`).then((d) => d.entries || []),
  allHistory: (limit = 200) => request(`/api/history?limit=${limit}`).then((d) => d.entries || []),
  addAttachment: (id, payload) =>
    request(`/api/memos/${id}/attachments`, { method: 'POST', body: JSON.stringify(payload) }),
  removeAttachment: (id, attId) =>
    request(`/api/memos/${id}/attachments/${attId}`, { method: 'DELETE' }),
  attachmentUrl: (id, attId) => `/api/memos/${id}/attachments/${attId}`,
  remove: (id, hard = false) => request(`/api/memos/${id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' }),
  restore: (id) => request(`/api/memos/${id}/restore`, { method: 'POST' }),
  emptyTrash: () => request('/api/trash', { method: 'DELETE' }),
  importJson: (payload) => request('/api/import', { method: 'POST', body: JSON.stringify(payload) }),
  reminderAck: (id, action, minutes) =>
    request(`/api/memos/${id}/reminder-ack`, {
      method: 'POST',
      body: JSON.stringify({ action, minutes })
    }),

  listNotes: () => request('/api/notes').then((d) => d.notes || []),
  createNote: (payload) => request('/api/notes', { method: 'POST', body: JSON.stringify(payload) }),
  updateNote: (id, patch) => request(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeNote: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),

  getSettings: () => request('/api/settings'),
  updateSettings: (patch) => request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) })
}
