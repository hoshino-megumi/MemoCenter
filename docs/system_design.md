# 每日 / 每周固定事项 —— 增量架构设计与任务分解

> 版本：v1 · 面向已有系统 `D:/WBwork/project/three` 的**增量**改造
> 结论：**方案整体可行，按本文档 5 个任务实施即可**。有 2 处必须先修正的既有隐患（见 §0.2），否则重复实例会造成数据损坏。

---

## 0. 代码复核结论（先读这一节）

### 0.1 与需求描述不符的地方（以代码为准）

| # | 需求描述 | 代码事实 | 影响 |
|---|---|---|---|
| F1 | 「当前 8 条」数据 | `data/memos.json` 实际 **5 条**（version 3，4 条 open + 1 条 archived） | 无影响，但幂等测试用例按 5 条基线写 |
| F2 | 「`scheduler.mjs` 每 20s 扫描」 | ✅ 正确，但 `desktop/main.mjs:310` **无条件** `scheduler.start()` | 见 F3，双实例问题 |
| F3 | 「生成时机：网页 + 托盘 + scheduler」被当作同一进程 | **`desktop/main.mjs:29` 自己 `new Store(ROOT/data)`**，与 `server/index.mjs:11` 是两个独立内存副本。端口被占用时 desktop 只复用 HTTP 端口（`ownsServer=false`），但**仍持有第二份 Store + 第二个 scheduler** | 🔴 **阻断级**。两个进程各自 `persist()` 全量覆写 `memos.json`，last-write-wins。重复生成会让冲突从「偶发」变成「每天必发」 |
| F4 | `history.mjs` 的 `TRACKED_FIELDS` 需不需要动 | 现在是 `title/type/priority/status/tags/dueAt/reminderAt/note/pinned/isDoing`，**不含 repeat 字段**；`action` 是自由字符串无枚举约束 | ✅ 无需改 `history.mjs` 结构，只在 `store.update` 支持 `meta.action` 覆盖 |
| F5 | 「`store.update()` 内做 diff 并写 history」 | ✅ 正确（`store.mjs:317`），但 `store.create()` **每次都会写一条 `create` 历史**（`store.mjs:285`） | ⚠️ 每日实例若走 `create()`，一年生成 ~2900 条历史记录会淹没 `history.jsonl`（当前才 48 行）。必须走新的 `createMany()` 且**不写历史** |

### 0.2 必须先修的既有隐患（本次一并处理）

| 编号 | 隐患 | 修法 | 归属任务 |
|---|---|---|---|
| R1 | desktop 进程在 `!ownsServer` 时仍跑自己的 scheduler + 自己的 Store 副本 | `desktop/main.mjs`：`if (ownsServer) scheduler.start()`；`ownsServer=false` 时只 ping 存活、只读不写 | T01 |
| R2 | 现状已有「双弹窗」风险（两个 scheduler 都触发 `notify`） | 随 R1 一并解决 | T01 |

> 若不想动 R1，则**必须**接受一个前提：ensure 生成只在 `server/index.mjs` 或「拥有端口的 desktop」里执行，另一侧永不生成。两种做法都必须改 `desktop/main.mjs`，逃不掉。

### 0.3 现有代码里可直接复用的东西（不用重写）

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 字段白名单 | `store.mjs:sanitize()` | 只需追加 2 个字段，**不做结构迁移** |
| 原子写 + 串行写队列 | `store.mjs:atomicWrite/persist()` | `createMany` 复用 `persist()`，一次落盘 |
| 变更日志 + reason | `store.mjs:update() + history.mjs` | 改系列/跳过直接透传 `reason` |
| 提醒去重 | `scheduler.mjs`（`reminderFiredAt >= due`） | 实例是普通 memo，天然生效 |
| 逾期 / 今日 / 归档语义 | `lib/format.js:isOverdue`、`filters.js` | 跳过 = archived，零改动即满足「不计逾期、不进分母」 |
| 确认弹窗 | `ConfirmDialog.jsx` + `App.askConfirm` | 改系列复用 |
| 本地时间工具 | `lib/format.js:toLocalInput/fromLocalInput` | 前端回填 |

---

## 1. 数据模型（精确到字段）

### 1.1 结论：规则独立存 `data/repeats.json`，实例只挂 2 个扁平字段

**判断理由（内嵌 vs 独立文件）：**

| 维度 | 内嵌在 memo 里 | 独立 `data/repeats.json` ✅ |
|---|---|---|
| 模板存放 | 需要一条「模板 memo」，它必须有 status，会进列表/统计/逾期 | 规则不进 `memos.json`，零污染 |
| `memos.json` 版本 | 必须 v3 → v4 迁移，5 条存量数据要过迁移脚本 | **保持 version 3 不动**，存量数据零风险 |
| sanitize 影响面 | 要给 memo 加 12 个嵌套字段的白名单 + 校验 | 只需给 memo 加 2 个标量字段 |
| 生命周期 | 规则停用要不要连带实例？语义纠缠 | 两个文件，两条 CRUD 线，各自独立 |
| 读写频率 | 每次列表返回都带上完整规则，增大 payload | 规则单独一次 `GET /api/repeats`（<20 条） |
| 已有先例 | — | `notes.json` / `settings.json` 已有同模式（`store.mjs:229/239`），照抄即可 |

> 唯一代价：多一个写入队列（`persistRepeats`），照抄 `persistNotes()` 5 行代码。

### 1.2 `RepeatRule`（`data/repeats.json`）

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T01:12:00.000Z",
  "repeats": [ /* RepeatRule[] */ ]
}
```

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | string(≤64) | ✔ | `randomUUID().slice(0,12)` | 前缀 `rp_` 便于肉眼区分 memo id |
| `title` | string(≤200) | ✔ | — | 同 memo.title |
| `type` | enum | | `'日常'` | `TYPES` 五选一（复用 `store.mjs:TYPES`） |
| `priority` | enum | | `'P2'` | `P0..P3` |
| `tags` | string[]≤8 | | `[]` | 复用 `tagsOf()` |
| `note` | string(≤4000) | | `''` | |
| `freq` | `'daily' \| 'weekly'` | ✔ | `'daily'` | **只有两种** |
| `weekday` | `1..7 \| null` | freq=weekly 时必填 | `null` | **1=周一 … 7=周日**（ISO）。`freq='daily'` 时强制 `null` |
| `dueTime` | `'HH:mm' \| null` | | `'18:00'` | 每天几点截止。`null` = 该天实例无 `dueAt` |
| `reminderLead` | `0..720 \| null` | | `30` | **提前多少分钟提醒**。`null` = 不提醒 |
| `enabled` | boolean | | `true` | false = 停止生成（不动已有实例） |
| `startDate` | `'YYYY-MM-DD'` | ✔ 内部 | 创建时的本地日期 | **不给 UI**。防止时钟回拨/首次运行批量回溯生成 |
| `createdAt` / `updatedAt` | ISO string | | | |
| `deletedAt` | ISO \| null | | `null` | 软删规则（默认列表隐藏） |

**明确不做**（避免 scope 蔓延）：多选星期几、双周/每月、跳过节假日、结束日期、例外日期、结束后自动清理。

### 1.3 实例字段（在 `Memo` 上追加，共 2 个）

| 字段 | 类型 | 说明 |
|---|---|---|
| `repeatId` | `string \| null` | 反向引用规则 id。`null` = 普通事项 |
| `repeatDate` | `'YYYY-MM-DD' \| null` | 该实例归属的**本地日期**（不是 `dueAt` 的日期——`dueAt` 可能被用户「仅本次」改掉） |

> 为什么不存 `repeatLabel`：标签文案由 `repeatId` 查规则得到；规则被硬删时降级显示「重复」（见 §2.5），不冗余存储，避免规则改名后实例文案不一致。

### 1.4 `sanitize()` 改动（`server/store.mjs`）

在 return 对象里追加 2 行（**纯追加，不改任何现有字段**）：

```js
// 追加在 deletedAt 之后
repeatId: str(src.repeatId ?? fallback.repeatId, 64) || null,
repeatDate: /^\d{4}-\d{2}-\d{2}$/.test(String(src.repeatDate ?? fallback.repeatDate ?? ''))
  ? String(src.repeatDate ?? fallback.repeatDate)
  : null
```

**旧数据无损性验证：**

| 场景 | 行为 |
|---|---|
| 5 条存量记录（无这两个字段） | `src.repeatId === undefined` → `?? fallback` → `undefined` → `str()` 返回 `''` → `null`。**读取时值为 null，不抛错、不丢字段** |
| 首次 `persist()` 回写 | JSON 里会多出 `"repeatId": null, "repeatDate": null` 两行。**纯增量，旧版本代码忽略未知字段也能读** |
| `store.update()` 现有链路 | `merged = {...current, ...clean}` 已携带 current 的值，`sanitize(merged, current)` 能保住，无需额外处理 |

**必须加的保护（防止客户端伪造，破坏幂等）：**

```js
// store.create() 内
const payload2 = meta.system ? payload : { ...payload, repeatId: null, repeatDate: null }

// store.update() 内，紧跟 delete clean.reason 之后
if (!meta.system) { delete clean.repeatId; delete clean.repeatDate }
```

**`importMemos()` 不走保护**（`sanitize(m, {})` 直接透传），导出→导入能完整带回 `repeatId/repeatDate`，换机器后实例与规则仍然对得上（前提是同时导入 `repeats`，见 §3.6）。

### 1.5 幂等键

| 项 | 值 |
|---|---|
| 键字符串 | `` `${repeatId}@${repeatDate}` ``，例：`rp_a1b2c3@2026-11-25` |
| 索引形态 | **内存 `Set`，每次 ensure 现建，不常驻** |
| 索引覆盖范围 | `store.list()` **全量**，包含 `deletedAt / archived / done` 的实例 |
| 为什么含已删除 | 用户删掉今天这条 = 「今天不要了」，删完若再生成一次会像幽灵。含已删除即天然抑制 |
| 为什么不用常驻 Map | 常驻需要 5 处 mutation（create/createMany/update/remove/import）都打补丁，漏一处就漂移；现建是 O(n)，n≈几百，一次 ensure 现建 <1ms |
| 为什么不是"扫描比对"逐条 | 现建 Set 是 O(n) 一次，逐条 `find()` 是 O(n²)，规则数×实例数增长后会卡 |

**O(1) 快速路径（性能兜底）：** `store._repeatStamp` 记住"今天已经 ensure 过"。`scheduler` 每 20s 调一次 ensure，99.9% 的调用在第 2 行就返回，不建 Set。

---

## 2. 生成算法

### 2.1 核心伪代码（`server/repeat.mjs` + `server/store.mjs:ensureToday`）

```js
// ── server/repeat.mjs ──────────────────────────────────────────
export const FREQS = ['daily', 'weekly']
export const WEEKDAYS = [
  { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
  { value: 4, label: '周四' }, { value: 5, label: '周五' }, { value: 6, label: '周六' },
  { value: 7, label: '周日' }
]

// 本地日期键。绝不用 toISOString().slice(0,10)（那是 UTC，UTC+8 早 8 点前会算成前一天）
export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// JS getDay(): 0=周日 → 转 ISO 1..7
export const isoWeekday = (d = new Date()) => d.getDay() || 7

export function hitsOn(rule, d = new Date()) {
  if (rule.freq === 'daily') return true
  if (rule.freq === 'weekly') return isoWeekday(d) === rule.weekday
  return false
}

export const repeatKey = (repeatId, dateKey) => `${repeatId}@${dateKey}`

// 由规则 + 日期推出实例的业务字段（buildInstance 与 applyToToday 共用）
export function instanceFields(rule, dateKey) {
  const [y, m, dd] = dateKey.split('-').map(Number)
  let dueAt = null, reminderAt = null, reminderFiredAt = null

  if (rule.dueTime) {
    const [hh, mm] = rule.dueTime.split(':').map(Number)
    const base = new Date(y, m - 1, dd, hh, mm, 0, 0)       // 本地时间构造
    dueAt = base.toISOString()
    if (rule.reminderLead !== null) {
      const rt = new Date(base.getTime() - rule.reminderLead * 60000)
      reminderAt = rt.toISOString()
      // 错过不补：若提醒时刻已过，直接把 reminderFiredAt 钉成同一时刻，
      // 让 scheduler 的 `firedAt >= due` 判断跳过，不会在打开页面时突然弹窗
      if (rt.getTime() <= Date.now()) reminderFiredAt = reminderAt
    }
  }
  return {
    title: rule.title, type: rule.type, priority: rule.priority,
    tags: rule.tags, note: rule.note,
    dueAt, reminderAt, reminderFiredAt,
    status: 'open', isDoing: false
  }
}

export function buildInstance(rule, dateKey) {
  return { ...instanceFields(rule, dateKey), repeatId: rule.id, repeatDate: dateKey }
}

// ── server/store.mjs ───────────────────────────────────────────
async ensureToday(now = new Date()) {
  if (this._ensurePromise) return this._ensurePromise          // 重入锁
  const p = this._ensure(now)
  this._ensurePromise = p
  p.finally(() => { if (this._ensurePromise === p) this._ensurePromise = null })
  return p
}

async _ensure(now) {
  const today = localDateKey(now)

  // (1) 快路径
  if (this._repeatStamp === today) return []

  // (2) 取有效规则
  const rules = this.repeats.filter((r) => r.enabled && !r.deletedAt)
  if (!rules.length) { this._repeatStamp = today; return [] }

  // (3) 建幂等索引（含已删除/已归档/已完成）
  const taken = new Set()
  for (const m of this.memos) {
    if (m.repeatId && m.repeatDate) taken.add(repeatKey(m.repeatId, m.repeatDate))
  }

  // (4) 逐条规则判定
  const batch = []
  for (const rule of rules) {
    if (today < rule.startDate) continue                        // 不回溯到创建日之前
    if (!hitsOn(rule, now)) continue                           // 每日 / 每周单日
    if (taken.has(repeatKey(rule.id, today))) continue          // 幂等
    batch.push(buildInstance(rule, today))
  }

  // (5) 一次批量落盘。stamp 必须在 persist 成功之后再写：
  //     失败（磁盘满/权限）时下次 tick 会自动重试，不会「今天彻底不再生成」
  if (!batch.length) { this._repeatStamp = today; return [] }
  const created = await this.createMany(batch, { actor: 'system' })
  this._repeatStamp = today
  return created
}

// 批量创建：一次 persist，不写 history（见 §0.1-F5）
async createMany(payloads, meta = {}) {
  const made = []
  for (const raw of payloads) {
    const memo = sanitize(raw, {})                             // createMany 视为 system 路径
    if (!memo.title) continue
    made.push(memo)
  }
  if (!made.length) return []
  this.memos.unshift(...made)
  await this.persist()                                         // 只有 1 次原子写 + 1 次快照
  return made
}

// 规则被 CRUD 后必须失效 stamp，否则当天新建的规则不会立即生成
invalidateRepeatStamp() { this._repeatStamp = null }
```

### 2.2 生成触发点（6 处，全部服务端，**不暴露给前端**）

| 触发点 | 位置 | 备注 |
|---|---|---|
| ① 服务启动 | `server/index.mjs` after `store.ready` | 网页模式冷启动即可见今日实例 |
| ② 桌面端启动 | `desktop/main.mjs` after `store.ready`（**仅 `ownsServer` 时**） | 见 R1 |
| ③ `scheduler.tick()` | `server/scheduler.mjs` `tick()` 最开头 | **放在 `notifyEnabled` / 静默时段判断之前**——生成与是否弹窗无关 |
| ④ `GET /api/memos` | `server/app.mjs` handler 开头 | 主路径 |
| ⑤ `GET /api/focus` | 同上，`buildFocus` 之前 | 焦点窗靠 30s 轮询自动拿新数据 |
| ⑥ `POST /api/repeats` | 创建规则后立刻 ensure | 让用户"建完就能看到今天这条" |

`scheduler` 改动最小形态：

```js
async function tick() {
  if (running) return
  running = true
  try {
    await store.ensureToday().catch((e) => logger.warn('[scheduler] 生成实例失败:', e.message)) // ← 新增，置顶
    const settings = store.getSettings()
    if (!settings.notifyEnabled) return
    /* …以下不动… */
```

### 2.3 时区规则（硬约束）

| 规则 | 做法 |
|---|---|
| 日期键 | `localDateKey()` 用 `getFullYear/getMonth/getDate` 拼字符串 |
| 时间点构造 | `new Date(y, m-1, d, hh, mm)` 本地构造，再 `.toISOString()` 存 UTC |
| **禁止** | `toISOString().slice(0,10)`（现 `store.mjs:249` 备份文件名、`app.mjs:200` 导出文件名都这么写，UTC+8 早 8 点前会算成前一天——**既有小瑕疵，重复功能不要照抄**） |
| 夏令时 | 中国无夏令时；对 DST 地区，`new Date(y,m-1,d,hh,mm)` 由运行时按本地规则解析，不缺不重。因"错过不补"，即使出现 23:00/01:00 边界也不会回溯 |

### 2.4 规则状态变化时，已生成实例怎么办

| 规则操作 | 今天的实例 | 未来 | 说明 |
|---|---|---|---|
| `enabled: false`（停用） | **保留原样** | 不再生成 | 用户若想清掉，手动完成/归档/删除。不做级联删除——用户可能已完成今天这条，删了会丢历史 |
| `deletedAt`（软删规则） | **保留原样** | 不再生成 | 规则列表默认隐藏；已生成实例仍显示「每日」标签（规则还在文件里可查到） |
| **硬删规则** `?hard=1` | **保留原样** | 不再生成 | `repeatId` 变成悬空引用 → 前端降级显示「重复」（§2.5）。**不提供级联删除实例的选项** |
| `PATCH` 规则（改标题/优先级） | **不改**（除非走 `/apply`） | 从明天起生效 | 与用户决策 2 一致：默认仅本次 |
| `POST /apply`（改系列） | **同步覆盖**（见 §3.4） | 明天起生效 | 用户显式选择 |

### 2.5 悬空引用的降级

```js
// src/lib/repeat.js
export function repeatLabel(repeat, dateKey) {
  if (repeat) return repeat.freq === 'daily' ? '每日'
    : `每${WEEKDAYS.find(w => w.value === repeat.weekday)?.label || '周'}`
  return '重复'        // 规则已硬删，只剩 repeatId
}
```

不为此新增字段，也不做数据修复脚本（规则被硬删属于罕见操作，文案降级足够）。

---

## 3. 接口变更

### 3.1 设计决策：独立资源 `/api/repeats`

**不复用 `POST /api/memos` 加 `repeat` 字段**，理由：

1. `POST /api/memos` 的语义是"建一条事项"，规则不是事项，硬塞会让 `sanitize` 出现分叉（是实例？还是模板？）。
2. `PATCH /api/memos/:id` 的语义是"立刻改这条"，而 `PATCH /api/repeats/:id` 的语义是"改未来"，两者语义相反，同一个路由会误导工程师写出默认回溯的 bug。
3. 规则需要独立的"启停"与"软删"操作，塞进 memo 会让 `status` 枚举再长出第四种值——违背「跳过复用 archived，不新增第四种状态」的决策。

### 3.2 端点总表

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/api/repeats` | —（`?includeDeleted=1` 可选） | `{ repeats: RepeatRule[] }` | 默认过滤 `deletedAt` |
| POST | `/api/repeats` | `RepeatRule` 字段（无 id） | `201 { repeat, memo \| null }` | 建规则成功后**立刻 ensure 该规则**，`memo` 是今天刚落地的实例（今天不命中时为 null，如今天是周二而规则是每周三） |
| PATCH | `/api/repeats/:id` | `Partial<RepeatRule>` + `reason?` | `{ repeat }` | 只改规则，**不动今天已生成的实例** |
| POST | `/api/repeats/:id/apply` | `Partial<RepeatRule>` + `reason?` | `{ repeat, memo \| null }` | **改系列**：改规则 + 同步覆盖今天那条 open 实例 |
| DELETE | `/api/repeats/:id` | `reason?` | `{ ok }` | 默认软删；`?hard=1` 物理删 |
| GET | `/api/memos` | — | `{ memos }`（不变） | **行为增强**：返回前先 `await store.ensureToday()` |
| GET | `/api/focus` | — | 不变（`items` 里天然带 `repeatId/repeatDate`） | 同上 + 配额限制（§3.5） |
| POST | `/api/memos/:id/skip` | `{ reason? }` | `Memo` | **跳过本次**：`status='archived'` + `archivedAt=now` + history `action='skip'` |
| GET | `/api/health` | — | 增加 `repeats: number`、`freqs: string[]`、`weekdays: {value,label}[]` | 前端枚举不硬编码，沿用现有 `types/priorities/statuses` 惯例 |
| GET | `/api/export` | — | `version: 4`，增加 `repeats: RepeatRule[]`（含软删的） | 不带规则 = 换机器后规则全丢 |
| POST | `/api/import` | 增加 `repeats?: RepeatRule[]` | `{ ok, count, total, repeatCount }` | merge 按 `id` 去重 |

### 3.3 关键实现要点

```js
// server/app.mjs
const repeatSingle = /^\/api\/repeats\/([A-Za-z0-9_-]{1,64})$/.exec(p)
const repeatApply  = /^\/api\/repeats\/([A-Za-z0-9_-]{1,64})\/apply$/.exec(p)
const skipMatch    = /^\/api\/memos\/([A-Za-z0-9-]{1,64})\/skip$/.exec(p)
```
注意路由顺序：`skip` 必须放在现有 `memoSub` 正则（`restore|archive|history|attachments`）之外，或用独立正则先行匹配，避免被 `memoSingle` 的 `$/` 规则漏掉。

`store` 侧新增 4 个方法，保持 `app.mjs` 只做转发：

| 方法 | 行为 |
|---|---|
| `skipRepeat(id, meta)` | 校验 `memo.repeatId` 存在（否则 400「该事项不是重复事项」）→ 调 `update(id, {status:'archived'}, {action:'skip', reason})` |
| `applyRepeatToToday(id, patch, meta)` | 见 §3.4 |
| `listRepeats({includeDeleted})` / `createRepeat` / `updateRepeat` / `removeRepeat` | 规则 CRUD，每次成功后 `invalidateRepeatStamp()` |

`store.update` 需支持 `meta.action` 覆盖自动推断（一行）：

```js
// 现状：
let action = 'update'
if (statusChange && changes.length === 1) { ... }
// 改为：
let action = meta.action || 'update'
if (!meta.action && statusChange && changes.length === 1) { ... }
```
> 不改 `history.mjs` 的 `TRACKED_FIELDS`：`repeatId/repeatDate` 是元数据不是业务变更，记进 diff 只会让变更记录变噪音。动作类型用 `action: 'skip' | 'repeat-apply' | 'repeat-create'` 表达即可（`action` 无枚举约束）。

### 3.4 「改系列」精确语义

```js
async applyRepeatToToday(id, patch, meta = {}) {
  const rule = await this.updateRepeat(id, patch, meta)        // 1. 规则先落盘
  this.invalidateRepeatStamp()

  const today = localDateKey(new Date())
  const inst = this.memos.find((m) => m.repeatId === id && m.repeatDate === today)
  if (!inst) return { repeat: rule, memo: null }
  if (inst.deletedAt || inst.status !== 'open') return { repeat: rule, memo: inst }  // 已结案，尊重

  // 2. 用新规则重算展示字段（含 dueAt / reminderAt）
  const fields = instanceFields(rule, today)
  // reminderAt 变化时，store.update 内置逻辑会自动清空 reminderFiredAt（store.mjs:301-308）
  const memo = await this.update(inst.id,
    { title: fields.title, type: fields.type, priority: fields.priority,
      tags: fields.tags, note: fields.note,
      dueAt: fields.dueAt, reminderAt: fields.reminderAt },
    { actor: meta.actor || 'web', reason: meta.reason || '同步修改重复系列', action: 'repeat-apply' })
  return { repeat: rule, memo }
}
```

**已知取舍**：若用户先「仅本次」把今天这条的截止时间改成 20:00，再「改系列」改了备注，`dueAt` 会被重算回 18:00（被覆盖）。这是"以系列设置为准"的必然结果，必须在弹窗文案里明确写出来（§4.3）。

### 3.5 `buildFocus` 的 2 个名额配额

改 `server/app.mjs:buildFocus`。**配额对所有重复项（每日 + 每周）统一生效**，按 `repeatId != null` 判定：

```js
const MAX_REPEAT = 2
const picked = []
let repeatQuota = MAX_REPEAT
let seen = new Set()

for (const memo of [...overdue, ...dueToday, ...key, ...rest]) {   // 排序后的完整候选池
  if (picked.length >= 6) break
  if (seen.has(memo.id)) continue
  if (memo.repeatId) {
    if (repeatQuota <= 0) continue      // 硬上限，不因"凑不够 3 条"而放宽
    repeatQuota--
  }
  seen.add(memo.id)
  picked.push(memo)
}
```

**为什么硬上限不放宽**：现有逻辑「不足 3 条从剩余补齐」（`app.mjs:88-96`），若把配额做成"不足则放宽"，一旦用户有 5 条每日事项就永远凑满 5 条，等于没做配额。宁可焦点窗只显示 2 条也要守住这份可读性。

顺带把现有"补齐不足 3 条"的那段（`picked.length < 3` 分支）折叠进同一个循环，避免两套逻辑互相打架。

### 3.6 导入导出

```js
// GET /api/export
{ version: 4, exportedAt, memos, notes, settings,
  repeats: store.listRepeats({ includeDeleted: true }),   // ← 新增
  history }
```
```js
// POST /api/import
if (Array.isArray(body.repeats)) await store.importRepeats(body.repeats, mode)
```
`importRepeats` 照抄 `importMemos`（`store.mjs:402`）的结构：`sanitizeRepeat` 白名单 → merge 按 id 覆盖 / replace 全量替换 → 一次 `persistRepeats()`。

---

## 4. 前端改动清单（逐文件）

### 4.1 新增文件

| 文件 | 内容 | 要点 |
|---|---|---|
| `src/lib/repeat.js` | `FREQS`、`WEEKDAYS(1-7)`、`repeatLabel(repeat,dateKey)`、`repeatSummary(repeat)`（"每日 18:00 · 提前 30 分钟"）、`nextOccurrence(rule, from)`（推"下次：明天 09:00"，纯展示） | 枚举值与服务端镜像（沿用现有 `TYPES` 在 `store.mjs` 和 `format.js` 各写一份的先例）；运行时优先用 `/api/health` 下发的 `weekdays` |
| `src/components/RepeatBadge.jsx` | `<span className="meta-repeat"><Icon name="repeat"/>{label}</span>` | 列表行与抽屉共用，一个组件两处引用，避免文案不一致 |
| `src/components/RepeatDialog.jsx` | 规则表单弹层（新建 / 编辑 / 改系列 三模式） | 见 §4.3 |

### 4.2 逐文件改动

| 文件 | 改什么 | 细节 |
|---|---|---|
| `src/lib/api.js` | 追加 6 个方法 | `listRepeats()`、`createRepeat(p)`、`updateRepeat(id,p)`、`applyRepeat(id,p)`、`removeRepeat(id)`、`skipRepeat(id,reason)` → `POST /api/memos/:id/skip` |
| `src/hooks/useMemos.js` | ① 新增 `createMany` 合流（服务端一次可能返回多条，但接口是 GET 拉取，无需）② **跨天检测** | 加 `useEffect`：`setInterval(60_000)` 比较 `localDateKey(new Date())` 与 `dayKeyRef.current`，变化则 `reload()` 并 `onCrossDay?.()` 回调（由 App 弹 toast）。这是"跨天时用户正开着页面"的唯一补丁 |
| `src/components/Icon.jsx` | 加 `repeat` 图形 | `<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>`（顺时针循环箭头） |
| `src/components/MemoList.jsx` | ① 行内标识 ② 跳过按钮 | 标识插在 `memo-type` 之后：`{memo.repeatId && <RepeatBadge repeat={rulesById[memo.repeatId]} dateKey={memo.repeatDate} />}`。跳过按钮放 `.memo-actions` 里，**仅 `memo.repeatId && status==='open' && !isTrash`** 时出现，图标用现有 `archive`（避免新增图标），`title="跳过本次（今日不再提醒）"`，点击 → `onSkip(memo)` → App 走轻确认。传参需新增 `rulesById`、`onSkip` |
| `src/components/MemoDrawer.jsx` | ① 重复区块 ② 改系列入口 ③ 跳过 ④ 仅本次提示 | 插在"截止时间"字段之后、独立的 `.field`：<br>• `memo.repeatId` 有值 → 只读摘要「循环 · 每周三 18:00 · 提前 30 分钟」+ 两个按钮 `[改整个系列…]` `[跳过本次]`<br>• 上方加一条 `field-hint`：「当前编辑仅影响今天这一条」（这是防止误操作的核心提示）<br>• 无 `repeatId` → 不显示该区块（新建入口在 QuickAdd 旁，见 §4.3）<br>新增 props：`repeat`、`onApplySeries`、`onSkip` |
| `src/App.jsx` | ① 加载规则 ② 传参 ③ 两个 handler | `const [repeats, setRepeats] = useState([])` + `useEffect(() => api.listRepeats().then(setRepeats))`；`rulesById = useMemo(Map)`；`handleSkip(memo)` = `askConfirm({title:'跳过今天这次？', body:'…明天照常出现', detail:'不会计入完成率分母'})` → `api.skipRepeat` → `reload()`；`handleApplySeries(rule, patch)` = `askConfirm` → `api.applyRepeat` → `reload()` + `refreshRepeats()`；`handleCrossDay` = `notify('已进入新的一天，列表已更新')` |
| `src/focus.jsx` | 重复标识 | `.fx-meta` 里加 `{memo.repeatId && <span className="fx-repeat"><Icon name="repeat" size={10}/>{label}</span>}`。配额是服务端算的，前端**只按返回顺序渲染，不再二次截断**（否则两处逻辑必有一处先错）。`label` 由 `memo.repeatId` + 本地规则表得；焦点窗不加载规则表 → **改用服务端下发**：`buildFocus` 给每个 item 附 `repeatLabel` 字符串（更省事，见下） |
| `src/components/StatsBar.jsx` | 归档卡片 sub 显示跳过数 | `{ key:'archived', label:'归档', value: stats.archived, sub: stats.skipped ? `含跳过 ${stats.skipped}` : undefined }` |
| `src/lib/filters.js` | `computeStats` 加 1 个字段 | `skipped: archived.filter(m => m.repeatId).length`。**`rate` 分母不用改**——`settled = open + done`，archived 已被天然排除，「跳过不计入分母」免费满足（这条要在验收里显式测一遍，别以为是改了才生效） |
| `src/styles.css` | 4 组样式 | `.meta-repeat`（小号、淡色、`display:inline-flex;gap:2px`）、`.repeat-panel`、`.repeat-badge`、`.fx-repeat`；深色模式跟随现有 `[data-theme="dark"]` 变量，不要硬编码颜色 |
| `src/components/Sidebar.jsx` | 不改 | 不新增「重复事项」视图（产品未要求，避免 scope） |
| `README.md` | 补一节 | 重复规则说明 + 数据落在 `data/repeats.json` + **`data/` 已被 `.gitignore` 排除，换机器必须走导出/导入** |

> `src/components/QuickAdd.jsx` 旁新增一个「+ 重复」小按钮作为**规则新建入口**（或放在 `FilterBar` 右端），点击打开 `RepeatDialog` 新建模式。`QuickAdd` 本身不改逻辑，只在 `App.jsx` 里并排渲染一个按钮。

### 4.3 「改系列」vs「仅本次」的区分方式（防误操作，三道闸）

| 闸 | 位置 | 设计 |
|---|---|---|
| 闸 1 · 提示 | 抽屉重复区块顶部 | 常驻 `field-hint`：「本页所有修改仅影响**今天这一条**」 |
| 闸 2 · 文案 | 按钮 | `改整个系列…`（带省略号，暗示会弹窗）；不用 `编辑规则` 这种模糊词 |
| 闸 3 · 二次确认 | `ConfirmDialog` | 标题「修改整个重复系列？」<br>正文「会同时修改**今天未完成**的这一条，明天起的实例按新设置生成。」<br>detail「已完成的、已跳过的不受影响；今天这条若被单独改过，会被系列设置覆盖。」<br>confirmText「改整个系列」 |

`RepeatDialog` 三种模式：

| 模式 | 打开入口 | 提交动作 | 星期控件 |
|---|---|---|---|
| `create` | QuickAdd 旁「+ 重复」 | `api.createRepeat` | 频率单选（每日/每周）→ 选"每周"才展开**星期几单选（7 个 chip，只能选 1 个）** |
| `edit` | （可选）规则列表，P2 不做 UI | `api.updateRepeat` | 同上 |
| `apply` | 抽屉「改整个系列…」 | `api.applyRepeat` | 同上，预填当前规则 |

**星期控件必须单选**——用 `segmented`（复用现有 `.segmented` 样式）+ `value={form.weekday}`，点击即替换而非切换数组。技术上**不要**用 `Set`/`Array` 存，避免日后被误解为多选。

### 4.4 焦点窗的 2 名额配额——实现位置收敛

只在 `server/app.mjs:buildFocus` 实现（§3.5）。`focus.jsx` 不做任何截断。

同时 `buildFocus` 给 `items[]` 每项附加一个派生字段 `repeatLabel: string | null`（由服务端查规则生成），避免焦点窗页面为了显示「每日」而去多拉一次 `/api/repeats`。这是「计算放服务端、渲染放客户端」的边界。

### 4.5 统计口径调整点（一览）

| 口径 | 现状 | 需要改吗 | 说明 |
|---|---|---|---|
| 完成率分母 | `open + done` | **不改** | archived（= 跳过）已天然排除 |
| 逾期 | `isOverdue()` 要求 `status==='open'` | **不改** | 跳过项不计逾期 ✅ |
| 今日到期 | `dueAt && isToday` | **不改** | 重复实例有 `dueAt` 即计入 |
| 归档卡片 | 只显示总数 | 改 | sub 加「含跳过 n」 |
| 焦点窗 | 逾期+今日+P0/P1+isDoing 混合 | 改 | 重复项硬上限 2 |
| 列表「今天」视图 | 需要 `dueAt` | **注意** | 规则 `dueTime` 清空 → 实例无 `dueAt` → 只在「全部/无截止」出现，不在「今天」出现。表单默认 `18:00` 并标注这一点 |

---

## 5. 任务分解（给工程师）

> 5 个任务，按依赖有序。每个任务内的文件改动可以一次性提交。

### T01 · 服务端规则层与生成引擎（P0，无依赖）

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/repeat.mjs`（新增）<br>`server/store.mjs`（改）<br>`server/scheduler.mjs`（改）<br>`server/index.mjs`（改）<br>`desktop/main.mjs`（改） |
| 依赖 | 无 |
| 具体做 | ① 新建 `server/repeat.mjs`：`FREQS`/`WEEKDAYS`/`localDateKey`/`isoWeekday`/`hitsOn`/`instanceFields`/`buildInstance`/`repeatKey`/`sanitizeRepeat`/`repeatLabel`<br>② `store.mjs`：加 `this.repeatsFile`、`this.repeats`、`persistRepeats()`、`init()` 里读 `repeats.json`、`sanitize()` 追加 2 字段、`create/update` 里 strip 客户端伪造的 repeat 字段、`createMany()`、`ensureToday()/_ensure()`、`invalidateRepeatStamp()`、`skipRepeat()`、`applyRepeatToToday()`、规则 CRUD 五连、`update()` 支持 `meta.action`<br>③ `scheduler.mjs`：`tick()` 首行 `await store.ensureToday()`<br>④ `index.mjs`：`store.ready` 后 `await store.ensureToday()`<br>⑤ `desktop/main.mjs`：`if (ownsServer) { await store.ensureToday(); scheduler.start() }` |
| 验收要点 | 1. 5 条存量数据启动后仍能正常读写，`memos.json` 只多出 `repeatId:null, repeatDate:null`<br>2. 手写一条 `daily` 规则 → 重启 → `memos.json` 出现 1 条实例；**再重启一次不出现第 2 条**<br>3. 连续调 `ensureToday()` 100 次（含并发不 await）→ 实例数恒为 1（验证重入锁 + 幂等）<br>4. 删掉实例后重启 → **不再生成**<br>5. `weekly` + `weekday=今天` 生成；`weekday=明天` 不生成<br>6. 跨天模拟（传 `now = 明天`）→ 生成第 2 条，两条并存<br>7. `history.jsonl` 行数**不变**（验证 createMany 不写历史）<br>8. 端口占用场景：先 `npm start`，再 `npm run desktop` → 托盘仍工作，但**只有一份 scheduler**（日志只出现一次「已启动，扫描间隔 20s」） |

### T02 · HTTP 接口层与前后端契约（P0，依赖 T01）

| 项 | 内容 |
|---|---|
| 涉及文件 | `server/app.mjs`（改）<br>`desktop/main.mjs`（若 T01 未改完则补）<br>`src/lib/api.js`（改）<br>`src/lib/repeat.js`（新增） |
| 依赖 | T01（store 方法就位） |
| 具体做 | ① `app.mjs`：`/api/repeats` GET/POST、`/api/repeats/:id` PATCH/DELETE、`/api/repeats/:id/apply`、`/api/memos/:id/skip`；`GET /api/memos` 与 `GET /api/focus` 开头 ensure；`buildFocus` 加 2 名额配额 + `items[].repeatLabel`；`/api/health` 加 `repeats/freqs/weekdays`；`/api/export` version→4 + `repeats`；`/api/import` 支持 `repeats`<br>② `src/lib/api.js`：6 个新方法<br>③ `src/lib/repeat.js`：前端枚举与文案（值与服务端镜像） |
| 验收要点 | 1. `curl /api/repeats` 返回 `{repeats:[]}`<br>2. `POST /api/repeats` 带 `{freq:'weekly', weekday:99}` → **400**（越界校验）<br>3. `POST /api/repeats` 今天命中 → 响应含 `memo`；再 `GET /api/memos` 不重复<br>4. `PATCH /api/repeats/:id` 改标题 → `GET /api/memos` 里**今天这条标题不变**<br>5. `POST /api/repeats/:id/apply` 改标题 → 今天这条**变了**，且 `history` 出现 `action:'repeat-apply'`<br>6. `POST /api/memos/:id/skip` → 该条 `status:'archived'`、`archivedAt` 有值、`history` 出现 `action:'skip'`；`GET /api/focus` 不再包含它<br>7. 普通事项调 skip → **400**<br>8. 造 4 条每日 + 1 条普通，`GET /api/focus` → 重复项 ≤ 2<br>9. `GET /api/export` 含 `repeats` 且 `version===4`；导入回来规则与实例 `repeatId` 对得上<br>10. `PATCH /api/memos/:id` body 里塞 `repeatId:'fake'` → 被忽略（幂等不被破坏） |

### T03 · 前端状态层（P1，仅需契约，可与 T01/T02 并行开发，联调需 T02）

| 项 | 内容 |
|---|---|
| 涉及文件 | `src/hooks/useMemos.js`（改）<br>`src/lib/filters.js`（改）<br>`src/App.jsx`（改） |
| 依赖 | 契约见 §3；联调依赖 T02 |
| 具体做 | ① `useMemos`：跨天检测（60s 比对 `localDateKey`，变化则 `reload()` + `onCrossDay` 回调）<br>② `filters.computeStats`：加 `skipped`<br>③ `App.jsx`：`repeats` state + 加载、`rulesById` memo、`handleSkip`、`handleApplySeries`、`handleOpenRepeatDialog`、`handleCrossDay`、把 `rulesById/onSkip/repeat/onApplySeries` 传给 `MemoList`/`MemoDrawer` |
| 验收要点 | 1. 把系统时间调到 23:59 等待跨天（或临时把轮询改 3s）→ 1 分钟内列表自动刷新并弹一次提示<br>2. `computeStats` 单元自测：3 open + 2 done + 2 archived(其中 1 条有 repeatId) → `rate=40%`、`skipped=1`、`total=7`<br>3. 抽屉打开着跨天 → 抽屉内容**不被清空**（form 只依赖 `memo.id`），列表已刷新<br>4. `handleSkip` 取消时**不发请求** |

### T04 · 前端 UI 组件（P1，依赖 T03 的 props 契约）

| 项 | 内容 |
|---|---|
| 涉及文件 | `src/components/RepeatDialog.jsx`（新增）<br>`src/components/RepeatBadge.jsx`（新增）<br>`src/components/MemoDrawer.jsx`（改）<br>`src/components/MemoList.jsx`（改）<br>`src/components/Icon.jsx`（改）<br>`src/styles.css`（改） |
| 依赖 | T03 |
| 具体做 | ① `RepeatBadge`：循环图标 + 「每日」/「每周三」/「重复」降级<br>② `RepeatDialog`：create/edit/apply 三模式；频率单选 → 每周才展开**星期几单选 7 chip**；`dueTime` 默认 `18:00` 可清空；`reminderLead` 选填（0/10/30/60/自定义）<br>③ `MemoDrawer`：重复区块 + 「本页仅影响今天这一条」提示 + `[改整个系列…]` `[跳过本次]`<br>④ `MemoList`：行内 `RepeatBadge` + hover 出现「跳过本次」<br>⑤ `Icon`：`repeat` 图形<br>⑥ `styles.css`：4 组样式 + 深浅色 |
| 验收要点 | 1. 星期几**只能选中 1 个**（连点周三再点周五 → 只有周五高亮），提交 payload 里 `weekday` 是 number 不是数组<br>2. 选"每日"时 `weekday` 提交为 `null`<br>3. 列表里 5 条普通 + 1 条重复 → 只有重复那条有循环图标和「每日」<br>4. 抽屉里改标题 → 只有今天这条变；点「改整个系列…」→ 弹确认 → 确认后今天这条也变<br>5. 跳过 → 行从「未完成」组移到「归档」组（`groupMemos` 现成逻辑）<br>6. 深色模式下新样式无白底/黑字瞎眼<br>7. 键盘可达：`RepeatBadge` 不需要焦点；`[改整个系列…]` 可 Tab 到并 Enter 触发 |

### T05 · 焦点窗、统计展示与全链路收尾（P2，依赖 T02 + T04）

| 项 | 内容 |
|---|---|
| 涉及文件 | `src/focus.jsx`（改）<br>`src/components/StatsBar.jsx`（改）<br>`README.md`（改） |
| 依赖 | T02、T04 |
| 具体做 | ① `focus.jsx`：`.fx-meta` 显示 `memo.repeatLabel`（服务端下发）；**不做前端截断**<br>② `StatsBar`：归档卡片 sub「含跳过 n」<br>③ `README.md`：功能说明 + 数据文件清单（`memos.json`/`notes.json`/`settings.json`/`repeats.json`）+ `.gitignore` 排除 `data/` 的提醒 + 「换机器请用导出/导入」<br>④ 端到端冒烟（见下） |
| 验收要点 | 1. 焦点窗：4 条每日 + 2 条普通 P0 → 只显示 2 条每日 + 2 条普通（共 4 条，不是 6 条挤满每日）<br>2. 焦点窗点完成一条每日 → 该行消失，明天才有新的<br>3. 焦点窗里每日事项带循环图标<br>4. 端到端：建「每日 09:00 截止、提前 10 分钟提醒」→ 生成 → 弹出提醒（把提醒时间改到 1 分钟后验证）→ 点完成 → 次日不再影响今天这条 → 重启不重复<br>5. 导出 → 删 `data/` → 导入 → 规则与实例全部还原，`repeatId` 对应正确 |

---

## 6. 风险与边界（10 条）

| # | 风险 | 触发场景 | 影响 | 处置 |
|---|---|---|---|---|
| **R1** | **双 Store 实例 + 双 scheduler 互相覆写** | `npm start` 已占端口，再 `npm run desktop`（`ownsServer=false`），desktop 仍持有自己的 `new Store()` 和自己的 scheduler | 🔴 两个内存数组各自 `persist()` 全量写 `memos.json` → **丢数据**；双弹窗 | 见 §0.2。`desktop/main.mjs` 改为 `if (ownsServer) { ensureToday(); scheduler.start() }`。T01 必做，**不可跳过** |
| **R2** | 23:59 生成 / 00:01 打开 | 用户在 23:59:59 刷新页面，今天这条刚落地；00:00:10 再刷新 | 列表里同时存在「昨天未完成」+「今天新生成」，看起来像重复 | 属「错过不补」的直接后果，**设计上接受**。生成次日实例时**不做任何自动清理**（不自动归档旧 open 实例——那会隐瞒用户欠的账）。可通过 `repeatDate` 在列表上区分（显示 `11-24 · 每日`） |
| **R3** | 跨天时用户正开着页面 | 页面停留过夜，前端 `memos` 是昨天的快照 | 看不到今天的实例；在抽屉里编辑昨天的条目会写回昨天 | `useMemos` 60s 跨天检测 + `App` 弹一次提示。抽屉不做自动切换（会打断输入），靠 `memo.repeatDate` 在抽屉顶部显示归属日期 |
| **R4** | 同一规则在多个入口同时 ensure | `GET /api/memos` 与 `scheduler.tick()` 在 `await` 点交错 | 生成 2 条同键实例 | ① `_ensurePromise` 重入锁（同进程内完全解决）② 跨进程靠 R1 的修复③ 幂等键兜底（即便真重复，第二次 `taken` 检查也会拦住——但要求两次之间已完成 `persist`，故 `createMany` 先写内存再 `persist` 的顺序不能颠倒到 await 之外） |
| **R5** | 时区 / 夏令时 | 用户机器时区不是 UTC+8；或把系统时区改掉 | 日期错位一天，实例落到错误的 `repeatDate` | 全链路 `localDateKey()` + `new Date(y,m,d,hh,mm)` 本地构造。**禁止 `toISOString().slice(0,10)`**。已有代码 `store.mjs:249`、`app.mjs:200` 的写法不要复用。不存服务器时区、不存 `tz` 字段（本地单机应用，跟着系统走即可） |
| **R6** | 规则被删但今天实例已存在 | 用户删规则 | 实例变悬空，文案降级「重复」 | `taken` 索引含全部实例，不会重生；不做级联删除；`repeatLabel` 降级 |
| **R7** | 导入导出漏带规则 | 只有 `memos` 没有 `repeats` | 换机器后规则全丢，所有历史实例变悬空 | `export` 必带 `repeats` 且 version→4；`import` 接受并 merge。**`data/` 在 `.gitignore` 第 40 行被排除**，规则不进 Git，README 必须写明靠导出备份 |
| **R8** | 历史日志被实例生成淹没 | 走 `store.create()` 生成 | 一年 ~2900 条 `create`，`forMemo`/`recent(5000)` 全是噪音 | `createMany()` **不写 history**（§0.1-F5）。规则维度的变更（建/改/停用/删）正常记 `action: repeat-*` |
| **R9** | 提醒误弹 | 下午 3 点打开页面，规则是"09:00 截止、提前 30 分钟提醒" | 立刻弹一个"8:30 该做了"的提醒 | `instanceFields` 里：生成时若 `reminderAt` 已过，直接把 `reminderFiredAt` 钉成同一时刻，`scheduler` 的 `firedAt >= due` 判断自动跳过。**与「错过不补」一致** |
| **R10** | `dueTime` 清空导致实例不进「今天」视图 | 用户建规则时不填截止时间 | 实例只在「全部/无截止」里出现，用户以为没生成 | 表单 `dueTime` 默认 `18:00` 并在 hint 里写明「清空后不会出现在『今天』视图」。`filterMemos`/`matchView` **不改**（改它会牵连 8 个视图的语义） |
| R11 | 时区切换（旅行）中途改系统时区 | 用户飞机上改时区 | `repeatDate` 可能出现两天相同或跳过一天 | 接受。`localDateKey` 的变化会导致新日期生成一次；旧实例保留。不引入 tz 库（零依赖原则） |

---

## 7. 共享知识（跨文件约定）

### 7.1 命名与字段

| 约定 | 值 |
|---|---|
| 规则 id 前缀 | `rp_` + `randomUUID().slice(0,12)`，例 `rp_9k2mx1ab` |
| 实例反向引用 | `memo.repeatId`（string\|null）、`memo.repeatDate`（`'YYYY-MM-DD'`\|null） |
| 幂等键 | `` `${repeatId}@${repeatDate}` ``（只在服务端内存 Set 里用，不落盘） |
| 频率枚举 | `freq: 'daily' \| 'weekly'` |
| 星期枚举 | `weekday: 1..7`，**1=周一，7=周日**（ISO 8601）。`daily` 时强制 `null` |
| 时间字符串 | `dueTime: 'HH:mm'`（**本地时间，不带日期不带时区**）；其余所有时间点仍用 UTC ISO（与现有 `dueAt` 一致） |
| 跳过语义 | `status: 'archived'` + `archivedAt` + `history.action = 'skip'`。**不新增第四种 status**，不动 `STATUS_ALIAS`、不动 `STATUS_LABELS` |
| actor | 生成 → `'system'`；改系列/跳过 → 请求方（`'web'` / `'desktop'`，走已有 `actorOf(req)`） |

### 7.2 常量归属

| 常量 | 服务端（权威） | 前端（镜像） | 下发 |
|---|---|---|---|
| `FREQS` | `server/repeat.mjs` | `src/lib/repeat.js`（供 UI 渲染，无需下发） | — |
| `WEEKDAYS` | `server/repeat.mjs` | `src/lib/repeat.js` | `GET /api/health.weekdays` |
| `TYPES` / `PRIORITIES` | `server/store.mjs`（已有） | `src/lib/format.js`（已有，双写先例） | 已有 |
| `MAX_REPEAT_IN_FOCUS = 2` | `server/app.mjs` 顶部（与 `MAX_BODY` 同级） | — | 不下发（前端不截断） |

> 双写是现有代码的既定风格（`TYPES` 在 `store.mjs:6` 和 `format.js:8` 各一份），重复功能沿用，不引入共享模块打包方案。

### 7.3 `history.mjs` 要不要动

| 问题 | 结论 |
|---|---|
| `TRACKED_FIELDS` 加不加 `repeatId`/`repeatDate`？ | **不加**。这两个是元数据不是业务变更，加进去会让每条实例的生成/解绑都产生 diff 噪音 |
| `action` 有没有枚举校验？ | 没有。`HistoryTimeline.jsx` 按字符串展示 → 新增 `'skip'`、`'repeat-apply'`、`'repeat-create'` 无需改 `history.mjs` 结构 |
| 实例生成为什么不记历史 | 见 R8。只记规则维度的操作 |
| `store.update` 的自动 action 推断 | 加 `meta.action` 优先，不改现有推断逻辑（一行改动，见 §3.3） |

### 7.4 其它跨文件约定

- 所有对 `memos` 的写操作必须经过 `store.update/create/createMany`（`sanitize` 是唯一入口），**不要**直接 push 到 `store.memos`（会绕过 `persist` 队列）。
- 生成实例的 `persist` 必须一次批量（`createMany`），不允许循环 `create()`——否则 N 次原子写 + N 次 `dailyBackup` 统计。
- `ensureToday()` 允许在任何读路径调用，但**只允许在拥有 HTTP 服务的进程里生效**（R1）。
- 前端不自行推算"今天该不该有实例"，一切以服务端返回的 `memos` 为准——避免前后端两套日期逻辑分裂。
- 焦点窗的配额、`repeatLabel` 全部服务端算，前端只渲染。

---

## 8. 文件清单

```
[D] server/repeat.mjs                 新增  规则常量 / 本地日期 / 命中判定 / 实例字段派生 / 规则 sanitize
[M] server/store.mjs                  改    repeats 文件读写 / sanitize 加 2 字段 / createMany / ensureToday / 规则 CRUD / skip / apply / meta.action
[M] server/scheduler.mjs              改    tick() 首行 ensureToday
[M] server/index.mjs                  改    启动时 ensureToday
[M] server/app.mjs                    改    /api/repeats 系列 + /api/memos/:id/skip + ensure 挂载 + buildFocus 配额 + health/export/import
[M] desktop/main.mjs                  改    ownsServer 才 ensure + 才 start scheduler  ← R1 关键
[D] src/lib/repeat.js                 新增  前端枚举 / repeatLabel / repeatSummary / nextOccurrence
[M] src/lib/api.js                    改    6 个新方法
[M] src/lib/filters.js                改    computeStats 加 skipped
[M] src/hooks/useMemos.js             改    跨天检测 reload
[D] src/components/RepeatBadge.jsx    新增  循环图标 + 文案（列表/抽屉共用）
[D] src/components/RepeatDialog.jsx   新增  规则表单（create / edit / apply 三模式，星期单选）
[M] src/components/MemoDrawer.jsx     改    重复区块 + 仅本次提示 + 改系列 + 跳过
[M] src/components/MemoList.jsx       改    行内重复标识 + 跳过按钮
[M] src/components/Icon.jsx           改    repeat 图形
[M] src/components/StatsBar.jsx       改    归档卡片显示跳过数
[M] src/App.jsx                       改    repeats state + handlers + 跨天提示 + 新建规则入口
[M] src/focus.jsx                     改    重复标识（读服务端下发的 repeatLabel）
[M] src/styles.css                    改    .meta-repeat / .repeat-panel / .repeat-badge / .fx-repeat
[M] README.md                         改    功能说明 + 数据文件 + .gitignore 提醒
[A] data/repeats.json                 运行时生成（不提交，data/ 已 gitignore）
```

`[D]` 新增 · `[M]` 修改 · `[A]` 自动生成

---

## 9. 明确「不做」的清单（防 scope 蔓延）

| 不做 | 原因 |
|---|---|
| 多选星期几（周一三五） | 用户明确单选。要做会连带 `weekday: number[]` + 命中判定重写 + UI 改 chip 组多选 |
| 每月 / 每年 / 双周 / 自定义间隔 | 未要求 |
| 预生成未来 N 天 | 与「按需实例化」核心策略冲突，会污染列表与统计 |
| 补生成历史缺失实例 | 与「错过不补」冲突 |
| 跳过节假日 / 例外日期 | 未要求 |
| 重复规则的独立管理页 / 列表视图 | 当前规则数 <20，抽屉 + 弹窗足够；加页面会多一个路由状态 |
| 连锁删除：删规则删实例 | 会丢已完成的历史 |
| 普通事项「转为重复事项」 | 未要求；`repeatId/repeatDate` 允许由 system 路径写入，日后要做只是加一个端点 |
| 给 `memos.json` 升 version 4 | 规则独立文件，`memos.json` 结构没变 |
| 引入日期库（dayjs/date-fns） | 后端零依赖是硬约束；只用 3 个日期计算函数，手写更可控 |
