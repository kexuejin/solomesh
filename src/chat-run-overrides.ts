import type { AgentProvider } from './agent-providers.js';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ChatRequestedRunOverrides {
  agentRuntimeOverride?: AgentProvider;
  modelOverride?: string;
  reasoningEffort?: ReasoningEffort;
}

const chatRequestedRunOverrides = new Map<string, ChatRequestedRunOverrides>();

function normalizeModelOverride(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function setChatRequestedRunOverrides(
  chatJid: string,
  overrides: ChatRequestedRunOverrides | undefined,
): void {
  if (!chatJid || !overrides) return;

  const next: ChatRequestedRunOverrides = {
    agentRuntimeOverride: overrides.agentRuntimeOverride,
    modelOverride: normalizeModelOverride(overrides.modelOverride),
    reasoningEffort: overrides.reasoningEffort,
  };

  if (!next.agentRuntimeOverride && !next.modelOverride && !next.reasoningEffort) {
    chatRequestedRunOverrides.delete(chatJid);
    return;
  }
  chatRequestedRunOverrides.set(chatJid, next);
}

export function getChatRequestedRunOverrides(
  chatJid: string,
): ChatRequestedRunOverrides | undefined {
  if (!chatJid) return undefined;
  return chatRequestedRunOverrides.get(chatJid);
}
