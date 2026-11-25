import { Store } from './store.mjs'

/**
 * 延迟构造 Store 的门面（facade）。
 *
 * 背景 / 存在的问题：
 *   `new Store(dir)` 构造函数里立刻调用 `init()`，而 `init()` 结尾会 `persist()`
 *   把内存快照整体写回 `memos.json`。也就是说：**只要构造了 Store，就已经写盘了**。
 *   之前 desktop/main.mjs 与 server/index.mjs 都在 `listen()` 之前构造 Store，
 *   于是当端口已被另一个进程占用（EADDRINUSE）时，后来的进程虽然复用/退出了，
 *   但它那一瞬间已经用「自己读到 + 规范化后的旧快照」覆写了 `memos.json`，
 *   造成 last-write-wins 的数据丢失。
 *
 * 解决办法：
 *   把「占用端口」与「构造 Store」拆成两步，顺序严格固定为
 *     createAppServer(门面) → listen 成功 → attach() 真正构造 Store
 *   `listen` 成功是本进程独占端口的证明，因此在此之前本进程绝不会写任何业务数据。
 *
 * 门面只在 `createAppServer()` 构造期被读取一次 `dir`（用于定位截图目录），
 * 真正的读写都发生在请求处理阶段。
 *
 * 就绪判定 = 「已 attach」**且**「Store.init() 已完成」：
 *   attach 之后 init 尚未完成的几毫秒内，门面同样抛 503，
 *   避免读到空的 `count: 0`、或写进一条随后被 init 覆盖掉的记录。
 *   请求方（前端）拿到 503 会重试，真正就绪后自然恢复。
 */

/** 未就绪时抛出 503，让 app.mjs 的 catch 归一化为 503 响应。 */
function notReadyError() {
  return Object.assign(new Error('数据尚未就绪，请稍后重试'), { status: 503 })
}

/**
 * @param {string} dataDir 数据目录绝对路径
 */
export function createLazyStore(dataDir) {
  /** @type {Store|null} */
  let instance = null
  /** @type {Promise<void>|null} */
  let readyPromise = null
  /**
   * `Store.init()` 是否已完成。
   *
   * 只判断 `instance` 是不够的：`listen` 成功后才 `attach()`，而 `init()` 是异步的，
   * 两者之间存在一个几毫秒的窗口 —— 此时 `instance` 已存在，但 `this.memos` 还是初始 `[]`。
   * 窗口内若放行请求会出现两种坏结果：
   *   · 读：`GET /api/health` 返回 200 + `count: 0`，前端误以为库是空的
   *   · 写：`POST /api/memos` 先 `unshift` 再 `persist`，随后 init 的 `readJson`
   *         返回并 `this.memos = ...` 整体覆盖，导致「接口 201 成功但刷新后那条不见了」
   * 因此就绪判定必须是「已 attach **且** init 已完成」。
   */
  let ready = false

  const facade = new Proxy(
    { dir: dataDir },
    {
      get(target, prop) {
        if (prop === 'dir') return dataDir
        // 避免被 Promise / util.inspect 当成 thenable 或需要探针的对象
        if (prop === 'then' || prop === 'toJSON') return undefined
        if (typeof prop === 'symbol') return target[prop]
        if (!instance || !ready) throw notReadyError()
        const value = instance[prop]
        return typeof value === 'function' ? value.bind(instance) : value
      }
    }
  )

  return {
    /** 交给 createAppServer 使用的门面对象 */
    facade,
    /** 真正的 Store 实例（未 attach 前为 null） */
    get instance() {
      return instance
    },
    /** Store.init() 的 promise（未 attach 前为 null） */
    get ready() {
      return readyPromise
    },
    /**
     * 构造真正的 Store。必须在端口占用成功（listen 回调）之后调用，且只调用一次。
     * 注意：返回的是**原始 Store 实例**（不是门面），因此 `attach().ready`
     * 就是 `Store.init()` 的 promise，可以正常 `await` / 捕获失败。
     * @returns {Store}
     */
    attach() {
      if (instance) return instance
      instance = new Store(dataDir)
      // init 成功后才放开闸门；标志位在本 `.then` 里置位，
      // 因为监听先于调用方的 `await store.ready` 注册，所以调用方恢复执行时 ready 必为 true。
      readyPromise = instance.ready.then(() => {
        ready = true
      })
      // 附加空 catch：init 失败时不让 readyPromise 变成 unhandledRejection（Node 会直接崩进程），
      // 同时保留对外 reject 语义 —— `await lazyStore.ready` 仍能感知失败。
      readyPromise.catch(() => {})
      return instance
    }
  }
}
