export function getMessageProviderLabel(provider: unknown): string | null {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return null;
}
