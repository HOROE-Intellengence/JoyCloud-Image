# structure.md — 项目结构与问题档案

## 项目结构

目录树见 **AGENTS.md**（单一事实来源，避免两处漂移）。本文档只保留**问题档案**与**经验沉淀**。

## 问题档案

开发/测试过程中实际遇到的问题，含症状、根因、修复与预防措施。

### P1. TS 类型错误：`"meta"` 不在 SSE 事件联合类型中

- **阶段**：初版交付前静态检查
- **症状**：`pnpm ts-check` 报 TS2678 —— `Type '"meta"' is not comparable to type '"error" | "workflow_start" | ...'`，位于 `use-image-workflow.ts` 事件分发处
- **根因**：后端 `/api/generate` 在 SSE 流开头自定义注入了 `{"type":"meta","run_id","user_id"}` 事件（供前端获取取消所需的 run_id），但前端 `UpstreamEvent` 联合类型只声明了 API 手册中的官方事件类型，未包含自创的 `meta` 类型
- **修复**：在 `use-image-workflow.ts` 的事件类型联合中补充 `meta` 类型声明（`{ type: 'meta'; run_id: string; user_id?: string }`），并在 switch 中优先处理
- **预防**：前后端自定义协议字段（非上游官方）必须双侧同步声明；代理层注入的私有事件需在类型定义处注释标明"本服务注入，非上游事件"

### P2. React hooks 依赖数组警告（HMR 一次性残留，两次）

- **阶段**：四用户功能改造、历史记录崩溃修复，两次代码热更新期间
- **症状**：console.log 出现 `The final argument passed to %s changed size between renders... useEffect`
- **根因**：编辑恰好修改了 `console.tsx` 中 useEffect 的依赖数组长度（3→4 项），Fast Refresh 在保留旧 fiber 状态的情况下应用新代码，新旧依赖数组长度不一致触发一次性警告。**非源码缺陷**——所有 hooks 依赖数组均为静态长度，整页刷新后不复发
- **判定方法**：警告时间戳夹在两条 `Fast Refresh rebuilding/done` 日志之间，且后续重建无复发
- **处置**：确认为 HMR 过渡产物，无需修复；如整页刷新后仍出现才需排查源码

### P3. 【严重】历史记录 runId 为 undefined，PromptPanel 渲染崩溃

- **阶段**：人工测试（浅色主题改版后）
- **症状**：页面运行时报错 `Runtime TypeError: Cannot read properties of undefined (reading 'slice')`，调用栈定位 `PromptPanel` → `Array.map` → `entry.runId.slice(0, 8)`，整页白屏崩溃
- **根因链**：
  1. 上游 `workflow_end.output` 的 `run_id` 字段**可能缺失**（API 手册 4.1 注明 run_id 为"额外附带"，3.2 基础结构示例中虽有但不保证）
  2. 历史归档取 `output.run_id` 作为记录的 `runId` → 写入 `runId: undefined` 到 localStorage
  3. 渲染历史列表时对 `undefined` 调 `.slice(0, 8)` 直接抛异常
  4. 并发隐患：`savedRunRef` 去重逻辑 `savedRunRef.current !== output.run_id` 在 run_id 缺失时退化为 `undefined !== undefined`（false），导致正常完成的运行**反而不归档**
- **修复（四层防御）**：
  1. **存量清洗**：`readHistory()` 增加 `isValidEntry` 校验（runId 必须为非空 string、createdAt 为 number、promptsText 为 string、output.images 为数组），脏数据读取时自动丢弃，用户无需手动清 localStorage
  2. **增量防污**：`addEntry(promptsText, output, runId?)` 改为接收调用方传入的运行 ID（来自 SSE meta 事件，必有值），`output.run_id` 仅作回退，最终仍为空则拒绝归档
  3. **归档链路**：console.tsx 归档与去重统一改用 `state.runId ?? output.run_id`，消除 undefined 去重失效
  4. **回放防御**：`loadOutput` 处理 `run_id` 缺失场景，日志显示 `(无 run_id)` 代替崩溃
- **预防措施**：
  - 上游文档中标注"额外附带 / 可选"的字段，代码中一律按可能缺失处理，优先使用本服务注入的可靠数据源（meta 事件）
  - localStorage 读取必须做运行时结构校验，类型声明不能替代数据校验
  - 全库审计同类风险点：TopBar `runId &&` 判空、meta 日志前置判空已确认安全

### P4. 负向测试用例被判定为"失败"（流程认知，非缺陷）

- **阶段**：初版接口冒烟测试
- **症状**：`test_run` 报 smoke_test 失败 —— `POST /api/generate` 空 `prompts_text` 返回 HTTP 400
- **根因**：400 是参数校验的**预期行为**，但测试管道将非 2xx 一律判失败
- **处置**：负向用例从最终验证清单移除（功能保留）；提交 `test_run` 时只放预期成功的用例

### P5. 上游工作流不支持「单张」粒度控制 —— 改为逐张任务引擎

- **阶段**：为「单张超时重试 / 单张手动重试 / 单点中断 / 一生三」做方案设计时
- **症状（实测抓包结论）**：一次 `/stream_run` 里，结果只在 `generate_groupN` 的 `node_end` 才吐出**整组**结果，`workflow_end` 才有完整 `images[]`。请求体只有 `prompts_text` 一个入参，没有份数、没有单条 ID、没有单条控制通道
- **含义**：在「一次 run 跑整批」的模型下，单张既**观测不到**（没有单张级事件），也**控制不了**（cancel 只能整 run 掐）。这四个功能在上游 API 层面无解
- **方案**：把执行模型改成**一条提示词 = 一次独立 run**，由前端调度器编排：
  1. 上游接受客户端指定的 `x-run-id`（实测：传 `probe-1785118877009`，回来的所有事件 `run_id` 一致）——**这是单点中断的前提**，提前持有 ID 才能精确掐某一张
  2. `POST /cancel/{run_id}` 确实生效（实测：某次 3 条的运行自然耗时约 55s，在 10.6s 发 cancel，14.0s 就收到 `error` 事件并断流）
  3. 单张实测约 55s（拆分 2s + 生图 52s），210s 超时阈值留出约 3.8 倍余量
  4. 并发 5 对齐上游原本的 5 组并行，20 条的总吞吐与原批量模式基本持平（都是约 4 波 × 55s）
- **代价**：统一模式（杂糅长文本）仍需要上游的拆分 AI。为此加了 `/api/split` **拆分探针**——发起一次 run，读到 `split_prompts` 的 `node_end` 拿到 `{prompts: […]}` 后立即 cancel。实测 mock 与真机上拆分都在 ~3s 完成、生图 ~52s，cancel 落在产图之前
- **预防**：上游能力边界要用抓包确认再定方案，别照文档推断；「API 不支持」不等于"做不了"，可以换编排层

### P6. 弹窗里再拉下拉：两个 overlay 打架

- **阶段**：强制用户选择功能的浏览器实测
- **症状**：AlertDialog 的「去选择用户」按钮点下去后，DropdownMenu 开了，但 AlertDialog **没关**，两个 overlay 同时在 DOM 里（`[role=alertdialog]` 与 `[role=menu]` 并存），焦点管理互相抢
- **根因**：Radix 的 Dialog 与 DropdownMenu 各自有 focus trap 与 `onCloseAutoFocus`，在同一 tick 里一个关一个开会互相干扰
- **修复**：不做「弹窗 → 再去拉下拉」的两级跳，直接把四个用户按钮**平铺进弹窗**，点选即记住身份并立即开始生成。少一层交互，也没有 overlay 嵌套
- **预防**：需要在弹窗里做选择时，把选项放进弹窗本身，不要从弹窗里触发另一个 overlay

## 关键经验沉淀

1. **上游数据零信任**：文档写明"必有"的字段也可能缺失，跨边界数据（SSE 事件、localStorage、上游响应）入口一律校验
2. **语义化 Token 架构收益**：浅色/深色主题切换只改 globals.css 单文件，组件零改动——新组件继续禁用硬编码色值（zinc/emerald 等），统一使用 signal/success/panel 等语义类
3. **密钥边界**：Token 仅存于 `user-tokens.ts`（服务端），前端只传 user_id；新增用户时两文件同步、id 保持一致
4. **HMR 警告甄别**：开发期 hooks 警告先看时间戳是否夹在 Fast Refresh 日志之间，避免误改正常源码
5. **能力边界靠实测**：上游是否接受客户端 `x-run-id`、cancel 是否真的生效、单张真实耗时——这三条决定了整个逐张任务引擎能否成立，全部是抓包实测得到的，文档里没有
6. **本地要能确定性复现边界**：`mock/workflow-mock.mjs` 支持在提示词里写 `[slow]`/`[fail]`/`[flaky]`/`[err]` 指定该条行为，超时、重试、中断这些路径才能在几秒内稳定重现，而不是靠运气撞真实故障（见 LOCAL_TESTING.md）
7. **超时必须同时通知上游**：本地 abort 只断自己的读取流，上游还在跑。看门狗到点要 abort + `POST /api/cancel` 双管齐下，否则超时重试会叠加真实算力消耗
8. **区分「可重试」与「不可重试」的失败**：超时和传输异常自动重试；上游明确返回 `status=failed` 的内容失败是确定性问题，自动重试只会重复烧钱，改为只给手动重试入口
