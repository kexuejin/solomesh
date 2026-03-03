import type { TaskConfig } from './types.js';

export interface AutomationChatTemplatePreset {
  id: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  contextMode: 'group' | 'isolated';
  taskConfig: TaskConfig | null;
  requiresRepo?: boolean;
}

export interface AutomationChatTaskSpec {
  templateId: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  contextMode: 'group' | 'isolated';
  taskConfig: TaskConfig | null;
}

export type AutomationChatCommand =
  | { type: 'none' }
  | { type: 'help' }
  | {
      type: 'create';
      templateId: string;
      args: Record<string, string>;
      extraTokens: string[];
    };

export interface AutomationChatCommandParseResult {
  command: AutomationChatCommand;
  hasCommand: boolean;
  contentForPrompt: string;
  isCommandOnly: boolean;
}

const AUTOMATION_COMMAND_RE = /^\s*\/auto(?:mation)?(?:\s+|$)(?<rest>[\s\S]*)$/i;

const CHAT_AUTOMATION_PRESETS: AutomationChatTemplatePreset[] = [
  {
    id: 'competitor-watch',
    prompt:
      '追踪目标竞品最近24小时的功能、定价、公告与发布动态；提炼对当前项目有影响的变更项，输出“变化点 / 影响评估 / 建议动作”，并给出可写入 Todo 的候选条目。',
    scheduleType: 'cron',
    scheduleValue: '0 11 * * 1-5',
    contextMode: 'isolated',
    taskConfig: {
      on_error: {
        todo_ingest: true,
      },
      on_success: {
        decision_ingest: true,
      },
      plugins: {
        competitor_git: {
          enabled: true,
          branch: 'main',
          lookback_commits: 50,
        },
      },
    },
    requiresRepo: true,
  },
  {
    id: 'project-recommendation',
    prompt:
      '扫描近期值得关注的新项目或开源工具，按“相关性 / 影响力 / 落地成本”评分排序；输出推荐理由、风险提示与下一步动作，并给出可写入 Todo 的候选条目。',
    scheduleType: 'cron',
    scheduleValue: '30 11 * * 1-5',
    contextMode: 'isolated',
    taskConfig: {
      on_error: {
        todo_ingest: true,
      },
      on_success: {
        decision_ingest: true,
      },
    },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeObjects(current, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function parseKeyValueTokens(raw: string): {
  args: Record<string, string>;
  extras: string[];
} {
  const args: Record<string, string> = {};
  const consumedRanges: Array<{ start: number; end: number }> = [];
  const keyValueRe =
    /([a-zA-Z_][a-zA-Z0-9_-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g;
  let match: RegExpExecArray | null = keyValueRe.exec(raw);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    consumedRanges.push({ start, end });
    const key = match[1].trim().toLowerCase();
    const doubleQuoted = match[2];
    const singleQuoted = match[3];
    const plain = match[4];
    const value = (doubleQuoted ?? singleQuoted ?? plain ?? '').trim();
    if (key && value) {
      args[key] = value.replace(/\\(["'\\])/g, '$1');
    }
    match = keyValueRe.exec(raw);
  }
  if (consumedRanges.length === 0) {
    return {
      args,
      extras: raw
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    };
  }

  const chars = raw.split('');
  for (const range of consumedRanges) {
    for (let idx = range.start; idx < range.end; idx += 1) {
      chars[idx] = ' ';
    }
  }
  const extras = chars
    .join('')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return { args, extras };
}

function normalizeTemplateId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function isLikelyGitRepoUrl(value: string): boolean {
  const repo = value.trim();
  if (!repo) return false;
  if (/^https?:\/\/[^\s/]+\/.+/i.test(repo)) return true;
  if (/^ssh:\/\/[^\s]+/i.test(repo)) return true;
  if (/^git@[^\s:]+:[^\s]+/.test(repo)) return true;
  return false;
}

function cloneTaskConfig(config: TaskConfig | null | undefined): TaskConfig | null {
  if (!isPlainObject(config)) return null;
  return deepMergeObjects({}, config) as TaskConfig;
}

export function listAutomationChatTemplateIds(): string[] {
  return CHAT_AUTOMATION_PRESETS.map((item) => item.id);
}

export function getAutomationChatTemplatePreset(
  templateId: string,
): AutomationChatTemplatePreset | null {
  const normalized = normalizeTemplateId(templateId);
  if (!normalized) return null;
  return CHAT_AUTOMATION_PRESETS.find((item) => item.id === normalized) ?? null;
}

export function parseAutomationChatCommandInput(
  content: string,
): AutomationChatCommandParseResult {
  const matched = content.match(AUTOMATION_COMMAND_RE);
  if (!matched) {
    return {
      command: { type: 'none' },
      hasCommand: false,
      contentForPrompt: content,
      isCommandOnly: false,
    };
  }

  const rest = (matched.groups?.rest ?? '').trim();
  if (!rest) {
    return {
      command: { type: 'help' },
      hasCommand: true,
      contentForPrompt: '',
      isCommandOnly: true,
    };
  }

  const firstTokenMatch = rest.match(/^(?<template>\S+)(?<remaining>[\s\S]*)$/);
  const templateId = normalizeTemplateId(firstTokenMatch?.groups?.template ?? null);
  if (!templateId) {
    return {
      command: { type: 'help' },
      hasCommand: true,
      contentForPrompt: '',
      isCommandOnly: true,
    };
  }

  const remaining = (firstTokenMatch?.groups?.remaining ?? '').trim();
  const parsed = parseKeyValueTokens(remaining);
  return {
    command: {
      type: 'create',
      templateId,
      args: parsed.args,
      extraTokens: parsed.extras,
    },
    hasCommand: true,
    contentForPrompt: '',
    isCommandOnly: true,
  };
}

export function buildAutomationTaskSpecFromChatCommand(command: {
  templateId: string;
  args: Record<string, string>;
  extraTokens: string[];
}): { ok: true; spec: AutomationChatTaskSpec } | { ok: false; error: string } {
  const preset = getAutomationChatTemplatePreset(command.templateId);
  if (!preset) {
    return {
      ok: false,
      error: `不支持的模板：${command.templateId}`,
    };
  }

  const scheduleCron = command.args.cron;
  const scheduleIntervalMs = command.args.interval_ms;
  const scheduleOnce = command.args.once;
  let scheduleType = preset.scheduleType;
  let scheduleValue = preset.scheduleValue;
  if (scheduleCron) {
    scheduleType = 'cron';
    scheduleValue = scheduleCron;
  } else if (scheduleIntervalMs) {
    const ms = parsePositiveInt(scheduleIntervalMs);
    if (!ms) {
      return { ok: false, error: 'interval_ms 必须是正整数（毫秒）' };
    }
    scheduleType = 'interval';
    scheduleValue = String(ms);
  } else if (scheduleOnce) {
    scheduleType = 'once';
    scheduleValue = scheduleOnce;
  }

  const contextRaw = (command.args.context ?? '').trim().toLowerCase();
  const contextMode: 'group' | 'isolated' =
    contextRaw === 'group'
      ? 'group'
      : contextRaw === 'isolated'
        ? 'isolated'
        : preset.contextMode;

  const prompt = (command.args.prompt ?? '').trim() || preset.prompt;
  const taskConfig = cloneTaskConfig(preset.taskConfig);

  if (preset.requiresRepo) {
    const repo =
      (command.args.repo ?? command.args.repo_url ?? command.args.git ?? '').trim()
      || command.extraTokens[0]?.trim()
      || '';
    if (!repo) {
      return {
        ok: false,
        error: 'competitor-watch 需要提供 repo（例如 repo=https://github.com/org/repo）',
      };
    }
    if (!isLikelyGitRepoUrl(repo)) {
      return {
        ok: false,
        error: 'repo 格式无效，请提供 git 仓库地址（https://... 或 git@...）',
      };
    }
    const branch = (command.args.branch ?? '').trim() || 'main';
    const lookbackRaw = command.args.lookback ?? command.args.lookback_commits;
    const lookback = parsePositiveInt(lookbackRaw ?? '') ?? 50;
    const plugins = isPlainObject(taskConfig?.plugins)
      ? taskConfig?.plugins as Record<string, unknown>
      : {};
    const competitorGitRaw = isPlainObject(plugins.competitor_git)
      ? plugins.competitor_git
      : {};

    const nextConfig = cloneTaskConfig(taskConfig) ?? {};
    nextConfig.plugins = {
      ...plugins,
      competitor_git: {
        ...competitorGitRaw,
        enabled: true,
        repo,
        branch,
        lookback_commits: lookback,
      },
    };
    return {
      ok: true,
      spec: {
        templateId: preset.id,
        prompt,
        scheduleType,
        scheduleValue,
        contextMode,
        taskConfig: nextConfig,
      },
    };
  }

  return {
    ok: true,
    spec: {
      templateId: preset.id,
      prompt,
      scheduleType,
      scheduleValue,
      contextMode,
      taskConfig,
    },
  };
}
