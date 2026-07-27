# 项目上下文

## 项目概览

**JoyCloud · 云悦AI工作台** —— 生产力风格的商务浅色控制台 Web 应用，目标部署在服务器、开放公网使用。

调用「批量图片快速生成」工作流 API 批量生图。**执行模型是「逐张任务」**：一条提示词（× 份数）= 一个独立的上游 run，由前端调度器控制并发、超时、重试与中断。

- 前端通过自有后端 `/api/*` 代理访问上游工作流（避免跨域、隔离上游细节、Token 不出服务端）
- 单次 run 走 SSE 流式（上游 `/stream_run`，debug 模式推送节点级事件），前端 `fetch + Reader` 增量解析
- **用户选择是强制的**：顶栏可选五身份（少威/思颖/包正/健曦/其他员工），默认 `DEFAULT_USER_ID = ''`，占位文案「选择用户身份」。未选择时点击生成会弹 AlertDialog「请选择员工身份」，**弹窗内直接选人并立即以该身份开始生成**；没有「以默认身份继续」的兜底——实测真实上游对无 Bearer Token 的请求直接 401
  - 「其他员工」= 未单独分配密钥的同事，共用少威的 key（`user-tokens.ts` 里 `other` 指向同一个 `SHAOWEI_TOKEN`）；上游看到的是同一账号，但前端 `user_id` 不同，后台用量统计仍能把两者分开计
- **并发填多少都行，实际封顶 10**：顶栏并发框是纯文本输入（不再是 `<input type=number>` 的 min/max 夹逼），
  调度器一律按 `effectiveConcurrency(n) = min(max(n,1),10)` 开槽位，铅字条与批次首条日志会标出「实际按 10 执行」。
  放开输入限制有两个原因：一是让人自己写超额值而不是被控件挡回来，二是这个框同时是隐藏后台的暗号入口
- **隐藏管理后台**：不新增路由/子域名。并发框键入暗号 `&yyzb` 后再点一次「开始生成」即整页覆盖打开 `<AdminPanel />`，
  **该次点击不派发任何任务**（守卫排在身份校验之前）。数据来自服务端 JSONL 账本，见下文「用量账本」
- 前端仅持有 `src/lib/users.ts` 的 `id + name`（可安全打客户端包）；`id → Bearer Token` 映射在 `src/lib/user-tokens.ts`（**服务端专用，严禁 import 进客户端组件**）。请求只传 `user_id`，后端经 `resolveUpstream(user_id)` 选 key
- `/api/generate`、`/api/split` 均强制校验 `user_id`，缺失或非法一律 400

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── mock/
│   └── workflow-mock.mjs       # 本地测试用的上游工作流模拟服务（不参与生产构建）
├── public/                     # 静态资源
├── scripts/                    # 构建与启动脚本
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/route.ts   # POST：SSE 代理上游 /stream_run（注入 meta 事件携带 run_id）
│   │   │   ├── split/route.ts      # POST：拆分探针——只借上游拆分 AI 分条，拿到结果立即 cancel
│   │   │   ├── cancel/route.ts     # POST：代理上游 /cancel/{run_id}
│   │   │   ├── health/route.ts     # GET：聚合健康检查（无 user_id 直接返回 unselected，不探上游）
│   │   │   └── usage/route.ts      # POST：落一条用量流水；GET(?code=暗号)：返回聚合统计
│   │   ├── globals.css             # 活字印刷主题 Tokens + halftone / ink-pulse / press-run（见 DESIGN.md）
│   │   ├── layout.tsx
│   │   └── page.tsx                # 首页 = <Console />
│   ├── components/
│   │   ├── console/                # 业务组件
│   │   │   ├── console.tsx         # 主装配：输入状态、用户守卫弹窗、批次编排、下载、历史归档
│   │   │   ├── top-bar.tsx         # 顶栏：字标、上游状态灯与实测延迟、用户选择 + 铅字条（批次号/模式/可改并发/超时/日期）
│   │   │   ├── user-selector.tsx   # 用户下拉（未选中时洋红待办描边）+ 可复用的 UserBadge
│   │   │   ├── prompt-panel.tsx    # 左栏（受控）：分步/统一双模式输入、一生三份数、示例模板、历史
│   │   │   ├── run-tracker.tsx     # 批次抬头：五态计数 + 进度条 + 已耗时/预计剩余 + 批量操作 + 日志面板
│   │   │   ├── task-grid.tsx       # 任务网格 + 空态；统一驱动倒计时时钟
│   │   │   ├── task-card.tsx       # 单任务卡片（排队/生成中含倒计时/成功/失败/中断 五态）
│   │   │   ├── lightbox.tsx        # 大图预览 Dialog
│   │   │   └── admin-panel.tsx     # 隐藏后台：整页覆盖的用量总账（汇总/身份表/手绘 SVG 折线/提示词流水）
│   │   └── ui/                     # shadcn/ui 组件库
│   ├── hooks/
│   │   ├── use-task-runner.ts      # 核心：逐张任务调度器（并发/超时/重试/中断）
│   │   └── use-run-history.ts      # localStorage 历史（最近 10 次运行）
│   └── lib/
│       ├── tasks.ts                # 任务模型、超时/重试/并发常量、任务↔WorkflowOutput 互转
│       ├── prompt-text.ts          # 编号文本组装/解析 + 本地兜底分条
│       ├── workflow.ts             # 上游配置 + 类型 + resolveUpstream + 拆分输出防御式提取
│       ├── users.ts                # 用户清单 + USER_PLACEHOLDER（前后端共享，无密钥）
│       ├── user-tokens.ts          # 用户 Token 映射（服务端专用，严禁客户端引用）
│       ├── format.ts               # 时长格式化、fetch+blob 下载、文件名（含份号）
│       ├── examples.ts             # 示例提示词模板
│       ├── admin.ts                # 后台暗号、单张计价、统计类型（前后端共享，无密钥）
│       ├── usage-store.ts          # 用量账本 JSONL 读写 + 聚合（服务端专用）
│       └── utils.ts                # cn()
├── AGENTS.md               # 本文档（工程规范）
├── DESIGN.md               # 视觉设计规范
├── LOCAL_TESTING.md        # 本地测试环境与验收清单
├── structure.md            # 结构与问题档案
└── .env.local.example      # 本地环境变量模板
```

## 关键数据流

1. **分步模式**：左栏每个文本框即一条提示词，直接作为任务源，**不经拆分 AI**
2. **统一模式**：`POST /api/split` → 后端发起一次 `/stream_run`，读到 `split_prompts` 的 `node_end` 拿到 `{prompts: [...]}` 后**立即 `POST /cancel`** 掐断该运行（实测拆分 ~3s 完成、生图需 ~52s，此时尚未产图），返回提示词数组
3. `buildTasks(prompts, variantCount)` 展开为任务列表（一生三时每条 3 个任务，id = `${sourceIndex}-${variant}`）
4. 调度器按并发槽位（默认 5）逐个 `runTask`：客户端生成 `run_id` → `POST /api/generate {prompts_text, run_id, user_id}` → 上游 `/stream_run`（`x-run-id` 用客户端 ID，**这是单点中断的前提**）
5. 每个任务挂一个 `TASK_TIMEOUT_MS`（默认 210s）看门狗：到点 abort 本地流 + `POST /api/cancel` 通知上游停止 → 若尝试次数未耗尽则自动重排队重跑
6. 单次 run 的 `workflow_end.output.images[0]` 即该任务结果；`status=failed` 视为**内容失败**（确定性问题，不消耗自动重试，只提供手动重试）
7. 全部任务落地后 `phase = done`，`tasksToOutput()` 转成 `WorkflowOutput` 归档进 localStorage 历史

### 用量账本（隐藏后台的数据源）

**存储刻意做到最小**：一行一条 JSON 追加进 `<cwd>/data/usage.jsonl`（`USAGE_LOG_PATH` 可覆盖），
没有数据库、没有 ORM、没有迁移。量级是每天几十到几百张，需求只有「按身份/按日期汇总 + 看提示词」，
JSONL 就够：追加是 O(1)、坏行不影响其它行、`tail` 就能查、删文件即清账。
**不要**因为「将来可能要扩展」把它换成 Postgres/Supabase——真到那天再换不迟。

- **谁来写**：前端在单张任务**终局**时 `POST /api/usage`（`use-task-runner.ts` 的 `recordUsage`）。
  为什么不在 `/api/generate` 里写：那条路由是字节透传的 SSE 代理，服务端不解析流，拿不到成败
- **写什么**：`{ ts, userId, prompt, status }`，提示词入库前压空白并截断到 400 字
- **不写什么**：自动重试的中间态（同一张只记一次终局）、用户中断（没出图，不计费）
- **怎么读**：`GET /api/usage?code=<暗号>` → `readUsage()` + `aggregateUsage()`。
  日期按**北京时间 UTC+8** 分桶（服务器时区常是 UTC，用本地日期会把当天从下午割开）
- **计价**：`PRICE_PER_IMAGE = 0.12` 元/张，只对 `status=success` 计，改价改 `lib/admin.ts` 一处
- 暗号只是「不写在界面上的入口」，**不是权限边界**：账本里没有 Token 之类的敏感物，
  内网部署够用；要真做权限得上登录体系，别在暗号上加密码学

### 超时与重试策略

| 结局 | 是否自动重试 | 说明 |
| --- | --- | --- |
| 超时（210s） | 是 | 同时通知上游 cancel，避免继续烧算力 |
| 传输/上游异常 | 是 | 网络中断、HTTP 非 2xx、`error` 事件 |
| 内容失败（`status=failed`） | 否 | 确定性问题，重试大概率仍失败；提供手动重试 |
| 用户中断 | 否 | 卡片转 `CANCELLED`，可「继续生成」 |

## 常见修改定位

- 改单张超时/重试次数/并发：`src/lib/tasks.ts` 的 `TASK_TIMEOUT_MS` / `TASK_MAX_ATTEMPTS` / `DEFAULT_CONCURRENCY`（均可被 `NEXT_PUBLIC_*` 环境变量覆盖）
- 改调度行为（槽位、收尾、重试判定）：`src/hooks/use-task-runner.ts` 的 `pump` / `runTask`
- 改份数选项（一生三）：`src/lib/tasks.ts` 的 `VARIANT_CHOICES`
- 改设计 Token（颜色/动效）：`src/app/globals.css` `:root` 与 `@theme inline`（规范见 DESIGN.md）
- 改上游地址：`WORKFLOW_BASE_URL` / `WORKFLOW_PROD_BASE_URL`（`src/lib/workflow.ts` 读取）
- 增删用户：同时改 `src/lib/users.ts`（清单）与 `src/lib/user-tokens.ts`（Token 映射），id 保持一致
- 改并发硬上限：`src/lib/tasks.ts` 的 `MAX_CONCURRENCY` 与 `effectiveConcurrency()`（输入框不做限制，只在这里封顶）
- 改后台暗号 / 单张计价 / 折线天数 / 流水条数：`src/lib/admin.ts`（`ADMIN_CODE` / `PRICE_PER_IMAGE` / `STATS_MAX_*`）
- 改账本位置或字段：`src/lib/usage-store.ts`（读写与聚合都在这里，类型在 `admin.ts`）
- 注意：图片跨域下载必须走 `fetch + blob`（`src/lib/format.ts` 的 `downloadFile`），禁止 `<a download>`

## 本地测试

见 **LOCAL_TESTING.md**。要点：`pnpm mock` 起模拟上游（可注入 `[slow]`/`[fail]`/`[flaky]`/`[err]` 行为），
`pnpm dev:local` 起应用（跨平台，`pnpm dev` 依赖 Linux 的 `ss`）。
改 `.env.local` 后必须重启 dev —— `NEXT_PUBLIC_*` 是编译期内联的。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
- 本项目已由 `云悦控制台.dc.html` 指定了活字印刷视觉规范（见 DESIGN.md）：
  结构性/无障碍组件（AlertDialog、Dialog、DropdownMenu）仍走 shadcn 并由 `globals.css` 的 Token 统一改色；
  分段控件、卡片、进度条、文字按钮等按 DESIGN.md 手写——**不要给控制台加回图标或 shadcn 默认圆角**
