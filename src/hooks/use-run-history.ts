'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WorkflowOutput } from '@/lib/workflow';

export interface RunHistoryEntry {
  runId: string;
  createdAt: number;
  promptsPreview: string;
  promptsText: string;
  output: WorkflowOutput;
}

const STORAGE_KEY = 'image-mill:history';
const MAX_ENTRIES = 10;

function isValidEntry(e: unknown): e is RunHistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const entry = e as Partial<RunHistoryEntry>;
  return (
    typeof entry.runId === 'string' &&
    entry.runId.length > 0 &&
    typeof entry.createdAt === 'number' &&
    typeof entry.promptsText === 'string' &&
    typeof entry.promptsPreview === 'string' &&
    !!entry.output &&
    Array.isArray((entry.output as WorkflowOutput).images)
  );
}

function readHistory(): RunHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 清洗历史脏数据（如 runId 缺失的早期记录），不合格条目直接丢弃
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

export function useRunHistory() {
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const addEntry = useCallback(
    (promptsText: string, output: WorkflowOutput, runId?: string | null) => {
      // runId 优先取调用方传入的运行 ID（来自 SSE meta 事件，必有值），
      // output.run_id 由上游“额外附带”，可能缺失
      const resolvedRunId = runId ?? output.run_id ?? '';
      if (!resolvedRunId) return;
      const firstLine =
        promptsText
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? '未命名任务';
      const entry: RunHistoryEntry = {
        runId: resolvedRunId,
        createdAt: Date.now(),
        promptsPreview: firstLine.slice(0, 42),
        promptsText,
        output,
      };
      setHistory((prev) => {
        const next = [
          entry,
          ...prev.filter((e) => e.runId !== entry.runId),
        ].slice(0, MAX_ENTRIES);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // 存储超限等情况忽略
        }
        return next;
      });
    },
    [],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { history, addEntry, clearHistory };
}
