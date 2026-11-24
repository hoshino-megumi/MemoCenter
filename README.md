# 备忘中心 · Memo Center

工作待办记录与管理系统。本地全栈运行，数据以 JSON 文件落盘并每日自动快照，所有依赖只安装在当前目录。

两种使用方式，数据互通：

- **桌面端**（推荐）：托盘常驻，到点弹 Windows 置顶提醒，可召唤「今日焦点 / 便签」小窗
- **网页端**：浏览器打开使用，功能齐全但没有系统弹窗

## 快速开始

桌面端（有托盘、有弹窗）：

- Windows：双击 `desktop.bat`，启动后命令行窗口会在 3 秒后自动关闭，进程转入托盘
- 命令行：`npm run desktop`（需先 `npm run build`）
- 关掉任何窗口都不影响运行，退出请用托盘菜单「退出」
- 排查问题：双击 `desktop-debug.bat` 以前台模式运行并实时输出日志；普通模式的日志写在 `data/desktop.log`

网页端（只记录、不弹窗）：

- Windows：双击 `start.bat`；macOS / Linux：`bash start.sh`
- 手动：`npm install` → `npm run build` → `npm start`
- 打开 <http://127.0.0.1:5178>

开发模式（前端热更新，接口代理到 5178）：

```bash
npm start        # 终端 1：后端
npm run dev      # 终端 2：前端 http://127.0.0.1:5179
```

## 功能

| 模块 | 能力 |
| --- | --- |
| 快速录入 | 顶部输入框回车即建；`Ctrl+Enter` 建完直接打开详情 |
| 状态 | 未完成 / 已完成 / 归档三态；「进行中」作为可勾选标记（列表显示蓝点）；归档事项不提醒、不计逾期、只在归档视图可见 |
| 事项管理 | 编辑自动保存、勾选完成、归档与取消归档、删除进回收站（二次确认）、置顶、恢复与彻底删除 |
| 分类 | 类型（需求/缺陷/会议/跟进/日常）、多标签（最多 8 个）、优先级 P0-P3、截止时间 |
| 变更记录 | 每次创建、字段修改、状态变更、归档、删除、提醒触发都追加到 `data/history.jsonl`；记录字段旧值与新值、操作来源、原因；抽屉右上角时间线可查 |
| 变更原因 | 状态变更 / 归档时弹出原因条，可填可跳过，带常用原因快捷标签；托盘菜单可开启「变更原因必填」 |
| 截图佐证 | 每条事项最多 20 张，支持 Ctrl+V 粘贴、拖拽、选择文件；前端压缩为 WebP（长边 1600px）后存 `data/attachments`，抽屉内可放大查看 |
| 定时提醒 | 每条事项可设提醒时间（支持「截止前 30 分钟」「30 分钟后」快捷设置）；到点弹右下角置顶弹窗，可一键完成或延后，含静默时段与去重补发 |
| 今日焦点窗 | 独立小窗，展示今日代表项（逾期 + 今天到期 + P0/P1 + 进行中，不足则补齐），勾选即完成，可切换置顶 |
| 便签 | 独立于待办的随手记，五种底色，焦点窗与网页端双入口，输入即存 |
| 检索 | 标题/备注/标签实时搜索，类型与优先级可多选，支持组合筛选 |
| 视图 | 全部、今天、本周、逾期、无截止、已完成、归档、回收站、便签、按标签 |
| 排序 | 优先级、截止时间、创建时间、更新时间；置顶始终在前 |
| 统计 | 未完成、已完成、归档、今日到期、已逾期、完成率 |
| 数据 | 服务端原子写 + 每日快照（保留 30 天）、JSON 导出（含变更记录）与合并导入 |
| 其他 | 深浅色主题、快捷键 `/` 搜索、`N` 新建、窄屏自适应 |

## 托盘操作

| 操作 | 行为 |
| --- | --- |
| 左键单击 | 打开今日焦点窗（延迟 220ms 判定，避免与双击冲突） |
| 左键双击 | 打开完整主界面 |
| 右键 | 弹出菜单：未完成数、今日焦点、打开主界面、新建待办、启用提醒、变更原因必填、打开数据目录、退出 |

## 提醒规则

- 生效时间 = 延后时间（`snoozeUntil`）优先，否则取提醒时间（`reminderAt`）
- 服务端每 20 秒扫描一次，只对未完成、未删除的事项触发
- 同一条只弹一次（`reminderFiredAt` 去重）；「延后」会清空去重标记并顺延
- 静默时段默认 22:00–08:00，期间不弹，到点后补发
- 休眠或关机超过 6 小时的历史提醒不再补发，避免开机刷屏
- 网页端没有系统弹窗，设置提醒后需运行桌面端才会真正响

## 数据存储

- 事项：`data/memos.json`
- 便签：`data/notes.json`
- 设置：`data/settings.json`
- 变更记录：`data/history.jsonl`（一行一条，只追加不改写）
- 截图附件：`data/attachments/<事项 id>/<附件 id>.webp`
- 每日快照：`data/backups/memos-YYYY-MM-DD.json`、`notes-YYYY-MM-DD.json`（保留 30 天）
- 写入方式：先写临时文件再原子重命名，避免写入中断损坏数据
- 文件损坏时自动备份副本并重建

迁移或备份：直接复制 `data/` 目录（含历史与附件）；或使用侧栏「导出备份」导出 JSON（附件为二进制，需连同 `data/attachments` 一起复制）。

## 目录结构

```
├─ desktop/           桌面端（Electron）
│  ├─ main.mjs        主进程：托盘、窗口、调度、IPC
│  ├─ launch.mjs      启动器（清理环境变量后拉起 Electron）
│  ├─ preload.cjs     受控桥接：置顶、关闭、打开窗口
│  └─ assets/         托盘图标与生成脚本
├─ server/            Node 原生 http 服务（零第三方依赖）
│  ├─ app.mjs         路由、静态托管、焦点聚合
│  ├─ index.mjs       网页模式入口
│  ├─ scheduler.mjs   提醒调度（去重、静默、补发）
│  ├─ history.mjs     变更日志：字段差异计算与追加读写
│  ├─ attachments.mjs 截图落盘、读取与清理
│  └─ store.mjs       事项/便签/设置读写与快照轮转
├─ src/
│  ├─ components/     侧栏、统计、快速录入、筛选、列表、抽屉、便签、确认弹窗、变更时间线、附件面板
│  ├─ hooks/          数据状态与乐观更新
│  ├─ lib/            API 封装、筛选排序、日期格式化
│  ├─ toast.jsx       提醒弹窗页
│  ├─ focus.jsx       今日焦点 / 便签窗页
│  └─ styles.css      主题变量与全部样式
├─ data/              运行时数据（自动创建）
├─ dist/              前端构建产物
├─ desktop.bat        桌面端启动脚本（启动后台进程后自动关闭窗口）
├─ desktop-debug.bat  调试启动（前台输出日志）
├─ start.bat / start.sh
└─ vite.config.js
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/memos` | 全部事项（含已删除，前端区分） |
| POST | `/api/memos` | 新建，返回完整事项 |
| PATCH | `/api/memos/:id` | 局部更新（标题、状态、优先级、标签、截止、提醒、备注、置顶、进行中标记）；可带 `reason` |
| DELETE | `/api/memos/:id` | 软删除；`?hard=1` 彻底删除并清理附件 |
| POST | `/api/memos/:id/archive` | `{ archived: true \| false, reason }` 归档或取消归档 |
| GET | `/api/memos/:id/history` | 该事项的变更记录 |
| GET | `/api/history?limit=200` | 全局变更记录（按时间倒序） |
| GET/POST | `/api/memos/:id/attachments` | 附件列表 / 上传（`{ data: base64, name, mime, width, height }`） |
| GET/DELETE | `/api/memos/:id/attachments/:attId` | 读取图片（按实际格式返回 content-type）/ 删除 |
| POST | `/api/memos/:id/restore` | 从回收站恢复 |
| POST | `/api/memos/:id/reminder-ack` | 提醒回执 `{ action: done \| snooze \| dismiss, minutes }` |
| GET | `/api/focus` | 今日代表项 + 便签 + 统计（焦点窗一次拉完） |
| GET/POST | `/api/notes` | 便签列表 / 新建 |
| PATCH/DELETE | `/api/notes/:id` | 修改 / 删除便签 |
| GET/PATCH | `/api/settings` | 通知开关、静默时段、延后分钟数、置顶与窗口位置 |
| DELETE | `/api/trash` | 清空回收站 |
| GET | `/api/export` | 导出 JSON 文件 |
| POST | `/api/import` | 导入，`{ memos, notes, mode: "merge" \| "replace" }` |
| GET | `/api/health` | 健康检查、数据路径、桌面端是否在线 |
| POST | `/api/desktop/ping` | 桌面端心跳，用于网页端显示「提醒运行中」 |

## 依赖与安装范围

- 前端：`react`、`react-dom`；构建：`vite`、`@vitejs/plugin-react`
- 桌面端：`electron`（约 360MB，仅本目录 `node_modules`）
- 后端：仅 Node 内置模块（`node:http`、`node:fs`、`node:crypto`）
- 全部安装在工作区 `node_modules`，不使用 `npm i -g`，不写注册表、不改环境变量、不接管开机启动
- 卸载：删除本目录即可，系统无残留

## 局域网访问（可选）

当前默认绑定 `127.0.0.1`，仅本机可访问。若需要手机或同事电脑访问：

```bash
HOST=0.0.0.0 PORT=5178 node server/index.mjs
```

Windows PowerShell：`$env:HOST="0.0.0.0"; node server/index.mjs`

开放前建议先加访问口令或反向代理鉴权；窄屏下侧栏会收起，顶部提供视图切换下拉。

## 常见问题

- **端口被占用**：`PORT=5179 node server/index.mjs`
- **页面空白**：先执行 `npm run build` 生成 `dist/`
- **关掉窗口后程序还在**：桌面端设计为托盘常驻，退出请用托盘菜单「退出」；`desktop.bat` 的窗口启动后会自动关闭，属正常现象
- **启动没反应/闪退**：运行 `desktop-debug.bat` 看实时日志，或查看 `data/desktop.log`
- **提醒不弹**：确认是 `desktop.bat` / `npm run desktop` 启动的（网页端不弹）；侧栏「今日焦点窗」旁绿点表示桌面端在线；托盘菜单里勾选「启用提醒」；已归档的事项不会触发提醒
- **变更原因为什么有时不要求填**：默认只有状态变更、归档时会弹原因条，且可跳过；需要强制填写时在托盘菜单勾选「变更原因必填」
- **截图存哪了、会不会很大**：存在 `data/attachments`，粘贴或拖入时会在浏览器里压缩成 WebP（长边 1600px），1080p 截图通常 120–180KB；单张上限 6MB、单条最多 20 张
- **导出的 JSON 里有截图吗**：只有附件元数据，图片本体在 `data/attachments`，迁移时请连目录一起复制
- **从 IDE 终端启动报 `does not provide an export named 'BrowserWindow'`**：请用 `npm run desktop`，启动器会清理 `ELECTRON_RUN_AS_NODE` 环境变量
- **改了数据想回滚**：从 `data/backups/` 取对应日期文件覆盖同名文件（先停服务）

