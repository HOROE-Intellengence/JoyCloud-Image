/**
 * 本地测试用的「上游工作流」模拟服务（仅开发环境使用，不参与生产构建）。
 *
 * 复刻真实上游 https://yunyue-image2.coze.site 的三个接口与 SSE 事件序列
 * （事件形态取自真实抓包：workflow_start → node_start/node_end×N → workflow_end，
 *  每 30s 一个 ping 心跳；workflow_end.output 不带 run_id）：
 *
 *   GET  /health              健康检查
 *   POST /stream_run          SSE 流式运行，读取 x-run-id / x-workflow-stream-mode
 *   POST /cancel/{run_id}     中断指定运行
 *
 * 提示词里可写入行为标记，用来稳定复现各类边界（标记本身会从提示词中剥离）：
 *   [slow]      该条挂起不返回（用于验证单张超时 + 自动重试）
 *   [slow:8000] 该条耗时 8000ms 后正常返回
 *   [fail]      该条返回 status=failed
 *   [flaky]     该条第 1 次失败、第 2 次起成功（用于验证重试后恢复）
 *   [err]       整条工作流直接抛 error 事件
 *
 * 环境变量：
 *   MOCK_PORT           监听端口，默认 5055
 *   MOCK_GEN_MS         默认单张生成耗时（毫秒），默认 1200
 *   MOCK_SPLIT_MS       拆分节点耗时（毫秒），默认 400
 *   MOCK_REQUIRE_AUTH   为 '1' 时校验 Authorization: Bearer <token>，默认 '1'
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 5055);
const GEN_MS = Number(process.env.MOCK_GEN_MS ?? 1200);
const SPLIT_MS = Number(process.env.MOCK_SPLIT_MS ?? 400);
const REQUIRE_AUTH = (process.env.MOCK_REQUIRE_AUTH ?? '1') === '1';

/** run_id → { cancelled: boolean } */
const runs = new Map();
/** 提示词 → 已尝试次数，用于 [flaky] 语义 */
const attempts = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  console.log(`[mock ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

/** 解析提示词中的行为标记，返回剥离标记后的提示词与行为描述 */
function parseDirectives(raw) {
  let prompt = raw;
  const directive = { hang: false, genMs: GEN_MS, fail: false, flaky: false, err: false };

  const slowWithMs = prompt.match(/\[slow:(\d+)\]/i);
  if (slowWithMs) {
    directive.genMs = Number(slowWithMs[1]);
    prompt = prompt.replace(slowWithMs[0], '');
  } else if (/\[slow\]/i.test(prompt)) {
    directive.hang = true;
    prompt = prompt.replace(/\[slow\]/gi, '');
  }
  if (/\[fail\]/i.test(prompt)) {
    directive.fail = true;
    prompt = prompt.replace(/\[fail\]/gi, '');
  }
  if (/\[flaky\]/i.test(prompt)) {
    directive.flaky = true;
    prompt = prompt.replace(/\[flaky\]/gi, '');
  }
  if (/\[err\]/i.test(prompt)) {
    directive.err = true;
    prompt = prompt.replace(/\[err\]/gi, '');
  }
  return { prompt: prompt.replace(/\s+/g, ' ').trim(), directive };
}

/**
 * 模拟上游拆分 AI：按行首编号（1. / 2、 / 3) …）拆分，
 * 无编号时按空行拆分，都不匹配则整体作为一条。
 */
function splitPrompts(text) {
  const t = text.trim();
  if (!t) return [];
  const numbered = [];
  let current = null;
  for (const raw of t.split('\n')) {
    if (/^\s*\d{1,3}\s*(?:[.、)．]\s*|\s+)\S/.test(raw)) {
      if (current) numbered.push(current.join(' '));
      current = [raw.replace(/^\s*\d{1,3}\s*(?:[.、)．]\s*|\s+)/, '').trim()];
    } else if (current && raw.trim()) {
      current.push(raw.trim());
    }
  }
  if (current) numbered.push(current.join(' '));
  if (numbered.length > 0) return numbered.map((s) => s.trim()).filter(Boolean);

  const byBlank = t
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return byBlank.length > 0 ? byBlank : [t.replace(/\s+/g, ' ').trim()];
}

/** 均分到 5 组，保留原始 index */
function distribute(prompts) {
  const groups = [[], [], [], [], []];
  prompts.forEach((prompt, index) => {
    groups[index % 5].push({ index, prompt });
  });
  return groups;
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleStreamRun(req, res, body) {
  const runId = req.headers['x-run-id'] || `mock-${Date.now()}`;
  const state = { cancelled: false };
  runs.set(runId, state);

  const promptsText = String(body.prompts_text ?? '');
  const rawPrompts = splitPrompts(promptsText);
  log(`stream_run ${runId} · ${rawPrompts.length} prompt(s)`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const base = () => ({
    timestamp: Date.now(),
    log_id: `mock-log-${runId}`,
    run_id: runId,
  });

  // 心跳：真实上游约每 30s 一个 ping
  const ping = setInterval(() => {
    if (!res.writableEnded) sseWrite(res, { type: 'ping', ...base() });
  }, 30_000);

  const finish = () => {
    clearInterval(ping);
    runs.delete(runId);
    if (!res.writableEnded) res.end();
  };

  req.on('close', () => {
    if (!res.writableEnded) {
      state.cancelled = true;
      log(`client closed ${runId}`);
      finish();
    }
  });

  const abortIfCancelled = () => {
    if (state.cancelled) {
      sseWrite(res, {
        type: 'error',
        ...base(),
        code: 'CANCELLED',
        message: 'Run cancelled by user',
      });
      finish();
      return true;
    }
    return false;
  };

  sseWrite(res, { type: 'workflow_start', ...base() });

  // ---- split_prompts ----
  sseWrite(res, {
    type: 'node_start',
    ...base(),
    node_name: 'split_prompts',
    input: { prompts_text: promptsText, max_retries: 3 },
  });
  await sleep(SPLIT_MS);
  if (abortIfCancelled()) return;

  const parsed = rawPrompts.map(parseDirectives);
  const prompts = parsed.map((p) => p.prompt);
  sseWrite(res, {
    type: 'node_end',
    ...base(),
    node_name: 'split_prompts',
    output: { prompts },
    time_cost_ms: SPLIT_MS,
  });

  if (parsed.some((p) => p.directive.err)) {
    sseWrite(res, {
      type: 'error',
      ...base(),
      code: 'MOCK_ERROR',
      message: '模拟的工作流内部错误 ([err] 标记)',
    });
    finish();
    return;
  }

  // ---- distribute_tasks ----
  sseWrite(res, {
    type: 'node_start',
    ...base(),
    node_name: 'distribute_tasks',
    input: { prompts },
  });
  const groups = distribute(prompts);
  const distributeOutput = {};
  groups.forEach((g, i) => {
    distributeOutput[`group${i + 1}_tasks`] = g;
  });
  sseWrite(res, {
    type: 'node_end',
    ...base(),
    node_name: 'distribute_tasks',
    output: distributeOutput,
    time_cost_ms: 1,
  });

  // ---- generate_group1..5（并行）----
  groups.forEach((g, i) => {
    sseWrite(res, {
      type: 'node_start',
      ...base(),
      node_name: `generate_group${i + 1}`,
      input: { [`group${i + 1}_tasks`]: g, max_retries: 3 },
    });
  });

  const results = [];
  await Promise.all(
    groups.map(async (group, gi) => {
      const groupResults = [];
      const startedAt = Date.now();
      for (const task of group) {
        const { directive } = parsed[task.index];

        if (directive.hang) {
          // 永不返回：等到客户端超时中断或收到 cancel
          log(`task #${task.index} hanging (run ${runId})`);
          while (!state.cancelled && !res.writableEnded) await sleep(200);
          return;
        }

        await sleep(directive.genMs);
        if (state.cancelled || res.writableEnded) return;

        const key = `${task.prompt}`;
        const n = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, n);
        const flakyFail = directive.flaky && n === 1;

        if (directive.fail || flakyFail) {
          groupResults.push({
            index: task.index,
            prompt: task.prompt,
            url: '',
            status: 'failed',
            error: flakyFail
              ? '模拟的首次失败 ([flaky] 标记)，重试可成功'
              : '模拟的生成失败 ([fail] 标记)',
          });
        } else {
          groupResults.push({
            index: task.index,
            prompt: task.prompt,
            url: mockImageUrl(task.index, task.prompt),
            status: 'success',
            error: '',
          });
        }
      }
      results.push(...groupResults);
      if (!state.cancelled && !res.writableEnded) {
        sseWrite(res, {
          type: 'node_end',
          ...base(),
          node_name: `generate_group${gi + 1}`,
          output: { [`group${gi + 1}_results`]: groupResults },
          time_cost_ms: Date.now() - startedAt,
        });
      }
    }),
  );

  if (abortIfCancelled()) return;
  if (res.writableEnded) {
    clearInterval(ping);
    return;
  }

  // ---- merge_sort ----
  results.sort((a, b) => a.index - b.index);
  const output = {
    images: results,
    total_count: results.length,
    success_count: results.filter((r) => r.status === 'success').length,
  };
  sseWrite(res, {
    type: 'node_start',
    ...base(),
    node_name: 'merge_sort',
    input: {},
  });
  sseWrite(res, {
    type: 'node_end',
    ...base(),
    node_name: 'merge_sort',
    output,
    time_cost_ms: 2,
  });
  // 注意：真实上游 workflow_end.output 不含 run_id，此处刻意保持一致
  sseWrite(res, { type: 'workflow_end', ...base(), output, time_cost_ms: 0 });
  finish();
}

/** 生成一张带序号的内联 SVG 图（data URI），无需外网即可在页面上真实渲染 */
function mockImageUrl(index, prompt) {
  const hue = (index * 47) % 360;
  const label = String(index + 1).padStart(2, '0');
  const text = prompt.slice(0, 18).replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
<rect width="512" height="512" fill="hsl(${hue} 45% 82%)"/>
<circle cx="256" cy="210" r="120" fill="hsl(${hue} 55% 62%)"/>
<text x="256" y="238" font-family="monospace" font-size="96" font-weight="bold" fill="#fff" text-anchor="middle">${label}</text>
<text x="256" y="410" font-family="sans-serif" font-size="24" fill="#1c2128" text-anchor="middle">${text}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function unauthorized(req) {
  if (!REQUIRE_AUTH) return false;
  const auth = req.headers.authorization ?? '';
  return !/^Bearer\s+\S+/.test(auth);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  if (unauthorized(req)) {
    // 与真实上游一致：缺 Bearer 时 401
    return json(401, {
      msg: 'Missing authorization header. Please provide a valid Bearer token in the Authorization header',
    });
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(200, { status: 'ok', message: 'Service is running (mock)' });
  }

  if (req.method === 'POST' && url.pathname === '/stream_run') {
    const body = await readBody(req);
    return handleStreamRun(req, res, body);
  }

  if (req.method === 'POST' && url.pathname.startsWith('/cancel/')) {
    const runId = decodeURIComponent(url.pathname.slice('/cancel/'.length));
    const state = runs.get(runId);
    if (state) state.cancelled = true;
    log(`cancel ${runId} · ${state ? 'signalled' : 'unknown run'}`);
    return json(200, {
      status: 'success',
      run_id: runId,
      message: 'Cancellation signal sent, task will be cancelled at next await point',
    });
  }

  // 测试辅助：重置 [flaky] 计数，让重试用例可重复执行
  if (req.method === 'POST' && url.pathname === '/__reset') {
    attempts.clear();
    return json(200, { status: 'ok', message: 'flaky counters reset' });
  }

  return json(404, { msg: 'not found' });
});

server.listen(PORT, () => {
  log(`mock upstream workflow listening on http://localhost:${PORT}`);
  log(`gen=${GEN_MS}ms split=${SPLIT_MS}ms auth=${REQUIRE_AUTH ? 'required' : 'off'}`);
});
