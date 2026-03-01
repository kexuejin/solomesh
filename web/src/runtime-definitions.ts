export type AgentRuntimeId = 'claude' | 'codex' | 'gemini';

export interface RuntimeCapabilities {
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

export interface RuntimeDefinition {
  id: AgentRuntimeId;
  label: string;
  description: string;
  capabilities: RuntimeCapabilities;
}

export const DEFAULT_RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
  {
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
  {
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
  {
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
];

function isBooleanRecord(input: unknown): input is Record<string, boolean> {
  if (!input || typeof input !== 'object') return false;
  return true;
}

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}

interface RuntimeDefinitionLike {
  id: AgentRuntimeId;
  label?: unknown;
  description?: unknown;
  capabilities?: unknown;
}

function isRuntimeDefinitionLike(input: unknown): input is RuntimeDefinitionLike {
  if (!input || typeof input !== 'object') return false;
  return isAgentRuntimeId((input as { id?: unknown }).id);
}

export function normalizeRuntimeDefinitions(input: unknown): RuntimeDefinition[] {
  if (!Array.isArray(input)) return DEFAULT_RUNTIME_DEFINITIONS;
  const fallbackById = new Map(
    DEFAULT_RUNTIME_DEFINITIONS.map((item) => [item.id, item]),
  );
  const normalized = input
    .filter(isRuntimeDefinitionLike)
    .map((item) => {
      const fallback = fallbackById.get(item.id)!;
      const rawCapabilities = isBooleanRecord(item.capabilities)
        ? item.capabilities
        : {};
      return {
        id: item.id,
        label:
          typeof item.label === 'string' && item.label.trim()
            ? item.label
            : fallback.label,
        description:
          typeof item.description === 'string' ? item.description : fallback.description,
        capabilities: {
          supportsImages:
            typeof rawCapabilities.supportsImages === 'boolean'
              ? rawCapabilities.supportsImages
              : fallback.capabilities.supportsImages,
          supportsMemoryFlush:
            typeof rawCapabilities.supportsMemoryFlush === 'boolean'
              ? rawCapabilities.supportsMemoryFlush
              : fallback.capabilities.supportsMemoryFlush,
          supportsCustomBaseUrl:
            typeof rawCapabilities.supportsCustomBaseUrl === 'boolean'
              ? rawCapabilities.supportsCustomBaseUrl
              : fallback.capabilities.supportsCustomBaseUrl,
          supportsOAuthLogin:
            typeof rawCapabilities.supportsOAuthLogin === 'boolean'
              ? rawCapabilities.supportsOAuthLogin
              : fallback.capabilities.supportsOAuthLogin,
          supportsOfficialAuth:
            typeof rawCapabilities.supportsOfficialAuth === 'boolean'
              ? rawCapabilities.supportsOfficialAuth
              : fallback.capabilities.supportsOfficialAuth,
          supportsThirdPartyGateway:
            typeof rawCapabilities.supportsThirdPartyGateway === 'boolean'
              ? rawCapabilities.supportsThirdPartyGateway
              : fallback.capabilities.supportsThirdPartyGateway,
          supportsModelOverride:
            typeof rawCapabilities.supportsModelOverride === 'boolean'
              ? rawCapabilities.supportsModelOverride
              : fallback.capabilities.supportsModelOverride,
          supportsNativeThinkingStream:
            typeof rawCapabilities.supportsNativeThinkingStream === 'boolean'
              ? rawCapabilities.supportsNativeThinkingStream
              : fallback.capabilities.supportsNativeThinkingStream,
          supportsTaskNotificationSynthesis:
            typeof rawCapabilities.supportsTaskNotificationSynthesis === 'boolean'
              ? rawCapabilities.supportsTaskNotificationSynthesis
              : fallback.capabilities.supportsTaskNotificationSynthesis,
        },
      } satisfies RuntimeDefinition;
    });

  return normalized.length > 0 ? normalized : DEFAULT_RUNTIME_DEFINITIONS;
}
