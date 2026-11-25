import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

export function useMemos(onError) {
  const [memos, setMemos] = useState([])
  const [ready, setReady] = useState(false)
  const ref = useRef([])
  const report = useRef(onError)

  report.current = onError

  useEffect(() => {
    ref.current = memos
  }, [memos])

  useEffect(() => {
    let alive = true
    api
      .list()
      .then((list) => {
        if (!alive) return
        setMemos(list)
        setReady(true)
      })
      .catch((err) => {
        if (!alive) return
        report.current?.(err.message)
        setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const replaceOne = useCallback((memo) => {
    setMemos((prev) => {
      const exists = prev.some((m) => m.id === memo.id)
      return exists ? prev.map((m) => (m.id === memo.id ? memo : m)) : [memo, ...prev]
    })
  }, [])

  const create = useCallback(
    async (payload) => {
      const memo = await api.create(payload)
      replaceOne(memo)
      return memo
    },
    [replaceOne]
  )

  const update = useCallback(
    async (id, patch) => {
      const before = ref.current.find((m) => m.id === id)
      if (before) {
        setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      }
      try {
        const memo = await api.update(id, patch)
        replaceOne(memo)
        return memo
      } catch (err) {
        if (before) replaceOne(before)
        report.current?.(err.message)
        throw err
      }
    },
    [replaceOne]
  )

  /**
   * 归档 / 取消归档一条事项。
   *
   * 先做乐观更新让列表立即响应，再用服务端返回的真实数据覆盖；失败时回滚并提示。
   * 服务端语义：归档 -> status=archived + archivedAt；取消归档 -> status=open，
   * archivedAt 与 completedAt 均被清空，因此本地乐观 patch 需保持一致。
   *
   * @param {string} id 事项 id
   * @param {boolean} [archived=true] true 归档，false 取消归档
   * @param {string} [reason] 可选的归档原因，写入变更历史
   * @returns {Promise<object>} 服务端返回的最新 memo
   */
  const archive = useCallback(
    async (id, archived = true, reason) => {
      const before = ref.current.find((m) => m.id === id)
      if (before) {
        const patch = archived
          ? { status: 'archived', archivedAt: new Date().toISOString() }
          : { status: 'open', archivedAt: null, completedAt: null }
        setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      }
      try {
        const memo = await api.archive(id, archived, reason)
        replaceOne(memo)
        return memo
      } catch (err) {
        if (before) replaceOne(before)
        report.current?.(err.message)
        throw err
      }
    },
    [replaceOne]
  )

  const remove = useCallback(async (id) => {
    setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, deletedAt: new Date().toISOString() } : m)))
    try {
      await api.remove(id, false)
    } catch (err) {
      report.current?.(err.message)
      throw err
    }
  }, [])

  const restore = useCallback(async (id) => {
    setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, deletedAt: null } : m)))
    try {
      const memo = await api.restore(id)
      replaceOne(memo)
      return memo
    } catch (err) {
      report.current?.(err.message)
      throw err
    }
  }, [replaceOne])

  const purge = useCallback(async (id) => {
    const before = ref.current
    setMemos((prev) => prev.filter((m) => m.id !== id))
    try {
      await api.remove(id, true)
    } catch (err) {
      setMemos(before)
      report.current?.(err.message)
      throw err
    }
  }, [])

  const emptyTrash = useCallback(async () => {
    const before = ref.current
    setMemos((prev) => prev.filter((m) => !m.deletedAt))
    try {
      await api.emptyTrash()
    } catch (err) {
      setMemos(before)
      report.current?.(err.message)
      throw err
    }
  }, [])

  const reload = useCallback(async () => {
    const list = await api.list()
    setMemos(list)
  }, [])

  const importJson = useCallback(
    async (payload) => {
      const result = await api.importJson(payload)
      await reload()
      return result
    },
    [reload]
  )

  return { memos, ready, create, update, archive, remove, restore, purge, emptyTrash, importJson, reload }
}
