import type { AgentProvider } from './agent-providers.js';
import { logger } from './logger.js';
import {
  getRuntimeProviderConfig,
  resolveRuntimeProviderConfigWithEnvFallback,
  type RuntimeProviderConfig,
} from './runtime-config.js';

const RADAR_AI_TIMEOUT_MS = 15_000;
const RADAR_AI_MAX_INPUT_CHARS = 5_000;
const RADAR_AI_MAX_OUTPUT_CHARS = 900;
const CLAUDE_FALLBACK_MODEL = 'claude-3-5-haiku-latest';
const CODEX_FALLBACK_MODEL = 'gpt-4o-mini';
const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';

export interface RadarAiSummaryInput {
  title: string;
  summary: string;
  url: string;
}

export interface RadarAiSummaryOptions {
  translateToChinese: boolean;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSummaryLines(value: string): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .join('\n');
  return truncate(normalized, RADAR_AI_MAX_OUTPUT_CHARS);
}

function buildPrompt(
  input: RadarAiSummaryInput,
  options: RadarAiSummaryOptions,
): { system: string; user: string } {
  const title = truncate(normalizeText(input.title), 500);
  const summary = truncate(normalizeText(input.summary), RADAR_AI_MAX_INPUT_CHARS);
  const url = truncate(normalizeText(input.url), 1_000);
  const languageRule = options.translateToChinese
    ? 'Output must be Simplified Chinese.'
    : 'Use the same language as the source content.';

  return {
    system: [
      'You summarize radar feed entries for busy product and engineering teams.',
      'Return plain text only. No markdown title, no JSON, no code fences.',
      'Write 3-5 concise lines with concrete facts and implications.',
      languageRule,
    ].join(' '),
    user: [
      `Title: ${title}`,
      `Summary: ${summary}`,
      `URL: ${url}`,
    ].join('\n'),
  };
}

function toOpenAiEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return 'https://api.openai.com/v1/chat/completions';
  const parsed = new URL(trimmed);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) return parsed.toString();
  if (path.endsWith('/v1')) {
    parsed.pathname = `${path}/chat/completions`;
    return parsed.toString();
  }
  parsed.pathname = `${path}/v1/chat/completions`;
  return parsed.toString();
}

function toAnthropicEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return 'https://api.anthropic.com/v1/messages';
  const parsed = new URL(trimmed);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1/messages')) return parsed.toString();
  if (path.endsWith('/v1')) {
    parsed.pathname = `${path}/messages`;
    return parsed.toString();
  }
  parsed.pathname = `${path}/v1/messages`;
  return parsed.toString();
}

function toGeminiEndpoint(baseUrl: string, model: string): string {
  const normalizedModel = model.trim().replace(/^models\//, '');
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  }
  const parsed = new URL(trimmed);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith(':generateContent')) return parsed.toString();
  parsed.pathname = `${path}/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  return parsed.toString();
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RADAR_AI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractOpenAiText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const maybeText = (part as { text?: unknown }).text;
      return typeof maybeText === 'string' ? maybeText : '';
    })
    .join('\n')
    .trim();
  return text || null;
}

function extractAnthropicText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const maybeText = (part as { text?: unknown }).text;
      return typeof maybeText === 'string' ? maybeText : '';
    })
    .join('\n')
    .trim();
  return text || null;
}

function extractGeminiText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (
    candidates[0] as {
      content?: { parts?: Array<{ text?: unknown }> };
    }
  ).content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
  return text || null;
}

function providerOrder(config: RuntimeProviderConfig): AgentProvider[] {
  const ordered: AgentProvider[] = [config.agentRuntime, 'claude', 'codex', 'gemini'];
  const unique: AgentProvider[] = [];
  for (const item of ordered) {
    if (unique.includes(item)) continue;
    unique.push(item);
  }
  return unique;
}

async function summarizeWithCodex(
  config: RuntimeProviderConfig,
  prompt: { system: string; user: string },
): Promise<string | null> {
  if (!config.codexApiKey.trim()) return null;
  const endpoint = toOpenAiEndpoint(config.codexBaseUrl);
  const payload = await fetchJsonWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.codexApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.codexModel.trim() || CODEX_FALLBACK_MODEL,
      temperature: 0.2,
      max_tokens: 320,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  return extractOpenAiText(payload);
}

async function summarizeWithClaude(
  config: RuntimeProviderConfig,
  prompt: { system: string; user: string },
): Promise<string | null> {
  const hasApiKey = !!config.anthropicApiKey.trim();
  const hasAuthToken = !!config.anthropicAuthToken.trim() && !!config.anthropicBaseUrl.trim();
  if (!hasApiKey && !hasAuthToken) return null;

  const endpoint = toAnthropicEndpoint(config.anthropicBaseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (hasApiKey) {
    headers['x-api-key'] = config.anthropicApiKey.trim();
  } else {
    headers.Authorization = `Bearer ${config.anthropicAuthToken.trim()}`;
  }

  const payload = await fetchJsonWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: CLAUDE_FALLBACK_MODEL,
      temperature: 0.2,
      max_tokens: 320,
      system: prompt.system,
      messages: [
        {
          role: 'user',
          content: prompt.user,
        },
      ],
    }),
  });
  return extractAnthropicText(payload);
}

async function summarizeWithGemini(
  config: RuntimeProviderConfig,
  prompt: { system: string; user: string },
): Promise<string | null> {
  if (!config.geminiApiKey.trim()) return null;
  const model = config.geminiModel.trim() || GEMINI_FALLBACK_MODEL;
  const endpoint = toGeminiEndpoint(config.geminiBaseUrl, model);
  const url = new URL(endpoint);
  url.searchParams.set('key', config.geminiApiKey);

  const payload = await fetchJsonWithTimeout(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.geminiApiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${prompt.system}\n\n${prompt.user}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 320,
      },
    }),
  });
  return extractGeminiText(payload);
}

export async function generateRadarAiSummary(
  input: RadarAiSummaryInput,
  options: RadarAiSummaryOptions,
): Promise<string | null> {
  const config = resolveRuntimeProviderConfigWithEnvFallback(
    getRuntimeProviderConfig(),
  );
  const prompt = buildPrompt(input, options);

  for (const provider of providerOrder(config)) {
    try {
      let output: string | null = null;
      if (provider === 'codex') {
        output = await summarizeWithCodex(config, prompt);
      } else if (provider === 'claude') {
        output = await summarizeWithClaude(config, prompt);
      } else if (provider === 'gemini') {
        output = await summarizeWithGemini(config, prompt);
      }

      const normalized = output ? normalizeSummaryLines(output) : '';
      if (normalized) return normalized;
    } catch (err) {
      logger.debug(
        { err, provider },
        'Radar AI summary provider failed, fallback to next provider',
      );
    }
  }

  return null;
}
