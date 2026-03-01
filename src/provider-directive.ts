import type { AgentProvider } from './agent-providers.js';
import type { NewMessage } from './types.js';

const PROVIDER_DIRECTIVE_RE = /^\s*@(?<provider>codex|claude|gemini)\b(?:\s+|[,:：-]\s*)?/i;

export interface ProviderDirectiveParseResult {
  provider: AgentProvider | null;
  hasDirective: boolean;
  contentForPrompt: string;
  isDirectiveOnly: boolean;
}

export interface ResolvedProviderDirectiveMessages {
  providerOverride: AgentProvider | null;
  hasDirective: boolean;
  hasPromptContent: boolean;
  messages: NewMessage[];
}

export function parseProviderDirective(content: string): ProviderDirectiveParseResult {
  const match = content.match(PROVIDER_DIRECTIVE_RE);
  if (!match) {
    return {
      provider: null,
      hasDirective: false,
      contentForPrompt: content,
      isDirectiveOnly: false,
    };
  }

  const providerRaw = match.groups?.provider?.toLowerCase();
  const provider: AgentProvider | null =
    providerRaw === 'codex' || providerRaw === 'claude' || providerRaw === 'gemini'
      ? providerRaw
      : null;
  const stripped = content.slice(match[0].length).trimStart();
  const isDirectiveOnly = provider !== null && stripped.trim().length === 0;

  return {
    provider,
    hasDirective: provider !== null,
    contentForPrompt: stripped,
    isDirectiveOnly,
  };
}

export function resolveProviderDirectiveMessages(
  messages: NewMessage[],
): ResolvedProviderDirectiveMessages {
  let providerOverride: AgentProvider | null = null;
  let hasDirective = false;
  let hasPromptContent = false;

  const normalized = messages.map((msg) => {
    const parsed = parseProviderDirective(msg.content);
    if (parsed.provider) {
      providerOverride = parsed.provider;
      hasDirective = true;
    }
    if (parsed.contentForPrompt.trim().length > 0) {
      hasPromptContent = true;
    }
    if (parsed.contentForPrompt === msg.content) return msg;
    return { ...msg, content: parsed.contentForPrompt };
  });

  return {
    providerOverride,
    hasDirective,
    hasPromptContent,
    messages: normalized,
  };
}
