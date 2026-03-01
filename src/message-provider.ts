import type { AgentProvider } from './agent-providers.js';

export function parseMessageProvider(value: unknown): AgentProvider | null {
  return value === 'claude' || value === 'codex' || value === 'gemini'
    ? value
    : null;
}
