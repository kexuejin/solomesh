import type { AgentProvider } from './agent-providers.js';

export interface ProviderHandoffTransition {
  fromProvider: AgentProvider;
  toProvider: AgentProvider;
}

export interface ResolveProviderHandoffTransitionInput {
  directiveProvider: AgentProvider | null;
  persistedProvider: AgentProvider | null;
  defaultProvider: AgentProvider;
  pendingFromProvider: AgentProvider | null;
  effectiveProvider: AgentProvider;
}

export function resolveProviderHandoffTransition(
  input: ResolveProviderHandoffTransitionInput,
): ProviderHandoffTransition | null {
  const {
    directiveProvider,
    persistedProvider,
    defaultProvider,
    pendingFromProvider,
    effectiveProvider,
  } = input;
  const activeProvider = persistedProvider ?? defaultProvider;

  if (directiveProvider && directiveProvider !== activeProvider) {
    return {
      fromProvider: activeProvider,
      toProvider: directiveProvider,
    };
  }

  if (!directiveProvider && pendingFromProvider && pendingFromProvider !== effectiveProvider) {
    return {
      fromProvider: pendingFromProvider,
      toProvider: effectiveProvider,
    };
  }

  return null;
}

export interface HandoffContextMessage {
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  provider?: AgentProvider | null;
}

function normalizeLineText(value: string, maxLen = 320): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}...` : compact;
}

export function buildProviderHandoffPrompt(
  transition: ProviderHandoffTransition,
  recentMessages: HandoffContextMessage[],
  maxMessages = 16,
): string {
  const windowMessages = recentMessages
    .filter((m) => m.content && m.content.trim().length > 0)
    .slice(-maxMessages);

  const lines = windowMessages.map((m) => {
    const role = m.sender === '__system__' ? 'system' : (m.is_from_me ? 'assistant' : 'user');
    const providerPart = role === 'assistant' && m.provider ? ` [${m.provider}]` : '';
    const senderName = m.sender_name || role;
    return `[${m.timestamp}] ${role}${providerPart} ${senderName}: ${normalizeLineText(m.content)}`;
  });

  return [
    `<provider_handoff from="${transition.fromProvider}" to="${transition.toProvider}">`,
    '当前会话已切换模型提供商。请延续已有结论、约束与待办，不要重复询问已确认信息。',
    '<recent_context>',
    ...(lines.length > 0 ? lines : ['(empty)']),
    '</recent_context>',
    '</provider_handoff>',
  ].join('\n');
}
