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

export interface ProviderHandoffContextSourceMessage extends HandoffContextMessage {
  id?: string;
}

export function resolveHandoffContextBeforeTimestamp(
  fallbackBefore: string | undefined,
  pendingMessages: Array<{ timestamp: string }>,
): string | undefined {
  const firstPendingTimestamp = pendingMessages[0]?.timestamp;
  return firstPendingTimestamp && firstPendingTimestamp.length > 0
    ? firstPendingTimestamp
    : fallbackBefore;
}

export function selectProviderHandoffContextMessages(
  recentMessages: ProviderHandoffContextSourceMessage[],
  pendingMessageIds: Iterable<string>,
  maxMessages = 24,
): HandoffContextMessage[] {
  const pendingSet = new Set<string>();
  for (const id of pendingMessageIds) {
    if (typeof id === 'string' && id.length > 0) pendingSet.add(id);
  }

  return recentMessages
    .filter((message) => {
      const messageId = typeof message.id === 'string' ? message.id : '';
      return !pendingSet.has(messageId);
    })
    .map((message) => ({
      sender: message.sender,
      sender_name: message.sender_name,
      content: message.content,
      timestamp: message.timestamp,
      is_from_me: message.is_from_me,
      provider: message.provider ?? null,
    }))
    .slice(-maxMessages);
}

function normalizeLineText(value: string, maxLen = 320): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}...` : compact;
}

const HANDOFF_ERROR_HINT_RE = /\b(error|failed|failure|retry|timeout|unauthorized|forbidden|429|401)\b|失败|报错|超时|重试|未授权/i;

function buildHandoffHistorySummaryLines(
  recentMessages: HandoffContextMessage[],
): string[] {
  const messages = recentMessages.filter((m) => m.content && m.content.trim().length > 0);
  const users = messages.filter((m) => !m.is_from_me && m.sender !== '__system__');
  const assistants = messages.filter((m) => m.is_from_me);
  const lines: string[] = [];

  const latestUser = users[users.length - 1];
  if (latestUser) {
    lines.push(`- 最近用户诉求: ${normalizeLineText(latestUser.content, 180)}`);
  }

  const latestAssistant = assistants[assistants.length - 1];
  if (latestAssistant) {
    const providerPart = latestAssistant.provider ? ` [${latestAssistant.provider}]` : '';
    lines.push(
      `- 最近助手结论${providerPart}: ${normalizeLineText(latestAssistant.content, 180)}`,
    );
  }

  const previousAssistant = assistants[assistants.length - 2];
  if (previousAssistant) {
    const providerPart = previousAssistant.provider ? ` [${previousAssistant.provider}]` : '';
    lines.push(
      `- 上一条助手补充${providerPart}: ${normalizeLineText(previousAssistant.content, 140)}`,
    );
  }

  const latestErrorHint = [...messages]
    .reverse()
    .find((m) => HANDOFF_ERROR_HINT_RE.test(m.content));
  if (
    latestErrorHint
    && latestErrorHint.content !== latestAssistant?.content
    && latestErrorHint.content !== previousAssistant?.content
  ) {
    lines.push(`- 最近异常线索: ${normalizeLineText(latestErrorHint.content, 140)}`);
  }

  if (lines.length === 0) return ['- 暂无可用历史摘要'];
  return lines.slice(0, 4);
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
  const summaryLines = buildHandoffHistorySummaryLines(windowMessages);

  return [
    `<provider_handoff from="${transition.fromProvider}" to="${transition.toProvider}">`,
    '当前会话已切换模型提供商。请延续已有结论、约束与待办，不要重复询问已确认信息。',
    '<history_summary>',
    ...summaryLines,
    '</history_summary>',
    '<recent_context>',
    ...(lines.length > 0 ? lines : ['(empty)']),
    '</recent_context>',
    '</provider_handoff>',
  ].join('\n');
}
