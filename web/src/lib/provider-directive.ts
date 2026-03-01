export type ProviderId = 'claude' | 'codex' | 'gemini';

const PROVIDER_DIRECTIVE_RE =
  /^\s*@(?<provider>codex|claude|gemini)\b(?:\s+|[,:：-]\s*)?/i;

export interface ProviderDirectiveInputResult {
  provider: ProviderId | null;
  hasDirective: boolean;
  contentForPrompt: string;
  isDirectiveOnly: boolean;
}

export function parseProviderDirectiveInput(
  content: string,
): ProviderDirectiveInputResult {
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
  const provider: ProviderId | null =
    providerRaw === 'claude' || providerRaw === 'codex' || providerRaw === 'gemini'
      ? providerRaw
      : null;
  const stripped = content.slice(match[0].length).trimStart();

  return {
    provider,
    hasDirective: provider !== null,
    contentForPrompt: stripped,
    isDirectiveOnly: provider !== null && stripped.trim().length === 0,
  };
}

export function isProviderDirectiveOnly(content: string): boolean {
  return parseProviderDirectiveInput(content).isDirectiveOnly;
}

export function getProviderMentionSuggestions(input: {
  query: string;
  currentProvider?: ProviderId | null;
}): ProviderId[] {
  const q = input.query.trim().toLowerCase();
  const providers: ProviderId[] = ['claude', 'codex', 'gemini'];
  return providers.filter((provider) => {
    if (input.currentProvider && provider === input.currentProvider) {
      return false;
    }
    if (!q) return true;
    return provider.startsWith(q);
  });
}
