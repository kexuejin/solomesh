import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  supportedModels: string[];
  defaultModel: string;
}

export interface AgentProviderConfigSnapshot {
  anthropicBaseUrl?: string | null;
  anthropicAuthToken?: string | null;
  claudeCodeOauthToken?: string | null;
  claudeOAuthCredentials?: unknown;
  codexBaseUrl?: string | null;
  codexApiKey?: string | null;
  codexModel?: string | null;
  geminiBaseUrl?: string | null;
  geminiApiKey?: string | null;
  geminiModel?: string | null;
  geminiAuthMode?: 'api_key' | 'oauth' | null;
}

type AgentProviderStaticDefinition = Omit<
  AgentProviderDefinition,
  'supportedModels' | 'defaultModel'
>;

const DEFAULT_SUPPORTED_MODELS: Record<AgentProvider, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  codex: ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.1-codex-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
};

const CLAUDE_MODEL_ALIAS_TO_ID: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};
const CLAUDE_DYNAMIC_MODELS_CACHE_TTL_MS = 30 * 60 * 1000;
const CLAUDE_DYNAMIC_MODELS_FETCH_TIMEOUT_MS = 6000;
const CODEX_DYNAMIC_MODELS_CACHE_TTL_MS = 30 * 60 * 1000;
const CODEX_DYNAMIC_MODELS_FETCH_TIMEOUT_MS = 6000;
const GEMINI_DYNAMIC_MODELS_CACHE_TTL_MS = 30 * 60 * 1000;
const GEMINI_DYNAMIC_MODELS_FETCH_TIMEOUT_MS = 6000;
const DYNAMIC_MODELS_FAILURE_RETRY_MS = 5 * 60 * 1000;
const CLAUDE_DYNAMIC_DEBUG_LOG_FILE = join(
  tmpdir(),
  'solomesh-claude-agent-sdk',
  'runtime-models.log',
);

interface ClaudeDynamicModelsCacheState {
  models: string[];
  updatedAt: number;
}

interface ProviderDynamicModelsCacheState {
  models: string[];
  updatedAt: number;
  configSignature: string;
}

interface ProviderDynamicModelsInFlightState {
  configSignature: string;
  promise: Promise<string[] | null>;
}

let claudeDynamicModelsCache: ClaudeDynamicModelsCacheState | null = null;
let claudeDynamicModelsRefreshInFlight: Promise<string[] | null> | null = null;
let codexDynamicModelsCache: ProviderDynamicModelsCacheState | null = null;
let codexDynamicModelsRefreshInFlight: ProviderDynamicModelsInFlightState | null = null;
let geminiDynamicModelsCache: ProviderDynamicModelsCacheState | null = null;
let geminiDynamicModelsRefreshInFlight: ProviderDynamicModelsInFlightState | null = null;
let claudeDynamicModelsLastFailureAt = 0;
let codexDynamicModelsLastFailure:
  | { updatedAt: number; configSignature: string }
  | null = null;
let geminiDynamicModelsLastFailure:
  | { updatedAt: number; configSignature: string }
  | null = null;

const PROVIDER_DEFINITIONS: Record<AgentProvider, AgentProviderStaticDefinition> = {
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
      supportsModelOverride: true,
      supportsNativeThinkingStream: true,
      supportsTaskNotificationSynthesis: true,
    },
  },
  codex: {
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
  },
  gemini: {
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
  },
};

function resolveCapabilities(
  provider: AgentProvider,
  _config?: AgentProviderConfigSnapshot,
): AgentProviderCapabilities {
  return PROVIDER_DEFINITIONS[provider].capabilities;
}

function normalizeModelValue(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSupportedModels(
  provider: AgentProvider,
  config?: AgentProviderConfigSnapshot,
): string[] {
  const defaults = DEFAULT_SUPPORTED_MODELS[provider];
  const configuredModel =
    provider === 'codex'
      ? normalizeModelValue(config?.codexModel)
      : provider === 'gemini'
        ? normalizeModelValue(config?.geminiModel)
        : null;
  if (!configuredModel || defaults.includes(configuredModel)) {
    return [...defaults];
  }
  return [configuredModel, ...defaults];
}

function resolveDefaultModel(
  provider: AgentProvider,
  config?: AgentProviderConfigSnapshot,
): string {
  const configuredModel =
    provider === 'codex'
      ? normalizeModelValue(config?.codexModel)
      : provider === 'gemini'
        ? normalizeModelValue(config?.geminiModel)
        : null;
  if (configuredModel) return configuredModel;
  return DEFAULT_SUPPORTED_MODELS[provider][0];
}

function normalizeClaudeModelId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = (CLAUDE_MODEL_ALIAS_TO_ID[trimmed] ?? trimmed).toLowerCase();
  if (!normalized.startsWith('claude-')) return null;
  return normalized;
}

function normalizeClaudeModelIds(inputs: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const model = normalizeClaudeModelId(input);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

function buildDynamicModelsConfigSignature(
  baseUrl: string | null | undefined,
  apiKey: string,
): string {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  return `${normalizedBaseUrl}\n${apiKey}`;
}

function normalizeCodexModelId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const model = input.trim().toLowerCase();
  if (!model) return null;
  if (
    /embedding|moderation|whisper|tts|transcrib|realtime|search|image|audio/i.test(
      model,
    )
  ) {
    return null;
  }
  if (
    !model.includes('codex')
    && !model.startsWith('gpt-')
    && !/^o[0-9]/i.test(model)
  ) {
    return null;
  }
  return model;
}

function normalizeCodexModelIds(inputs: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const model = normalizeCodexModelId(input);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

function normalizeGeminiModelId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let normalized = trimmed;
  const modelsSeg = '/models/';
  const modelsIndex = normalized.lastIndexOf(modelsSeg);
  if (modelsIndex >= 0) {
    normalized = normalized.slice(modelsIndex + modelsSeg.length);
  } else if (normalized.startsWith('models/')) {
    normalized = normalized.slice('models/'.length);
  } else if (normalized.includes('/')) {
    normalized = normalized.split('/').pop() ?? normalized;
  }
  if (!normalized.startsWith('gemini-')) return null;
  if (/embedding|aqa|vision|tts|lyria|realtime/i.test(normalized)) return null;
  return normalized;
}

function normalizeGeminiModelIds(inputs: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const model = normalizeGeminiModelId(input);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

function buildCodexModelsEndpoint(baseUrl: string | null | undefined): URL {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!trimmed) {
    return new URL('https://api.openai.com/v1/models');
  }
  const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  try {
    return new URL('models', normalized);
  } catch {
    return new URL('https://api.openai.com/v1/models');
  }
}

function buildGeminiModelsEndpoint(baseUrl: string | null | undefined): URL {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!trimmed) {
    return new URL('https://generativelanguage.googleapis.com/v1beta/models');
  }
  const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  try {
    return new URL('models', normalized);
  } catch {
    return new URL('https://generativelanguage.googleapis.com/v1beta/models');
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function fetchClaudeModelsFromSdk(): Promise<string[] | null> {
  let activeQuery:
    | {
      supportedModels: () => Promise<Array<{ value?: string }>>;
      close: () => void;
    }
    | null = null;
  try {
    try {
      if (!process.env.CLAUDE_CODE_DEBUG_LOGS_DIR) {
        mkdirSync(join(tmpdir(), 'solomesh-claude-agent-sdk'), { recursive: true });
        process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = CLAUDE_DYNAMIC_DEBUG_LOG_FILE;
      }
    } catch {
      // best effort
    }
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    async function* emptyPrompt(): AsyncGenerator<never, void, void> {
      return;
    }
    activeQuery = sdk.query({
      prompt: emptyPrompt(),
      options: {
        permissionMode: 'plan',
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        debug: false,
        env: {
          ...process.env,
          CLAUDE_CODE_DEBUG_LOGS_DIR:
            process.env.CLAUDE_CODE_DEBUG_LOGS_DIR || CLAUDE_DYNAMIC_DEBUG_LOG_FILE,
        },
      },
    }) as {
      supportedModels: () => Promise<Array<{ value?: string }>>;
      close: () => void;
    };
    const modelInfos = await withTimeout(
      activeQuery.supportedModels(),
      CLAUDE_DYNAMIC_MODELS_FETCH_TIMEOUT_MS,
    );
    const models = normalizeClaudeModelIds(
      modelInfos.map((item) => item?.value ?? ''),
    );
    return models.length > 0 ? models : null;
  } catch {
    return null;
  } finally {
    try {
      activeQuery?.close();
    } catch {
      // best effort
    }
  }
}

async function fetchCodexModelsFromApi(
  codexBaseUrl: string | null | undefined,
  codexApiKey: string,
): Promise<string[] | null> {
  const endpoint = buildCodexModelsEndpoint(codexBaseUrl);
  const response = await withTimeout(
    fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${codexApiKey}`,
      },
    }),
    CODEX_DYNAMIC_MODELS_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const payload = await withTimeout(
    response.json() as Promise<{ data?: Array<{ id?: string }> }>,
    CODEX_DYNAMIC_MODELS_FETCH_TIMEOUT_MS,
  );
  const models = normalizeCodexModelIds(
    Array.isArray(payload?.data) ? payload.data.map((item) => item?.id ?? '') : [],
  );
  return models.length > 0 ? models : null;
}

async function fetchGeminiModelsFromApi(
  geminiBaseUrl: string | null | undefined,
  geminiApiKey: string,
): Promise<string[] | null> {
  const endpoint = buildGeminiModelsEndpoint(geminiBaseUrl);
  endpoint.searchParams.set('key', geminiApiKey);
  const response = await withTimeout(
    fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-goog-api-key': geminiApiKey,
      },
    }),
    GEMINI_DYNAMIC_MODELS_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const payload = await withTimeout(
    response.json() as Promise<{ models?: Array<{ name?: string }> }>,
    GEMINI_DYNAMIC_MODELS_FETCH_TIMEOUT_MS,
  );
  const models = normalizeGeminiModelIds(
    Array.isArray(payload?.models)
      ? payload.models.map((item) => item?.name ?? '')
      : [],
  );
  return models.length > 0 ? models : null;
}

async function refreshClaudeDynamicModelsCache(): Promise<string[] | null> {
  try {
    const models = await fetchClaudeModelsFromSdk();
    if (models && models.length > 0) {
      claudeDynamicModelsCache = {
        models,
        updatedAt: Date.now(),
      };
      claudeDynamicModelsLastFailureAt = 0;
      return models;
    }
    claudeDynamicModelsLastFailureAt = Date.now();
    return null;
  } finally {
    claudeDynamicModelsRefreshInFlight = null;
  }
}

async function refreshCodexDynamicModelsCache(
  codexBaseUrl: string | null | undefined,
  codexApiKey: string,
  configSignature: string,
): Promise<string[] | null> {
  try {
    const models = await fetchCodexModelsFromApi(codexBaseUrl, codexApiKey);
    if (models && models.length > 0) {
      codexDynamicModelsCache = {
        models,
        updatedAt: Date.now(),
        configSignature,
      };
      codexDynamicModelsLastFailure = null;
      return models;
    }
    codexDynamicModelsLastFailure = {
      updatedAt: Date.now(),
      configSignature,
    };
    return null;
  } catch {
    codexDynamicModelsLastFailure = {
      updatedAt: Date.now(),
      configSignature,
    };
    return null;
  } finally {
    if (codexDynamicModelsRefreshInFlight?.configSignature === configSignature) {
      codexDynamicModelsRefreshInFlight = null;
    }
  }
}

async function refreshGeminiDynamicModelsCache(
  geminiBaseUrl: string | null | undefined,
  geminiApiKey: string,
  configSignature: string,
): Promise<string[] | null> {
  try {
    const models = await fetchGeminiModelsFromApi(geminiBaseUrl, geminiApiKey);
    if (models && models.length > 0) {
      geminiDynamicModelsCache = {
        models,
        updatedAt: Date.now(),
        configSignature,
      };
      geminiDynamicModelsLastFailure = null;
      return models;
    }
    geminiDynamicModelsLastFailure = {
      updatedAt: Date.now(),
      configSignature,
    };
    return null;
  } catch {
    geminiDynamicModelsLastFailure = {
      updatedAt: Date.now(),
      configSignature,
    };
    return null;
  } finally {
    if (geminiDynamicModelsRefreshInFlight?.configSignature === configSignature) {
      geminiDynamicModelsRefreshInFlight = null;
    }
  }
}

async function getClaudeDynamicModelsCached(): Promise<string[] | null> {
  const now = Date.now();
  const cache = claudeDynamicModelsCache;
  const hasFreshCache =
    !!cache && now - cache.updatedAt < CLAUDE_DYNAMIC_MODELS_CACHE_TTL_MS;
  if (hasFreshCache) {
    return cache.models;
  }
  const hasRecentFailure =
    claudeDynamicModelsLastFailureAt > 0
    && now - claudeDynamicModelsLastFailureAt < DYNAMIC_MODELS_FAILURE_RETRY_MS;
  if (hasRecentFailure) {
    return cache ? cache.models : null;
  }

  if (cache && !claudeDynamicModelsRefreshInFlight) {
    claudeDynamicModelsRefreshInFlight = refreshClaudeDynamicModelsCache();
  }
  if (cache) {
    // stale-while-revalidate
    return cache.models;
  }

  if (!claudeDynamicModelsRefreshInFlight) {
    claudeDynamicModelsRefreshInFlight = refreshClaudeDynamicModelsCache();
  }
  return await claudeDynamicModelsRefreshInFlight;
}

async function getCodexDynamicModelsCached(
  config?: AgentProviderConfigSnapshot,
): Promise<string[] | null> {
  if (!hasApiKeyValue(config?.codexApiKey)) return null;
  const apiKey = config?.codexApiKey?.trim() || '';
  if (!apiKey) return null;
  const configSignature = buildDynamicModelsConfigSignature(
    config?.codexBaseUrl,
    apiKey,
  );
  const now = Date.now();
  const cache = codexDynamicModelsCache;
  const hasFreshCache =
    !!cache
    && cache.configSignature === configSignature
    && now - cache.updatedAt < CODEX_DYNAMIC_MODELS_CACHE_TTL_MS;
  if (hasFreshCache) return cache.models;
  const hasRecentFailure =
    !!codexDynamicModelsLastFailure
    && codexDynamicModelsLastFailure.configSignature === configSignature
    && now - codexDynamicModelsLastFailure.updatedAt < DYNAMIC_MODELS_FAILURE_RETRY_MS;
  if (hasRecentFailure) {
    return cache && cache.configSignature === configSignature ? cache.models : null;
  }

  if (cache && cache.configSignature === configSignature) {
    if (
      !codexDynamicModelsRefreshInFlight
      || codexDynamicModelsRefreshInFlight.configSignature !== configSignature
    ) {
      codexDynamicModelsRefreshInFlight = {
        configSignature,
        promise: refreshCodexDynamicModelsCache(
          config?.codexBaseUrl,
          apiKey,
          configSignature,
        ),
      };
    }
    // stale-while-revalidate
    return cache.models;
  }

  if (
    !codexDynamicModelsRefreshInFlight
    || codexDynamicModelsRefreshInFlight.configSignature !== configSignature
  ) {
    codexDynamicModelsRefreshInFlight = {
      configSignature,
      promise: refreshCodexDynamicModelsCache(
        config?.codexBaseUrl,
        apiKey,
        configSignature,
      ),
    };
  }
  return await codexDynamicModelsRefreshInFlight.promise;
}

async function getGeminiDynamicModelsCached(
  config?: AgentProviderConfigSnapshot,
): Promise<string[] | null> {
  if (!hasApiKeyValue(config?.geminiApiKey)) return null;
  const apiKey = config?.geminiApiKey?.trim() || '';
  if (!apiKey) return null;
  const configSignature = buildDynamicModelsConfigSignature(
    config?.geminiBaseUrl,
    apiKey,
  );
  const now = Date.now();
  const cache = geminiDynamicModelsCache;
  const hasFreshCache =
    !!cache
    && cache.configSignature === configSignature
    && now - cache.updatedAt < GEMINI_DYNAMIC_MODELS_CACHE_TTL_MS;
  if (hasFreshCache) return cache.models;
  const hasRecentFailure =
    !!geminiDynamicModelsLastFailure
    && geminiDynamicModelsLastFailure.configSignature === configSignature
    && now - geminiDynamicModelsLastFailure.updatedAt < DYNAMIC_MODELS_FAILURE_RETRY_MS;
  if (hasRecentFailure) {
    return cache && cache.configSignature === configSignature ? cache.models : null;
  }

  if (cache && cache.configSignature === configSignature) {
    if (
      !geminiDynamicModelsRefreshInFlight
      || geminiDynamicModelsRefreshInFlight.configSignature !== configSignature
    ) {
      geminiDynamicModelsRefreshInFlight = {
        configSignature,
        promise: refreshGeminiDynamicModelsCache(
          config?.geminiBaseUrl,
          apiKey,
          configSignature,
        ),
      };
    }
    // stale-while-revalidate
    return cache.models;
  }

  if (
    !geminiDynamicModelsRefreshInFlight
    || geminiDynamicModelsRefreshInFlight.configSignature !== configSignature
  ) {
    geminiDynamicModelsRefreshInFlight = {
      configSignature,
      promise: refreshGeminiDynamicModelsCache(
        config?.geminiBaseUrl,
        apiKey,
        configSignature,
      ),
    };
  }
  return await geminiDynamicModelsRefreshInFlight.promise;
}

function mergeDynamicModelsForProvider(
  definitions: AgentProviderDefinition[],
  provider: AgentProvider,
  dynamicModels: string[] | null,
): AgentProviderDefinition[] {
  if (!dynamicModels || dynamicModels.length === 0) return definitions;
  return definitions.map((definition) => {
    if (definition.id !== provider) return definition;
    const merged = Array.from(
      new Set([
        ...dynamicModels,
        ...definition.supportedModels,
      ]),
    );
    return {
      ...definition,
      supportedModels: merged,
      defaultModel: merged.includes(definition.defaultModel)
        ? definition.defaultModel
        : merged[0],
    };
  });
}

export function normalizeAgentProvider(input: unknown): AgentProvider {
  if (input === 'codex') return 'codex';
  if (input === 'gemini') return 'gemini';
  return 'claude';
}

export function getAgentProviderDefinition(
  provider: AgentProvider,
  config?: AgentProviderConfigSnapshot,
): AgentProviderDefinition {
  const base = PROVIDER_DEFINITIONS[provider];
  return {
    ...base,
    capabilities: resolveCapabilities(provider, config),
    supportedModels: buildSupportedModels(provider, config),
    defaultModel: resolveDefaultModel(provider, config),
  };
}

export function listAgentProviderDefinitions(
  config?: AgentProviderConfigSnapshot,
): AgentProviderDefinition[] {
  return AGENT_PROVIDER_IDS.map((id) => getAgentProviderDefinition(id, config));
}

export async function listAgentProviderDefinitionsDynamic(
  config?: AgentProviderConfigSnapshot,
): Promise<AgentProviderDefinition[]> {
  const baseDefinitions = listAgentProviderDefinitions(config);
  const [claudeModels, codexModels, geminiModels] = await Promise.all([
    getClaudeDynamicModelsCached(),
    getCodexDynamicModelsCached(config),
    getGeminiDynamicModelsCached(config),
  ]);
  return [claudeModels, codexModels, geminiModels].reduce(
    (definitions, models, idx) => {
      const provider = idx === 0 ? 'claude' : idx === 1 ? 'codex' : 'gemini';
      return mergeDynamicModelsForProvider(definitions, provider, models);
    },
    baseDefinitions,
  );
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
