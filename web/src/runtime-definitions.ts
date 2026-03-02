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
  supportedModels: string[];
  defaultModel: string;
}

const CLAUDE_MODEL_ALIAS_TO_ID: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

function normalizeRuntimeModelId(runtimeId: AgentRuntimeId, model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return '';
  if (runtimeId !== 'claude') return trimmed;
  return CLAUDE_MODEL_ALIAS_TO_ID[trimmed] ?? trimmed;
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
      supportsModelOverride: true,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: true,
    },
    supportedModels: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-4-6',
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex SDK runtime with MCP integration.',
    capabilities: {
      supportsImages: true,
      supportsMemoryFlush: false,
      supportsCustomBaseUrl: true,
      supportsOAuthLogin: false,
      supportsOfficialAuth: false,
      supportsThirdPartyGateway: false,
      supportsModelOverride: true,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: false,
    },
    supportedModels: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.1-codex-mini'],
    defaultModel: 'gpt-5.3-codex',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Google Gemini SDK runtime (API Key) with MCP integration.',
    capabilities: {
      supportsImages: true,
      supportsMemoryFlush: false,
      supportsCustomBaseUrl: true,
      supportsOAuthLogin: false,
      supportsOfficialAuth: false,
      supportsThirdPartyGateway: false,
      supportsModelOverride: true,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: false,
    },
    supportedModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-pro',
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
  supportedModels?: unknown;
  defaultModel?: unknown;
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
        supportedModels: (() => {
          const models = Array.isArray(item.supportedModels)
            ? item.supportedModels
              .filter((model): model is string => typeof model === 'string')
              .map((model) => normalizeRuntimeModelId(item.id, model))
              .filter((model) => model.length > 0)
            : [];
          if (models.length > 0) return Array.from(new Set(models));
          return fallback.supportedModels;
        })(),
        defaultModel:
          typeof item.defaultModel === 'string' && item.defaultModel.trim().length > 0
            ? normalizeRuntimeModelId(item.id, item.defaultModel)
            : fallback.defaultModel,
      } satisfies RuntimeDefinition;
    });

  return normalized.length > 0 ? normalized : DEFAULT_RUNTIME_DEFINITIONS;
}
