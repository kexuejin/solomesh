export const AGENT_PROVIDER_IDS = ['claude', 'codex', 'gemini'] as const;

export type AgentProvider = (typeof AGENT_PROVIDER_IDS)[number];

export interface AgentProviderCapabilities {
  supportsImages: boolean;
  supportsMemoryFlush: boolean;
  supportsCustomBaseUrl: boolean;
  supportsOAuthLogin: boolean;
  supportsOfficialAuth: boolean;
  supportsThirdPartyGateway: boolean;
  supportsModelOverride: boolean;
  supportsNativeThinkingStream: boolean;
  supportsTaskNotificationSynthesis: boolean;
}

export interface AgentProviderDefinition {
  id: AgentProvider;
  label: string;
  description: string;
  capabilities: AgentProviderCapabilities;
}

export interface AgentProviderConfigSnapshot {
  anthropicBaseUrl?: string | null;
  anthropicAuthToken?: string | null;
  claudeCodeOauthToken?: string | null;
  claudeOAuthCredentials?: unknown;
  codexApiKey?: string | null;
  geminiApiKey?: string | null;
  geminiAuthMode?: 'api_key' | 'oauth' | null;
}

const PROVIDER_DEFINITIONS: Record<AgentProvider, AgentProviderDefinition> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    description: 'Official Claude Code runtime via Claude Agent SDK.',
    capabilities: {
      supportsImages: true,
      supportsMemoryFlush: true,
      supportsCustomBaseUrl: true,
      supportsOAuthLogin: true,
      supportsOfficialAuth: true,
      supportsThirdPartyGateway: true,
      supportsModelOverride: false,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: true,
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex SDK runtime with MCP integration.',
    capabilities: {
      supportsImages: false,
      supportsMemoryFlush: false,
      supportsCustomBaseUrl: true,
      supportsOAuthLogin: false,
      supportsOfficialAuth: false,
      supportsThirdPartyGateway: false,
      supportsModelOverride: true,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: false,
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    description: 'Google Gemini CLI runtime with MCP integration.',
    capabilities: {
      supportsImages: false,
      supportsMemoryFlush: false,
      supportsCustomBaseUrl: false,
      supportsOAuthLogin: false,
      supportsOfficialAuth: false,
      supportsThirdPartyGateway: false,
      supportsModelOverride: true,
      supportsNativeThinkingStream: false,
      supportsTaskNotificationSynthesis: false,
    },
  },
};

export function normalizeAgentProvider(input: unknown): AgentProvider {
  if (input === 'codex') return 'codex';
  if (input === 'gemini') return 'gemini';
  return 'claude';
}

export function getAgentProviderDefinition(
  provider: AgentProvider,
): AgentProviderDefinition {
  return PROVIDER_DEFINITIONS[provider];
}

export function listAgentProviderDefinitions(): AgentProviderDefinition[] {
  return AGENT_PROVIDER_IDS.map((id) => PROVIDER_DEFINITIONS[id]);
}

function hasValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : !!value;
}

function hasApiKeyValue(value: unknown): boolean {
  if (typeof value !== 'string') return !!value;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return false;
    }
  } catch {
    // non-url string, treat as key
  }
  return true;
}

export function isAgentProviderConfigured(
  provider: AgentProvider,
  config: AgentProviderConfigSnapshot,
): boolean {
  switch (provider) {
    case 'codex':
      return hasApiKeyValue(config.codexApiKey);
    case 'gemini':
      if (config.geminiAuthMode === 'oauth') return true;
      return hasApiKeyValue(config.geminiApiKey);
    case 'claude': {
      const officialConfigured =
        hasValue(config.claudeCodeOauthToken) || !!config.claudeOAuthCredentials;
      const thirdPartyConfigured =
        hasValue(config.anthropicBaseUrl) && hasValue(config.anthropicAuthToken);
      return officialConfigured || thirdPartyConfigured;
    }
    default:
      return false;
  }
}

export function getAgentProviderConfiguredMap(
  config: AgentProviderConfigSnapshot,
): Record<AgentProvider, boolean> {
  return {
    claude: isAgentProviderConfigured('claude', config),
    codex: isAgentProviderConfigured('codex', config),
    gemini: isAgentProviderConfigured('gemini', config),
  };
}
