import type { TodoPriority } from './types.js';

export type LinkInsightCommand =
  | { type: 'none' }
  | { type: 'help' }
  | {
      type: 'analyze';
      url: string;
      focus: string;
    };

export interface LinkInsightCommandParseResult {
  command: LinkInsightCommand;
  hasCommand: boolean;
  contentForPrompt: string;
  isCommandOnly: boolean;
}

export interface LinkInsightSnapshot {
  url: string;
  title: string;
  description: string;
  content: string;
  extractedAt: string;
}

export interface LinkInsightAnalysisResult {
  decisionTitle: string;
  decisionSummary: string;
  suggestedTodoTitle: string;
  suggestedTodoDescription: string;
  priority: TodoPriority;
  keyPoints: string[];
}

const LINK_INSIGHT_COMMAND_RE = /^\s*\/insight(?:\s+|$)(?<rest>[\s\S]*)$/i;
const URL_TOKEN_RE = /https?:\/\/[^\s<>"']+/i;
const LINK_INSIGHT_JSON_BLOCK_RE =
  /<link_insight_json>\s*([\s\S]*?)\s*<\/link_insight_json>/i;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeText(input: string): string {
  return decodeHtmlEntities(input)
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(input: string, maxLength: number): string {
  const text = normalizeText(input);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function parseTitle(html: string): string {
  const ogTitleMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  if (ogTitleMatch?.[1]) return clipText(ogTitleMatch[1], 200);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return clipText(titleMatch[1], 200);

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) return clipText(h1Match[1], 200);

  return 'Untitled Article';
}

function parseDescription(html: string): string {
  const ogDescMatch = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  if (ogDescMatch?.[1]) return clipText(ogDescMatch[1], 500);

  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  if (descMatch?.[1]) return clipText(descMatch[1], 500);

  return '';
}

function extractVisibleText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return clipText(cleaned, 16000);
}

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIPv4Literal(hostname)) return false;
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isDisallowedHostname(hostnameRaw: string): boolean {
  const hostname = hostnameRaw.trim().toLowerCase();
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (hostname.endsWith('.local')) return true;
  if (isPrivateIpv4(hostname)) return true;
  return false;
}

function tryParseJsonCandidate(raw: string): unknown | null {
  const blockMatch = raw.match(LINK_INSIGHT_JSON_BLOCK_RE);
  const candidate = blockMatch?.[1]?.trim() || raw.trim();
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    const objectLike = candidate.match(/\{[\s\S]*\}/);
    if (!objectLike?.[0]) return null;
    try {
      return JSON.parse(objectLike[0]);
    } catch {
      return null;
    }
  }
}

function sanitizePriority(value: unknown): TodoPriority {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'medium';
}

export function parseLinkInsightChatCommandInput(
  content: string,
): LinkInsightCommandParseResult {
  const matched = content.match(LINK_INSIGHT_COMMAND_RE);
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

  const urlMatch = rest.match(URL_TOKEN_RE);
  if (!urlMatch?.[0]) {
    return {
      command: { type: 'help' },
      hasCommand: true,
      contentForPrompt: '',
      isCommandOnly: true,
    };
  }

  const url = urlMatch[0].trim();
  const focus = rest.replace(urlMatch[0], '').trim();
  return {
    command: {
      type: 'analyze',
      url,
      focus,
    },
    hasCommand: true,
    contentForPrompt: '',
    isCommandOnly: true,
  };
}

export async function fetchLinkInsightSnapshot(
  rawUrl: string,
): Promise<LinkInsightSnapshot> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL 无效，请提供 http/https 链接');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('仅支持 http/https 链接');
  }
  if (isDisallowedHostname(parsedUrl.hostname)) {
    throw new Error('不允许分析本地或内网地址');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'solomesh-link-insight/1.0',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`抓取失败：HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`暂不支持该内容类型：${contentType || 'unknown'}`);
  }

  const htmlRaw = await response.text();
  const html = htmlRaw.slice(0, 2_000_000);
  const title = parseTitle(html);
  const description = parseDescription(html);
  const content = extractVisibleText(html);
  if (!content) {
    throw new Error('未能提取有效正文');
  }

  return {
    url: parsedUrl.toString(),
    title,
    description,
    content,
    extractedAt: new Date().toISOString(),
  };
}

export function buildLinkInsightAgentPrompt(
  snapshot: LinkInsightSnapshot,
  focus: string,
): string {
  const focusSection = focus
    ? `\n分析关注点：${focus}\n`
    : '\n分析关注点：优先关注对当前项目可执行的决策与动作。\n';

  return [
    '你是产品与技术决策分析助手。',
    '请阅读下面文章内容，输出精炼决策结论，并严格返回 JSON（不要 Markdown，不要解释）。',
    'JSON 格式：',
    '{',
    '  "decisionTitle": "string, 20-120字",',
    '  "decisionSummary": "string, 80-500字，包含结论与影响",',
    '  "suggestedTodoTitle": "string, 10-120字",',
    '  "suggestedTodoDescription": "string, 80-800字，强调可执行动作",',
    '  "priority": "low|medium|high|critical",',
    '  "keyPoints": ["string", "string"]',
    '}',
    focusSection,
    `文章来源：${snapshot.url}`,
    `文章标题：${snapshot.title}`,
    snapshot.description ? `文章摘要：${snapshot.description}` : '文章摘要：无',
    '文章正文（已截断）：',
    snapshot.content,
  ].join('\n');
}

export function parseLinkInsightAgentOutput(
  rawOutput: string,
  snapshot: LinkInsightSnapshot,
): LinkInsightAnalysisResult {
  const parsed = tryParseJsonCandidate(rawOutput) as Record<string, unknown> | null;

  const fallbackSummary = clipText(
    snapshot.description || snapshot.content.slice(0, 600),
    600,
  );
  const fallbackTitle = clipText(`文章分析：${snapshot.title}`, 120);

  const decisionTitle = clipText(
    typeof parsed?.decisionTitle === 'string' && parsed.decisionTitle.trim().length > 0
      ? parsed.decisionTitle
      : fallbackTitle,
    120,
  );
  const decisionSummary = clipText(
    typeof parsed?.decisionSummary === 'string' && parsed.decisionSummary.trim().length > 0
      ? parsed.decisionSummary
      : fallbackSummary,
    900,
  );
  const suggestedTodoTitle = clipText(
    typeof parsed?.suggestedTodoTitle === 'string' && parsed.suggestedTodoTitle.trim().length > 0
      ? parsed.suggestedTodoTitle
      : `评估并落地：${snapshot.title}`,
    120,
  );
  const suggestedTodoDescription = clipText(
    typeof parsed?.suggestedTodoDescription === 'string'
    && parsed.suggestedTodoDescription.trim().length > 0
      ? parsed.suggestedTodoDescription
      : decisionSummary,
    1200,
  );
  const keyPoints = Array.isArray(parsed?.keyPoints)
    ? parsed.keyPoints
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => clipText(item, 180))
      .slice(0, 6)
    : [];

  return {
    decisionTitle,
    decisionSummary,
    suggestedTodoTitle,
    suggestedTodoDescription,
    priority: sanitizePriority(parsed?.priority),
    keyPoints,
  };
}
