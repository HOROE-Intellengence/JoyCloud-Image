/** 提示词文本的组装与解析（分步 / 统一两种输入模式共用） */

/** 输入模式：step 分步（每框一条）/ unified 统一（杂糅长文本，交给拆分 AI） */
export type InputMode = 'step' | 'unified';

/**
 * 分步模式的提交文本：每条提示词合并内部换行为单行、按顺序加显式编号。
 * 归档与历史回放都以这一份文本为准。
 */
export function composeStepItems(items: string[]): string {
  return items
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');
}

/**
 * 解析外部写入的编号列表文本（历史回放 / 示例模板 / 失败重试）。
 * 编号形态兼容 `1.` `2、` `3)` `4．` 及 `7 …`（数字+空格，无分隔符）；
 * 数字后必须跟分隔符或空白，避免误吞 `16:9`、`2026H1`、`3D` 等内容行。
 * 首行非编号即判定不是编号列表，返回 null。
 */
export function parseNumberedList(text: string): string[] | null {
  const t = text.trim();
  if (!t) return null;
  const startRe = /^\s*\d{1,3}\s*(?:[.、)．]\s*|\s+)\S/;
  const stripRe = /^\s*\d{1,3}\s*(?:[.、)．]\s*|\s+)/;
  const items: string[] = [];
  let current: string[] | null = null;
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (startRe.test(raw)) {
      if (current) items.push(current.join(' ').trim());
      current = [raw.replace(stripRe, '').trim()];
    } else if (current) {
      if (line) current.push(line);
    } else if (line) {
      return null;
    }
  }
  if (current) items.push(current.join(' ').trim());
  const cleaned = items.filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * 本地兜底分条：仅在 `/api/split`（上游拆分 AI）不可用时使用。
 * 优先按编号，其次按空行，都不匹配则整体作为一条。
 * 语义准确度不如拆分 AI，因此只做降级，不做默认路径。
 */
export function localSplitPrompts(text: string): string[] {
  const numbered = parseNumberedList(text);
  if (numbered) return numbered;
  const byBlank = text
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const single = text.replace(/\s+/g, ' ').trim();
  return single ? [single] : [];
}
