import type { AgentProvider } from './agent-providers.js';

export interface RetryDecision {
  shouldRetry: boolean;
  userFacingMessage?: string;
}

const GEMINI_TERMINAL_ERROR_PATTERNS: RegExp[] = [
  /token pool is empty/i,
  /Gemini 运行时未检测到 GEMINI_API_KEY/i,
  /Gemini API Key 模式未检测到 GEMINI_API_KEY/i,
  /RESOURCE_EXHAUSTED/i,
  /quota exceeded/i,
  /generate_content_free_tier/i,
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

  if (/Gemini 运行时未检测到 GEMINI_API_KEY|Gemini API Key 模式未检测到 GEMINI_API_KEY/i.test(errorDetail)) {
    return {
      shouldRetry: false,
      userFacingMessage:
        'Gemini 未配置 GEMINI_API_KEY。请在设置页填写 API Key。',
    };
  }

  if (
    /RESOURCE_EXHAUSTED|quota exceeded|generate_content_free_tier/i.test(
      errorDetail,
    )
  ) {
    return {
      shouldRetry: false,
      userFacingMessage:
        'Gemini 配额不足（429/RESOURCE_EXHAUSTED）。请在设置中将模型切换为 gemini-2.5-flash，或开通 Gemini 计费后再试。',
    };
  }

  return { shouldRetry: false };
}
