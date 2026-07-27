/**
 * 用户目录（客户端安全）：仅包含 id 与姓名，绝不含 Token。
 * 前端用户选择器使用此列表；请求只携带 user_id，由服务端映射真实 Token。
 */

export interface WorkflowUser {
  id: string;
  name: string;
}

export const WORKFLOW_USERS: WorkflowUser[] = [
  { id: 'shaowei', name: '少威' },
  { id: 'siying', name: '思颖' },
  { id: 'baozheng', name: '包正' },
  { id: 'jianxi', name: '健曦' },
  /** 未单独分配密钥的同事共用少威的 key（映射见 user-tokens.ts），用量仍按本 id 单独计入后台统计 */
  { id: 'other', name: '其他员工' },
];

/** 未选择用户时选择器展示的占位文案 */
export const USER_PLACEHOLDER = '选择用户身份';

/**
 * 默认用户：空串表示「未选择」。
 *
 * 用户选择是**强制**的：上游生产域名对无 Bearer Token 的请求直接返回 401
 * （实测 `GET /health` → 401 "Missing authorization header"），
 * 因此没有「以默认身份继续」这条可用链路——未选择时点击生成会弹窗要求先选人。
 */
export const DEFAULT_USER_ID = '';

export function isValidUserId(id: string): boolean {
  return WORKFLOW_USERS.some((u) => u.id === id);
}
