# LOCAL_TESTING.md — 本地测试环境

面向「部署到服务器、开放公网使用」的验收：所有功能都要能在本地真实跑通、并能**确定性地**复现超时、失败、中断等边界，而不是靠运气撞。

## 组成

| 组件 | 端口 | 作用 |
| --- | --- | --- |
| Next.js 应用（自定义 server） | 5000 | 被测应用本体 |
| Mock 上游工作流（`mock/workflow-mock.mjs`） | 5055 | 复刻真实上游的 `/health`、`/stream_run`(SSE)、`/cancel/{run_id}`，可注入慢/失败/挂起等行为 |
| 真实上游 `https://yunyue-image2.coze.site` | — | 冒烟用；单张实测约 55s，跑批量很慢且消耗额度 |

Mock 的事件序列、字段与心跳节奏取自对真实上游的抓包，包括两个容易踩坑的细节：
`workflow_end.output` **不带** `run_id`（见 structure.md P3）、以及每 30s 一个 `ping`。

## 一次性准备

```bash
pnpm install
```

```bash
cp .env.local.example .env.local
```

## 启动

三个终端（或后台运行）：

```bash
pnpm mock
```

```bash
pnpm dev:local
```

打开 http://localhost:5000 。

> `pnpm dev` 走 `scripts/dev.sh`，依赖 Linux 的 `ss` 做端口清理，Windows 上用 `pnpm dev:local`（等价，跨平台）。
> 改了 `.env.local` 必须**重启** dev 进程：`NEXT_PUBLIC_*` 是编译期内联的。

## 环境变量

见 `.env.local.example`。关键三个：

- `WORKFLOW_BASE_URL` / `WORKFLOW_PROD_BASE_URL`：指向 mock 或真实上游
- `NEXT_PUBLIC_TASK_TIMEOUT_MS`：单张超时阈值，**生产默认 210000**
- `NEXT_PUBLIC_TASK_MAX_ATTEMPTS`：单张最大尝试次数（含首次），默认 3

## 提示词行为标记（仅 mock 生效）

在提示词里写入标记即可指定该条的行为，标记本身会被剥离、不进入结果：

| 标记 | 行为 | 用来验证 |
| --- | --- | --- |
| `[slow]` | 永不返回 | 单张超时 → 自动重试 → 耗尽后判失败 |
| `[slow:8000]` | 8000ms 后正常返回 | 长耗时但未超时；也方便留出手动中断的窗口 |
| `[fail]` | 该条返回 `status=failed` | 内容失败（不消耗自动重试）→ 手动重试 |
| `[flaky]` | 第 1 次失败、第 2 次起成功 | 重试后恢复 |
| `[err]` | 整条工作流抛 `error` 事件 | 工作流级错误 |

`[flaky]` 的计数按提示词文本累计，重复跑同一用例前先重置：

```bash
curl -X POST -H "Authorization: Bearer mock" http://localhost:5055/__reset
```

Mock 返回的是内联 SVG 的 `data:` URL，无需外网即可在页面上真实渲染与下载。

## 验收清单

### 1. 身份选择（强制）

1. 清掉 localStorage 后打开页面 → 右上角显示「选择用户身份」（洋红待办描边）
2. 填一条提示词，点「开始批量生成」→ 弹出「请选择员工身份」，列出五个身份，**不发起任何请求**
3. 弹窗内点任一身份 → 记住选择并立即以该身份开始生成
4. 选「其他员工」跑一张 → mock 侧鉴权通过（它共用少威的 key），
   但 `data/usage.jsonl` 里这条的 `userId` 是 `other`，后台统计与少威分开计

> 为什么是强制：真实上游对无 Bearer Token 的请求直接 401
> （`curl https://yunyue-image2.coze.site/health` → `401 Missing authorization header`），
> 「以默认身份继续」不是一条可用链路。

### 2. 单张超时重试（210s）

**口径是「无进展时长」不是「总耗时」**：距上一个上游进展事件
（`workflow_start` / `node_start` / `node_end` / `workflow_end`）超过 210s 才判卡死。
`ping` 心跳**不**重置计时——上游每 30s 必发 ping，若它也算进展，卡死的运行将永远不超时。
卡片上同时显示「已耗时」与「无进展 剩余 Ns」两个数。

用 `[slow]`。想在几秒内复现同一条代码路径，把 `NEXT_PUBLIC_TASK_TIMEOUT_MS` 调小（如 8000）后重启 dev。

预期：卡片倒计时 → 到点转「等待重试」→ 第 2/3 次 → 第 3/3 次 → `TIMEOUT`，
文案「Ns 无进展，判定卡死，已重试 2 次」；日志里能看到三次不同的 `run_id`；
mock 日志里每次超时都有一条对应的 `cancel`（超时不会把上游算力挂在那里烧）。

### 2b. 并发与超时的实测关系（真实上游）

在真实上游实测到的单张耗时**方差极大**，这直接决定了并发默认值：

| 场景 | 单张耗时 |
| --- | --- |
| 并发 1，连续两张 | 37.1s / 37.0s |
| 并发 1，第三张 | **210s 内零进展事件 → 被看门狗判卡死并自动重试** |
| 并发 3，同一提示词三份 | 81.7s / 175.8s / 199.6s |
| 单条独跑（早期抓包） | 约 55s（拆分 2s + 生图 52s） |

结论：

1. **上游确实会整条卡死**——并发 1 下也复现了，这正是单张超时重试机制存在的意义
2. 并发升高会明显拉长单条墙钟时间（并发 3 已出现 199.6s，逼近 210s 阈值），吞吐收益却不明显，
   所以默认并发取 **3**；批量大又不赶时间时调低更稳
3. 也正因为方差这么大，超时口径必须是「无进展」而不是「总耗时」——
   否则并发稍高就会把健康但慢的运行误杀重启，制造重试风暴

### 3. 单张手动重试 / 单点中断

- 任一失败或中断的卡片 → 「重试此张」/「继续生成」，尝试次数从 1 重新计
- 生成中的卡片 → 「中断此张」：**只有该张**转 `CANCELLED`，同批其他任务继续跑
- 成功卡片 hover → 「重新生成」可对单张重跑
- 顶部「取消批次」停掉全部排队与在跑任务

用 `[slow:120000]` 之类的长耗时条目留出点击窗口。

### 4. 一生三

左栏选「3 份 · 一生三」→ 按钮变「开始生成（一生三）」，下方显示「本次将派发 N 个任务」。
预期：N 条提示词生成 3N 张，编号 `#01-1 / #01-2 / #01-3`；每份是独立任务，
可各自超时重试与中断；下载文件名带 `-v1/-v2/-v3` 份号。

### 5. 统一模式（拆分探针）

粘贴杂糅长文本 → 先走 `/api/split`（借上游拆分 AI 分条后立即 cancel 该运行），
再按条派发独立任务。mock 日志里应能看到 `stream_run split-…` 紧跟一条 `cancel split-…`。

拆分不可用时会弹窗询问是否「本地分条继续」，不静默降级。

### 6. 并发不设前端上限、实际封顶 10

顶栏并发框是纯文本输入。填 `25` → 铅字条右侧补出「· 实际按 10 执行」；
点生成后批次首条日志为「并发 10（填写 25，按上限执行）」，mock 侧同一毫秒最多 10 条 `stream_run`。
填空/填字母不会崩，只是保持上一个有效值。

### 7. 隐藏后台（用量总账）

1. 在**并发框**键入暗号 `&yyzb`（大小写与前后空格都认），再点一次「开始批量生成」
2. 预期：整页覆盖出「用量总账」，并发框恢复成原来的数字，**mock 侧不应出现任何新的 `stream_run`**——这一次点击不生成
3. 面板内容：汇总（派发/成功/失败/合计消费）、身份筛选、每日折线、各身份用量表、提示词流水
4. 点某个身份 → 汇总数、折线、流水三处同时跟着筛；折线上鼠标扫过读出当天数字
5. Esc 或「返回工作台」退出，工作台状态原样保留

账本落在 `data/usage.jsonl`（可用 `USAGE_LOG_PATH` 改位置），一行一条 JSON：

```bash
cat workflow/projects/data/usage.jsonl
```

清账直接删这个文件。造几天历史数据方便看折线：

```bash
node -e "const fs=require('fs');const now=Date.now();const l=[];for(let d=6;d>=1;d--)for(let i=0;i<3;i++)l.push(JSON.stringify({ts:now-d*86400000+i*3600000,userId:['shaowei','siying','other'][i],prompt:'历史样张 '+d,status:i===2?'failed':'success'}));fs.appendFileSync('data/usage.jsonl',l.join('\n')+'\n')"
```

接口本身也可以直接验：

```bash
curl -s "http://localhost:5000/api/usage?code=%26yyzb"
```

无 `code` 或 code 不对一律 403；`POST /api/usage` 对非法 `user_id` / `status` 一律 400。

### 8. 真实上游冒烟

注释掉 `.env.local` 里的两个 `WORKFLOW_*_BASE_URL`（回落真实域名）后重启，用 1–2 条短提示词跑一次。
单张约 55s。**别用真实上游跑一生三或大批量**，很慢且消耗额度。

## 静态检查

```bash
pnpm validate
```

（等价于并行跑 `ts-check` + `lint:build` + `lint:style`）
