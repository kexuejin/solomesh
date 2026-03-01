import type { AgentProvider } from './agent-providers.js';

export interface RetryDecision {
  shouldRetry: boolean;
  userFacingMessage?: string;
}

const GEMINI_TERMINAL_ERROR_PATTERNS: RegExp[] = [
  /token pool is empty/i,
  /Gemini API Key 模式未检测到 GEMINI_API_KEY/i,
  /Gemini 官方模式未检测到(?:可用)?登录凭据/i,
  /Please set an Auth method/i,
];

export function decideAgentErrorRetry(
  provider: AgentProvider,
  errorDetail: string,
): RetryDecision {
  if (provider !== 'gemini') {
    return { shouldRetry: true };
  }

  const isTerminal = GEMINI_TERMINAL_ERROR_PATTERNS.some((pattern) =>
    pattern.test(errorDetail),
  );
  if (!isTerminal) {
    return { shouldRetry: true };
  }

  if (/token pool is empty/i.test(errorDetail)) {
    return {
      shouldRetry: false,
      userFacingMessage:
        'Gemini 当前不可用：Token pool is empty。请检查 Gemini 网关令牌池/配额，或切换到可用的 Runtime。',
    };
  }

  if (/Gemini API Key 模式未检测到 GEMINI_API_KEY/i.test(errorDetail)) {
    return {
      shouldRetry: false,
      userFacingMessage:
        'Gemini API Key 模式未配置 GEMINI_API_KEY。请在设置页填写 API Key，或切换到 Google 官方模式。',
    };
  }

  if (/Gemini 官方模式未检测到(?:可用)?登录凭据|Please set an Auth method/i.test(errorDetail)) {
    return {
      shouldRetry: false,
      userFacingMessage:
        'Gemini 官方模式未检测到登录凭据。请先在设置页点击“一键登录 Google”，或在运行环境执行 gemini login。',
    };
  }

  return { shouldRetry: false };
}
