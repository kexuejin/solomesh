import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  AGENT_PROVIDER_IDS,
  getAgentProviderDefinition,
  normalizeAgentProvider,
  type AgentProvider,
} from './agent-providers.js';
import { APP_NAME, DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { getPrimaryMemoryFileName } from './memory-file-alias.js';

const MAX_FIELD_LENGTH = 2000;
const CURRENT_CONFIG_VERSION = 3;

const RUNTIME_CONFIG_DIR = path.join(DATA_DIR, 'config');
const PROVIDER_CONFIG_FILE = path.join(RUNTIME_CONFIG_DIR, 'runtime-config.json');
const PROVIDER_CONFIG_KEY_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'runtime-config.key',
);
const PROVIDER_CONFIG_AUDIT_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'runtime-config.audit.log',
);
const PROVIDER_CUSTOM_ENV_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'runtime-custom-env.json',
);
const GEMINI_OAUTH_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'gemini-oauth.json',
);
const FEISHU_CONFIG_FILE = path.join(RUNTIME_CONFIG_DIR, 'feishu-provider.json');
const TELEGRAM_CONFIG_FILE = path.join(RUNTIME_CONFIG_DIR, 'telegram-provider.json');
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_PROVIDER_ENV_KEYS = new Set([
  'AGENT_RUNTIME',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_MODEL',
  'CODEX_HOME',
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_AUTH_MODE',
  'GEMINI_CLI_HOME',
  'SOLOMESH_PRIMARY_MEMORY_FILE_NAME',
  'SOLOMESH_RUNTIME_LABEL',
  'SOLOMESH_CAP_SUPPORTS_MEMORY_FLUSH',
  'SOLOMESH_CAP_SUPPORTS_NATIVE_THINKING_STREAM',
  'SOLOMESH_CAP_SUPPORTS_TASK_NOTIFICATION_SYNTHESIS',
]);
const DANGEROUS_ENV_VARS = new Set([
  // Code execution / preload attacks
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS',
  'JAVA_TOOL_OPTIONS',
  'PERL5OPT',
  // Path manipulation
  'PATH',
  'PYTHONPATH',
  'RUBYLIB',
  'PERL5LIB',
  'GIT_EXEC_PATH',
  'CDPATH',
  // Shell behavior
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'ZDOTDIR',
  // Editor / terminal (可被利用执行命令)
  'EDITOR',
  'VISUAL',
  'PAGER',
  // SSH / Git（防止凭据泄露或命令注入）
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  // Sensitive directories
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  // SoloMesh 内部路径映射
  'SOLOMESH_WORKSPACE_GROUP',
  'SOLOMESH_WORKSPACE_GLOBAL',
  'SOLOMESH_WORKSPACE_MEMORY',
  'SOLOMESH_WORKSPACE_IPC',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'GEMINI_CLI_HOME',
]);
const MAX_CUSTOM_ENV_ENTRIES = 50;

export interface RuntimeOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms)
  scopes: string[];
}

export interface GeminiOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  tokenType: string;
  scope: string;
}

export type GeminiAuthMode = 'api_key' | 'oauth';
export type RuntimeSecretSource = 'runtime' | 'env' | 'none';

export type { AgentProvider } from './agent-providers.js';

export interface RuntimeProviderConfig {
  agentRuntime: AgentProvider;
  anthropicBaseUrl: string;
  codexBaseUrl: string;
  codexModel: string;
  geminiBaseUrl: string;
  geminiModel: string;
  geminiAuthMode: GeminiAuthMode;
  anthropicAuthToken: string;
  anthropicApiKey: string;
  claudeCodeOauthToken: string;
  codexApiKey: string;
  geminiApiKey: string;
  claudeOAuthCredentials: RuntimeOAuthCredentials | null;
  updatedAt: string | null;
}

export interface RuntimeProviderPublicConfig {
  agentRuntime: AgentProvider;
  anthropicBaseUrl: string;
  codexBaseUrl: string;
  codexModel: string;
  geminiBaseUrl: string;
  geminiModel: string;
  geminiAuthMode: GeminiAuthMode;
  updatedAt: string | null;
  hasAnthropicAuthToken: boolean;
  hasAnthropicApiKey: boolean;
  hasClaudeCodeOauthToken: boolean;
  hasCodexApiKey: boolean;
  hasGeminiApiKey: boolean;
  hasGeminiOAuthCredentials: boolean;
  anthropicAuthTokenMasked: string | null;
  anthropicApiKeyMasked: string | null;
  claudeCodeOauthTokenMasked: string | null;
  codexApiKeyMasked: string | null;
  geminiApiKeyMasked: string | null;
  codexApiKeySource: RuntimeSecretSource;
  geminiApiKeySource: RuntimeSecretSource;
  codexApiKeyDegraded: boolean;
  geminiApiKeyDegraded: boolean;
  hasRuntimeOAuthCredentials: boolean;
  claudeOAuthCredentialsExpiresAt: number | null;
  claudeOAuthCredentialsAccessTokenMasked: string | null;
}

export interface FeishuProviderConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export type FeishuConfigSource = 'runtime' | 'env' | 'none';

export interface FeishuProviderPublicConfig {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  enabled: boolean;
  updatedAt: string | null;
  source: FeishuConfigSource;
}

export interface TelegramProviderConfig {
  botToken: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export type TelegramConfigSource = 'runtime' | 'env' | 'none';

export interface TelegramProviderPublicConfig {
  hasBotToken: boolean;
  botTokenMasked: string | null;
  enabled: boolean;
  updatedAt: string | null;
  source: TelegramConfigSource;
}

interface SecretPayload {
  anthropicAuthToken: string;
  anthropicApiKey: string;
  claudeCodeOauthToken: string;
  codexApiKey: string;
  geminiApiKey: string;
  claudeOAuthCredentials?: RuntimeOAuthCredentials | null;
}

interface EncryptedSecrets {
  iv: string;
  tag: string;
  data: string;
}

interface FeishuSecretPayload {
  appSecret: string;
}

interface TelegramSecretPayload {
  botToken: string;
}

interface StoredFeishuProviderConfigV1 {
  version: 1;
  appId: string;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface StoredTelegramProviderConfigV1 {
  version: 1;
  enabled?: boolean;
  updatedAt: string;
  secret: EncryptedSecrets;
}

interface StoredRuntimeProviderConfigV3 {
  version: 3;
  agentRuntime: AgentProvider;
  anthropicBaseUrl: string;
  codexBaseUrl: string;
  codexModel: string;
  geminiBaseUrl?: string;
  geminiModel: string;
  geminiAuthMode?: GeminiAuthMode;
  updatedAt: string;
  secrets: EncryptedSecrets;
}

interface RuntimeConfigAuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  changedFields: string[];
  metadata?: Record<string, unknown>;
}

function normalizeSecret(input: unknown, fieldName: string): string {
  if (typeof input !== 'string') {
    throw new Error(`Invalid field: ${fieldName}`);
  }
  // Strip ALL whitespace — API keys/tokens never contain spaces;
  // users often paste with accidental spaces or line breaks.
  const value = input.replace(/\s+/g, '');
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error(`Field too long: ${fieldName}`);
  }
  return value;
}

function normalizeBaseUrl(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: anthropicBaseUrl');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: anthropicBaseUrl');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid field: anthropicBaseUrl');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid field: anthropicBaseUrl');
  }
  return value;
}

function normalizeCodexBaseUrl(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: codexBaseUrl');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: codexBaseUrl');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid field: codexBaseUrl');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid field: codexBaseUrl');
  }

  // Codex SDK internally appends `/responses`.
  // If users paste a full responses endpoint (e.g. .../responses),
  // requests become .../responses/responses and fail with 404.
  let pathname = parsed.pathname.replace(/\/+$/, '');
  while (pathname.endsWith('/responses')) {
    pathname = pathname.slice(0, -'/responses'.length);
  }
  if (!pathname) pathname = '/';
  parsed.pathname = pathname;

  return parsed.toString().replace(/\/+$/, '');
}

function normalizeGeminiBaseUrl(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: geminiBaseUrl');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: geminiBaseUrl');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid field: geminiBaseUrl');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid field: geminiBaseUrl');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeCodexModel(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: codexModel');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: codexModel');
  }
  return value;
}

function normalizeGeminiModel(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: geminiModel');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: geminiModel');
  }
  return value;
}

function isHttpUrlLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeApiKeyValue(value: string): string {
  const sanitized = sanitizeEnvValue(value).trim();
  if (!sanitized) return '';
  if (isHttpUrlLike(sanitized)) return '';
  return sanitized;
}

function resolveApiKeyWithSource(
  runtimeValue: string,
  envValue: string,
): {
  value: string;
  source: RuntimeSecretSource;
  degraded: boolean;
} {
  const runtimeTrimmed = sanitizeEnvValue(runtimeValue).trim();
  const runtimeValid = normalizeApiKeyValue(runtimeTrimmed);
  if (runtimeValid) {
    return { value: runtimeValid, source: 'runtime', degraded: false };
  }
  const envValid = normalizeApiKeyValue(envValue);
  if (envValid) {
    return {
      value: envValid,
      source: 'env',
      degraded: runtimeTrimmed.length > 0,
    };
  }
  return {
    value: '',
    source: 'none',
    degraded: runtimeTrimmed.length > 0,
  };
}

function pickPreferredValue(primary: string, fallback: string): string {
  const preferred = sanitizeEnvValue(primary).trim();
  if (preferred) return preferred;
  return sanitizeEnvValue(fallback).trim();
}

/**
 * Resolve effective runtime config with environment fallback.
 * Priority: explicit config value > process env fallback.
 * URL-like API keys are treated as invalid and ignored.
 */
export function resolveRuntimeProviderConfigWithEnvFallback(
  config: RuntimeProviderConfig,
  envFallbackConfig?: RuntimeProviderConfig,
): RuntimeProviderConfig {
  const fallback = envFallbackConfig ?? defaultsFromEnv();
  const resolvedCodexApiKey = resolveApiKeyWithSource(
    config.codexApiKey,
    fallback.codexApiKey,
  );
  const resolvedGeminiApiKey = resolveApiKeyWithSource(
    config.geminiApiKey,
    fallback.geminiApiKey,
  );
  const resolved: RuntimeProviderConfig = {
    agentRuntime: config.agentRuntime,
    anthropicBaseUrl: pickPreferredValue(
      config.anthropicBaseUrl,
      fallback.anthropicBaseUrl,
    ),
    codexBaseUrl: pickPreferredValue(config.codexBaseUrl, fallback.codexBaseUrl),
    codexModel: pickPreferredValue(config.codexModel, fallback.codexModel),
    geminiBaseUrl: pickPreferredValue(
      config.geminiBaseUrl,
      fallback.geminiBaseUrl,
    ),
    geminiModel: pickPreferredValue(config.geminiModel, fallback.geminiModel),
    geminiAuthMode: config.geminiAuthMode,
    anthropicAuthToken: pickPreferredValue(
      config.anthropicAuthToken,
      fallback.anthropicAuthToken,
    ),
    anthropicApiKey: pickPreferredValue(
      config.anthropicApiKey,
      fallback.anthropicApiKey,
    ),
    claudeCodeOauthToken: pickPreferredValue(
      config.claudeCodeOauthToken,
      fallback.claudeCodeOauthToken,
    ),
    codexApiKey: resolvedCodexApiKey.value,
    geminiApiKey: resolvedGeminiApiKey.value,
    claudeOAuthCredentials: config.claudeOAuthCredentials,
    updatedAt: config.updatedAt,
  };
  if (resolved.geminiAuthMode === 'oauth') {
    resolved.geminiApiKey = '';
  }
  return resolved;
}

export function getRuntimeApiKeyAutoRepairPatch(
  config: RuntimeProviderConfig,
  envFallbackConfig?: RuntimeProviderConfig,
): {
  nextConfig: Omit<RuntimeProviderConfig, 'updatedAt'>;
  changedFields: string[];
} {
  const fallback = envFallbackConfig ?? defaultsFromEnv();
  const nextConfig: Omit<RuntimeProviderConfig, 'updatedAt'> = {
    agentRuntime: config.agentRuntime,
    anthropicBaseUrl: config.anthropicBaseUrl,
    codexBaseUrl: config.codexBaseUrl,
    codexModel: config.codexModel,
    geminiBaseUrl: config.geminiBaseUrl,
    geminiModel: config.geminiModel,
    geminiAuthMode: config.geminiAuthMode,
    anthropicAuthToken: config.anthropicAuthToken,
    anthropicApiKey: config.anthropicApiKey,
    claudeCodeOauthToken: config.claudeCodeOauthToken,
    codexApiKey: config.codexApiKey,
    geminiApiKey: config.geminiApiKey,
    claudeOAuthCredentials: config.claudeOAuthCredentials,
  };
  const changedFields: string[] = [];

  const codexCurrent = sanitizeEnvValue(config.codexApiKey).trim();
  const codexCurrentValid = normalizeApiKeyValue(codexCurrent);
  const codexFallbackValid = normalizeApiKeyValue(fallback.codexApiKey);
  if (codexCurrent && !codexCurrentValid && codexFallbackValid) {
    nextConfig.codexApiKey = codexFallbackValid;
    changedFields.push('codexApiKey:auto_repair_from_env');
  }

  if (config.geminiAuthMode === 'api_key') {
    const geminiCurrent = sanitizeEnvValue(config.geminiApiKey).trim();
    const geminiCurrentValid = normalizeApiKeyValue(geminiCurrent);
    const geminiFallbackValid = normalizeApiKeyValue(fallback.geminiApiKey);
    if (geminiCurrent && !geminiCurrentValid && geminiFallbackValid) {
      nextConfig.geminiApiKey = geminiFallbackValid;
      changedFields.push('geminiApiKey:auto_repair_from_env');
    }
  }

  return { nextConfig, changedFields };
}

function normalizeGeminiAuthMode(input: unknown): GeminiAuthMode {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: geminiAuthMode');
  }
  const value = input.trim().toLowerCase();
  if (value === 'api_key' || value === 'oauth') {
    return value;
  }
  throw new Error('Invalid field: geminiAuthMode');
}

function normalizeFeishuAppId(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Invalid field: appId');
  }
  const value = input.trim();
  if (!value) return '';
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: appId');
  }
  return value;
}

function sanitizeCustomEnvMap(
  input: Record<string, string>,
  options?: { skipReservedProviderKeys?: boolean },
): Record<string, string> {
  const entries = Object.entries(input);
  if (entries.length > MAX_CUSTOM_ENV_ENTRIES) {
    throw new Error(
      `customEnv must have at most ${MAX_CUSTOM_ENV_ENTRIES} entries`,
    );
  }

  const out: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (!ENV_KEY_RE.test(key)) {
      throw new Error(`Invalid env key: ${key}`);
    }
    if (
      options?.skipReservedProviderKeys &&
      RESERVED_PROVIDER_ENV_KEYS.has(key)
    ) {
      continue;
    }
    out[key] = sanitizeEnvValue(
      typeof rawValue === 'string' ? rawValue : String(rawValue),
    );
  }
  return out;
}

function normalizeConfig(
  input: Omit<RuntimeProviderConfig, 'updatedAt'>,
): Omit<RuntimeProviderConfig, 'updatedAt'> {
  return {
    agentRuntime: normalizeAgentProvider(input.agentRuntime),
    anthropicBaseUrl: normalizeBaseUrl(input.anthropicBaseUrl),
    codexBaseUrl: normalizeCodexBaseUrl(input.codexBaseUrl),
    codexModel: normalizeCodexModel(input.codexModel),
    geminiBaseUrl: normalizeGeminiBaseUrl(input.geminiBaseUrl),
    geminiModel: normalizeGeminiModel(input.geminiModel),
    geminiAuthMode: normalizeGeminiAuthMode(input.geminiAuthMode),
    anthropicAuthToken: normalizeSecret(
      input.anthropicAuthToken,
      'anthropicAuthToken',
    ),
    anthropicApiKey: normalizeSecret(input.anthropicApiKey, 'anthropicApiKey'),
    claudeCodeOauthToken: normalizeSecret(
      input.claudeCodeOauthToken,
      'claudeCodeOauthToken',
    ),
    codexApiKey: normalizeSecret(input.codexApiKey, 'codexApiKey'),
    geminiApiKey: normalizeSecret(input.geminiApiKey, 'geminiApiKey'),
    claudeOAuthCredentials: input.claudeOAuthCredentials ?? null,
  };
}

function buildConfig(
  input: Omit<RuntimeProviderConfig, 'updatedAt'>,
  updatedAt: string | null,
): RuntimeProviderConfig {
  return {
    ...normalizeConfig(input),
    updatedAt,
  };
}

function getOrCreateEncryptionKey(): Buffer {
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });

  if (fs.existsSync(PROVIDER_CONFIG_KEY_FILE)) {
    const raw = fs.readFileSync(PROVIDER_CONFIG_KEY_FILE, 'utf-8').trim();
    const key = Buffer.from(raw, 'hex');
    if (key.length === 32) return key;
    throw new Error('Invalid encryption key file');
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(PROVIDER_CONFIG_KEY_FILE, key.toString('hex') + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return key;
}

function encryptSecrets(payload: SecretPayload): EncryptedSecrets {
  const key = getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptSecrets(secrets: EncryptedSecrets): SecretPayload {
  const key = getOrCreateEncryptionKey();
  const iv = Buffer.from(secrets.iv, 'base64');
  const tag = Buffer.from(secrets.tag, 'base64');
  const encrypted = Buffer.from(secrets.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf-8');

  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  const result: SecretPayload = {
    anthropicAuthToken: normalizeSecret(
      parsed.anthropicAuthToken ?? '',
      'anthropicAuthToken',
    ),
    anthropicApiKey: normalizeSecret(
      parsed.anthropicApiKey ?? '',
      'anthropicApiKey',
    ),
    claudeCodeOauthToken: normalizeSecret(
      parsed.claudeCodeOauthToken ?? '',
      'claudeCodeOauthToken',
    ),
    codexApiKey: normalizeSecret(parsed.codexApiKey ?? '', 'codexApiKey'),
    geminiApiKey: normalizeSecret(parsed.geminiApiKey ?? '', 'geminiApiKey'),
  };
  // Restore OAuth credentials if present
  if (parsed.claudeOAuthCredentials && typeof parsed.claudeOAuthCredentials === 'object') {
    const creds = parsed.claudeOAuthCredentials as Record<string, unknown>;
    if (typeof creds.accessToken === 'string' && typeof creds.refreshToken === 'string') {
      result.claudeOAuthCredentials = {
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: typeof creds.expiresAt === 'number' ? creds.expiresAt : 0,
        scopes: Array.isArray(creds.scopes) ? (creds.scopes as string[]) : [],
      };
    }
  }
  return result;
}

function encryptFeishuSecret(payload: FeishuSecretPayload): EncryptedSecrets {
  const key = getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptFeishuSecret(secrets: EncryptedSecrets): FeishuSecretPayload {
  const key = getOrCreateEncryptionKey();
  const iv = Buffer.from(secrets.iv, 'base64');
  const tag = Buffer.from(secrets.tag, 'base64');
  const encrypted = Buffer.from(secrets.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf-8');
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  return {
    appSecret: normalizeSecret(parsed.appSecret ?? '', 'appSecret'),
  };
}

function readStoredConfig(): RuntimeProviderConfig | null {
  if (!fs.existsSync(PROVIDER_CONFIG_FILE)) return null;
  const content = fs.readFileSync(PROVIDER_CONFIG_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;

  if (parsed.version === CURRENT_CONFIG_VERSION) {
    const v3 = parsed as unknown as StoredRuntimeProviderConfigV3;
    const secrets = decryptSecrets(v3.secrets);
    return buildConfig(
      {
        agentRuntime: v3.agentRuntime,
        anthropicBaseUrl: v3.anthropicBaseUrl,
        codexBaseUrl: v3.codexBaseUrl ?? '',
        codexModel: v3.codexModel ?? '',
        geminiBaseUrl: v3.geminiBaseUrl ?? '',
        geminiModel: v3.geminiModel ?? '',
        geminiAuthMode: v3.geminiAuthMode ?? 'api_key',
        anthropicAuthToken: secrets.anthropicAuthToken,
        anthropicApiKey: secrets.anthropicApiKey,
        claudeCodeOauthToken: secrets.claudeCodeOauthToken,
        codexApiKey: secrets.codexApiKey,
        geminiApiKey: secrets.geminiApiKey,
        claudeOAuthCredentials: secrets.claudeOAuthCredentials ?? null,
      },
      v3.updatedAt || null,
    );
  }

  throw new Error(
    `Unsupported provider config version: ${
      typeof parsed.version === 'number' ? parsed.version : 'unknown'
    }`,
  );
}

function defaultsFromEnv(): RuntimeProviderConfig {
  const raw: Omit<RuntimeProviderConfig, 'updatedAt'> = {
    agentRuntime: normalizeAgentProvider(
      process.env.AGENT_RUNTIME ||
        'claude',
    ),
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || '',
    codexBaseUrl: process.env.OPENAI_BASE_URL || '',
    codexModel: process.env.CODEX_MODEL || '',
    geminiBaseUrl:
      process.env.GOOGLE_GEMINI_BASE_URL ||
      process.env.GEMINI_NEXT_GEN_API_BASE_URL ||
      '',
    geminiModel: process.env.GEMINI_MODEL || '',
    geminiAuthMode:
      process.env.GEMINI_AUTH_MODE === 'oauth' ? 'oauth' : 'api_key',
    anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    claudeCodeOauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
    codexApiKey: process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    claudeOAuthCredentials: null,
  };

  try {
    return buildConfig(raw, null);
  } catch {
    return {
      agentRuntime:
        raw.agentRuntime === 'codex'
          ? 'codex'
          : raw.agentRuntime === 'gemini'
            ? 'gemini'
            : 'claude',
      anthropicBaseUrl: '',
      codexBaseUrl: raw.codexBaseUrl.trim(),
      codexModel: raw.codexModel.trim(),
      geminiBaseUrl: raw.geminiBaseUrl.trim(),
      geminiModel: raw.geminiModel.trim(),
      geminiAuthMode: raw.geminiAuthMode === 'oauth' ? 'oauth' : 'api_key',
      anthropicAuthToken: raw.anthropicAuthToken.trim(),
      anthropicApiKey: raw.anthropicApiKey.trim(),
      claudeCodeOauthToken: raw.claudeCodeOauthToken.trim(),
      codexApiKey: raw.codexApiKey.trim(),
      geminiApiKey: raw.geminiApiKey.trim(),
      claudeOAuthCredentials: null,
      updatedAt: null,
    };
  }
}

function readStoredFeishuConfig(): FeishuProviderConfig | null {
  if (!fs.existsSync(FEISHU_CONFIG_FILE)) return null;
  const content = fs.readFileSync(FEISHU_CONFIG_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.version !== 1) return null;

  const stored = parsed as unknown as StoredFeishuProviderConfigV1;
  const secret = decryptFeishuSecret(stored.secret);
  return {
    appId: normalizeFeishuAppId(stored.appId ?? ''),
    appSecret: secret.appSecret,
    enabled: stored.enabled,
    updatedAt: stored.updatedAt || null,
  };
}

function defaultsFeishuFromEnv(): FeishuProviderConfig {
  const raw = {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  };
  return {
    appId: raw.appId.trim(),
    appSecret: raw.appSecret.trim(),
    updatedAt: null,
  };
}

export function getFeishuProviderConfigWithSource(): {
  config: FeishuProviderConfig;
  source: FeishuConfigSource;
} {
  try {
    const stored = readStoredFeishuConfig();
    if (stored) return { config: stored, source: 'runtime' };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read runtime Feishu config, falling back to env',
    );
  }

  const fromEnv = defaultsFeishuFromEnv();
  if (fromEnv.appId || fromEnv.appSecret) {
    return { config: fromEnv, source: 'env' };
  }

  return { config: fromEnv, source: 'none' };
}

export function getFeishuProviderConfig(): FeishuProviderConfig {
  return getFeishuProviderConfigWithSource().config;
}

export function saveFeishuProviderConfig(
  next: Omit<FeishuProviderConfig, 'updatedAt'>,
): FeishuProviderConfig {
  const normalized: FeishuProviderConfig = {
    appId: normalizeFeishuAppId(next.appId),
    appSecret: normalizeSecret(next.appSecret, 'appSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredFeishuProviderConfigV1 = {
    version: 1,
    appId: normalized.appId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptFeishuSecret({ appSecret: normalized.appSecret }),
  };

  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${FEISHU_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, FEISHU_CONFIG_FILE);
  return normalized;
}

export function toPublicFeishuProviderConfig(
  config: FeishuProviderConfig,
  source: FeishuConfigSource,
): FeishuProviderPublicConfig {
  return {
    appId: config.appId,
    hasAppSecret: !!config.appSecret,
    appSecretMasked: maskSecret(config.appSecret),
    enabled: config.enabled !== false,
    updatedAt: config.updatedAt,
    source,
  };
}

// ========== Telegram Provider Config ==========

function encryptTelegramSecret(payload: TelegramSecretPayload): EncryptedSecrets {
  const key = getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptTelegramSecret(secrets: EncryptedSecrets): TelegramSecretPayload {
  const key = getOrCreateEncryptionKey();
  const iv = Buffer.from(secrets.iv, 'base64');
  const tag = Buffer.from(secrets.tag, 'base64');
  const encrypted = Buffer.from(secrets.data, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf-8');
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;
  return {
    botToken: normalizeSecret(parsed.botToken ?? '', 'botToken'),
  };
}

function readStoredTelegramConfig(): TelegramProviderConfig | null {
  if (!fs.existsSync(TELEGRAM_CONFIG_FILE)) return null;
  const content = fs.readFileSync(TELEGRAM_CONFIG_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Record<string, unknown>;
  if (parsed.version !== 1) return null;

  const stored = parsed as unknown as StoredTelegramProviderConfigV1;
  const secret = decryptTelegramSecret(stored.secret);
  return {
    botToken: secret.botToken,
    enabled: stored.enabled,
    updatedAt: stored.updatedAt || null,
  };
}

function defaultsTelegramFromEnv(): TelegramProviderConfig {
  const raw = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  };
  return {
    botToken: raw.botToken.trim(),
    updatedAt: null,
  };
}

export function getTelegramProviderConfigWithSource(): {
  config: TelegramProviderConfig;
  source: TelegramConfigSource;
} {
  try {
    const stored = readStoredTelegramConfig();
    if (stored) return { config: stored, source: 'runtime' };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read runtime Telegram config, falling back to env',
    );
  }

  const fromEnv = defaultsTelegramFromEnv();
  if (fromEnv.botToken) {
    return { config: fromEnv, source: 'env' };
  }

  return { config: fromEnv, source: 'none' };
}

export function getTelegramProviderConfig(): TelegramProviderConfig {
  return getTelegramProviderConfigWithSource().config;
}

export function saveTelegramProviderConfig(
  next: Omit<TelegramProviderConfig, 'updatedAt'>,
): TelegramProviderConfig {
  const normalized: TelegramProviderConfig = {
    botToken: normalizeSecret(next.botToken, 'botToken'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredTelegramProviderConfigV1 = {
    version: 1,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptTelegramSecret({ botToken: normalized.botToken }),
  };

  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${TELEGRAM_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, TELEGRAM_CONFIG_FILE);
  return normalized;
}

export function toPublicTelegramProviderConfig(
  config: TelegramProviderConfig,
  source: TelegramConfigSource,
): TelegramProviderPublicConfig {
  return {
    hasBotToken: !!config.botToken,
    botTokenMasked: maskSecret(config.botToken),
    enabled: config.enabled !== false,
    updatedAt: config.updatedAt,
    source,
  };
}

export function getGlobalRuntimeCustomEnv(): Record<string, string> {
  try {
    if (!fs.existsSync(PROVIDER_CUSTOM_ENV_FILE)) return {};
    const parsed = JSON.parse(
      fs.readFileSync(PROVIDER_CUSTOM_ENV_FILE, 'utf-8'),
    ) as {
      customEnv?: Record<string, string>;
    };
    return sanitizeCustomEnvMap(parsed.customEnv || {}, {
      skipReservedProviderKeys: true,
    });
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read global runtime custom env, returning empty',
    );
    return {};
  }
}

export function saveGlobalRuntimeCustomEnv(
  customEnv: Record<string, string>,
): Record<string, string> {
  const sanitized = sanitizeCustomEnvMap(customEnv, {
    skipReservedProviderKeys: true,
  });
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${PROVIDER_CUSTOM_ENV_FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ customEnv: sanitized }, null, 2) + '\n',
    'utf-8',
  );
  fs.renameSync(tmp, PROVIDER_CUSTOM_ENV_FILE);
  return sanitized;
}

interface StoredGeminiOAuthCredentialsV1 {
  version: 1;
  updatedAt: string;
  credentials: GeminiOAuthCredentials;
}

function normalizeGeminiOAuthCredentials(
  input: GeminiOAuthCredentials,
): GeminiOAuthCredentials {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid gemini oauth credentials');
  }
  const accessToken = typeof input.accessToken === 'string'
    ? input.accessToken.trim()
    : '';
  const refreshToken = typeof input.refreshToken === 'string'
    ? input.refreshToken.trim()
    : '';
  const tokenType = typeof input.tokenType === 'string'
    ? input.tokenType.trim()
    : 'Bearer';
  const scope = typeof input.scope === 'string'
    ? input.scope.trim()
    : '';
  const expiryDate = typeof input.expiryDate === 'number' && Number.isFinite(input.expiryDate)
    ? input.expiryDate
    : null;

  if (!accessToken) throw new Error('Invalid gemini oauth credentials: accessToken');
  if (!refreshToken) throw new Error('Invalid gemini oauth credentials: refreshToken');
  if (accessToken.length > MAX_FIELD_LENGTH * 4) {
    throw new Error('Field too long: geminiOAuth.accessToken');
  }
  if (refreshToken.length > MAX_FIELD_LENGTH * 4) {
    throw new Error('Field too long: geminiOAuth.refreshToken');
  }
  if (tokenType.length > MAX_FIELD_LENGTH) {
    throw new Error('Field too long: geminiOAuth.tokenType');
  }
  if (scope.length > MAX_FIELD_LENGTH * 8) {
    throw new Error('Field too long: geminiOAuth.scope');
  }

  return {
    accessToken,
    refreshToken,
    expiryDate,
    tokenType: tokenType || 'Bearer',
    scope,
  };
}

export function getGeminiOAuthCredentials(): GeminiOAuthCredentials | null {
  try {
    if (!fs.existsSync(GEMINI_OAUTH_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(GEMINI_OAUTH_FILE, 'utf-8')) as {
      version?: number;
      credentials?: GeminiOAuthCredentials;
    };
    if (raw.version !== 1 || !raw.credentials) return null;
    return normalizeGeminiOAuthCredentials(raw.credentials);
  } catch (err) {
    logger.warn({ err }, 'Failed to read Gemini OAuth credentials');
    return null;
  }
}

export function saveGeminiOAuthCredentials(
  credentials: GeminiOAuthCredentials,
): GeminiOAuthCredentials {
  const normalized = normalizeGeminiOAuthCredentials(credentials);
  const payload: StoredGeminiOAuthCredentialsV1 = {
    version: 1,
    updatedAt: new Date().toISOString(),
    credentials: normalized,
  };
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${GEMINI_OAUTH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tmp, GEMINI_OAUTH_FILE);
  return normalized;
}

export function clearGeminiOAuthCredentials(): void {
  try {
    if (fs.existsSync(GEMINI_OAUTH_FILE)) {
      fs.unlinkSync(GEMINI_OAUTH_FILE);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clear Gemini OAuth credentials');
  }
}

function maskSecret(value: string): string | null {
  if (!value) return null;
  if (value.length <= 8)
    return `${'*'.repeat(Math.max(value.length - 2, 1))}${value.slice(-2)}`;
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(value.length - 7, 4))}${value.slice(-4)}`;
}

export function toPublicRuntimeProviderConfig(
  config: RuntimeProviderConfig,
): RuntimeProviderPublicConfig {
  const envFallback = defaultsFromEnv();
  const resolved = resolveRuntimeProviderConfigWithEnvFallback(
    config,
    envFallback,
  );
  const codexApiKeyInfo = resolveApiKeyWithSource(
    config.codexApiKey,
    envFallback.codexApiKey,
  );
  const geminiApiKeyInfo =
    resolved.geminiAuthMode === 'oauth'
      ? { value: '', source: 'none' as const, degraded: false }
      : resolveApiKeyWithSource(config.geminiApiKey, envFallback.geminiApiKey);
  const geminiOAuthCredentials = getGeminiOAuthCredentials();
  const codexApiKey = codexApiKeyInfo.value;
  const geminiApiKey = geminiApiKeyInfo.value;
  return {
    agentRuntime: resolved.agentRuntime,
    anthropicBaseUrl: resolved.anthropicBaseUrl,
    codexBaseUrl: resolved.codexBaseUrl,
    codexModel: resolved.codexModel,
    geminiBaseUrl: resolved.geminiBaseUrl,
    geminiModel: resolved.geminiModel,
    geminiAuthMode: resolved.geminiAuthMode,
    updatedAt: resolved.updatedAt,
    hasAnthropicAuthToken: !!resolved.anthropicAuthToken,
    hasAnthropicApiKey: !!resolved.anthropicApiKey,
    hasClaudeCodeOauthToken: !!resolved.claudeCodeOauthToken,
    hasCodexApiKey: !!codexApiKey,
    hasGeminiApiKey: !!geminiApiKey,
    hasGeminiOAuthCredentials: !!geminiOAuthCredentials,
    anthropicAuthTokenMasked: maskSecret(resolved.anthropicAuthToken),
    anthropicApiKeyMasked: maskSecret(resolved.anthropicApiKey),
    claudeCodeOauthTokenMasked: maskSecret(resolved.claudeCodeOauthToken),
    codexApiKeyMasked: maskSecret(codexApiKey),
    geminiApiKeyMasked: maskSecret(geminiApiKey),
    codexApiKeySource: codexApiKeyInfo.source,
    geminiApiKeySource: geminiApiKeyInfo.source,
    codexApiKeyDegraded: codexApiKeyInfo.degraded,
    geminiApiKeyDegraded: geminiApiKeyInfo.degraded,
    hasRuntimeOAuthCredentials: !!resolved.claudeOAuthCredentials,
    claudeOAuthCredentialsExpiresAt:
      resolved.claudeOAuthCredentials?.expiresAt ?? null,
    claudeOAuthCredentialsAccessTokenMasked: resolved.claudeOAuthCredentials
      ? maskSecret(resolved.claudeOAuthCredentials.accessToken)
      : null,
  };
}

export function validateRuntimeProviderConfig(
  config: RuntimeProviderConfig,
): string[] {
  const errors: string[] = [];

  if (!AGENT_PROVIDER_IDS.includes(config.agentRuntime)) {
    errors.push(
      `AGENT_RUNTIME 仅支持 ${AGENT_PROVIDER_IDS.join(' 或 ')}`,
    );
  }

  if (
    config.agentRuntime === 'claude' &&
    config.anthropicAuthToken &&
    !config.anthropicBaseUrl
  ) {
    errors.push('使用 ANTHROPIC_AUTH_TOKEN 时必须配置 ANTHROPIC_BASE_URL');
  }

  if (config.agentRuntime === 'claude' && config.anthropicBaseUrl) {
    try {
      const parsed = new URL(config.anthropicBaseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('ANTHROPIC_BASE_URL 必须是 http 或 https 地址');
      }
    } catch {
      errors.push('ANTHROPIC_BASE_URL 格式不正确');
    }
  }

  if (config.codexBaseUrl) {
    try {
      const parsed = new URL(config.codexBaseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('OPENAI_BASE_URL 必须是 http 或 https 地址');
      }
    } catch {
      errors.push('OPENAI_BASE_URL 格式不正确');
    }
  }

  if (config.geminiBaseUrl) {
    try {
      const parsed = new URL(config.geminiBaseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('GOOGLE_GEMINI_BASE_URL 必须是 http 或 https 地址');
      }
    } catch {
      errors.push('GOOGLE_GEMINI_BASE_URL 格式不正确');
    }
  }

  return errors;
}

export function getRuntimeProviderConfig(): RuntimeProviderConfig {
  try {
    const stored = readStoredConfig();
    if (stored) return stored;
  } catch {
    // ignore corrupted file and use env fallback
  }
  return defaultsFromEnv();
}

export function saveRuntimeProviderConfig(
  next: Omit<RuntimeProviderConfig, 'updatedAt'>,
): RuntimeProviderConfig {
  const normalized = buildConfig(next, new Date().toISOString());
  const errors = validateRuntimeProviderConfig(normalized);
  if (errors.length > 0) {
    throw new Error(errors.join('；'));
  }

  const payload: StoredRuntimeProviderConfigV3 = {
    version: CURRENT_CONFIG_VERSION,
    agentRuntime: normalized.agentRuntime,
    anthropicBaseUrl: normalized.anthropicBaseUrl,
    codexBaseUrl: normalized.codexBaseUrl,
    codexModel: normalized.codexModel,
    geminiBaseUrl: normalized.geminiBaseUrl,
    geminiModel: normalized.geminiModel,
    geminiAuthMode: normalized.geminiAuthMode,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secrets: encryptSecrets({
      anthropicAuthToken: normalized.anthropicAuthToken,
      anthropicApiKey: normalized.anthropicApiKey,
      claudeCodeOauthToken: normalized.claudeCodeOauthToken,
      codexApiKey: normalized.codexApiKey,
      geminiApiKey: normalized.geminiApiKey,
      claudeOAuthCredentials: normalized.claudeOAuthCredentials,
    }),
  };

  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${PROVIDER_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, PROVIDER_CONFIG_FILE);

  return normalized;
}

/** Strip control characters from a value before writing to env file (defense-in-depth) */
function sanitizeEnvValue(value: string): string {
  return value.replace(/[\r\n\0]/g, '');
}

/** Convert KEY=value lines to shell-safe format by single-quoting values.
 *  Used when writing env files that are `source`d by bash. */
export function shellQuoteEnvLines(lines: string[]): string[] {
  return lines.map((line) => {
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) return line;
    const key = line.slice(0, eqIdx);
    const value = line.slice(eqIdx + 1);
    // Escape embedded single quotes: ' → '\''
    const quoted = "'" + value.replace(/'/g, "'\\''") + "'";
    return `${key}=${quoted}`;
  });
}

export function buildRuntimeEnvLines(config: RuntimeProviderConfig): string[] {
  const envFallback = defaultsFromEnv();
  const resolved = resolveRuntimeProviderConfigWithEnvFallback(
    config,
    envFallback,
  );
  const lines: string[] = [];
  lines.push(`AGENT_RUNTIME=${resolved.agentRuntime}`);
  const runtimeDef = getAgentProviderDefinition(resolved.agentRuntime);
  lines.push(
    `SOLOMESH_RUNTIME_LABEL=${sanitizeEnvValue(runtimeDef.label)}`,
  );
  lines.push(
    `SOLOMESH_PRIMARY_MEMORY_FILE_NAME=${sanitizeEnvValue(
      getPrimaryMemoryFileName(resolved.agentRuntime),
    )}`,
  );
  lines.push(
    `SOLOMESH_CAP_SUPPORTS_MEMORY_FLUSH=${
      runtimeDef.capabilities.supportsMemoryFlush ? '1' : '0'
    }`,
  );
  lines.push(
    `SOLOMESH_CAP_SUPPORTS_NATIVE_THINKING_STREAM=${
      runtimeDef.capabilities.supportsNativeThinkingStream ? '1' : '0'
    }`,
  );
  lines.push(
    `SOLOMESH_CAP_SUPPORTS_TASK_NOTIFICATION_SYNTHESIS=${
      runtimeDef.capabilities.supportsTaskNotificationSynthesis ? '1' : '0'
    }`,
  );

  if (resolved.agentRuntime === 'codex') {
    const codexApiKey = normalizeApiKeyValue(resolved.codexApiKey);
    const configuredCodexApiKey = normalizeApiKeyValue(config.codexApiKey);
    if (config.codexApiKey && !configuredCodexApiKey && codexApiKey) {
      logger.warn(
        'Runtime config CODEX_API_KEY is invalid, falling back to process env',
      );
    } else if (config.codexApiKey && !configuredCodexApiKey) {
      logger.warn('Skipping invalid CODEX_API_KEY because it looks like a URL');
    }
    if (codexApiKey) {
      lines.push(`CODEX_API_KEY=${codexApiKey}`);
      lines.push(`OPENAI_API_KEY=${codexApiKey}`);
    }
    if (resolved.codexBaseUrl) {
      lines.push(`OPENAI_BASE_URL=${sanitizeEnvValue(resolved.codexBaseUrl)}`);
    }
    if (resolved.codexModel) {
      lines.push(`CODEX_MODEL=${sanitizeEnvValue(resolved.codexModel)}`);
    }
  } else if (resolved.agentRuntime === 'gemini') {
    lines.push(
      `GEMINI_AUTH_MODE=${sanitizeEnvValue(resolved.geminiAuthMode)}`,
    );
    const geminiApiKey = normalizeApiKeyValue(resolved.geminiApiKey);
    const configuredGeminiApiKey = normalizeApiKeyValue(config.geminiApiKey);
    if (
      resolved.geminiAuthMode === 'api_key' &&
      config.geminiApiKey &&
      !configuredGeminiApiKey &&
      geminiApiKey
    ) {
      logger.warn(
        'Runtime config GEMINI_API_KEY is invalid, falling back to process env',
      );
    } else if (
      resolved.geminiAuthMode === 'api_key' &&
      config.geminiApiKey &&
      !configuredGeminiApiKey
    ) {
      logger.warn('Skipping invalid GEMINI_API_KEY because it looks like a URL');
    }
    if (resolved.geminiAuthMode === 'api_key' && geminiApiKey) {
      lines.push(`GEMINI_API_KEY=${geminiApiKey}`);
    }
    if (resolved.geminiBaseUrl) {
      lines.push(
        `GOOGLE_GEMINI_BASE_URL=${sanitizeEnvValue(resolved.geminiBaseUrl)}`,
      );
    }
    if (resolved.geminiModel) {
      lines.push(`GEMINI_MODEL=${sanitizeEnvValue(resolved.geminiModel)}`);
    }
  } else {
    // When full OAuth credentials exist, authentication is handled by .credentials.json file.
    // Otherwise use CLAUDE_CODE_OAUTH_TOKEN for single-token mode.
    if (!resolved.claudeOAuthCredentials && resolved.claudeCodeOauthToken) {
      lines.push(
        `CLAUDE_CODE_OAUTH_TOKEN=${sanitizeEnvValue(resolved.claudeCodeOauthToken)}`,
      );
    }
    if (resolved.anthropicApiKey) {
      lines.push(
        `ANTHROPIC_API_KEY=${sanitizeEnvValue(resolved.anthropicApiKey)}`,
      );
    }
    if (resolved.anthropicBaseUrl) {
      lines.push(
        `ANTHROPIC_BASE_URL=${sanitizeEnvValue(resolved.anthropicBaseUrl)}`,
      );
    }
    if (resolved.anthropicAuthToken) {
      lines.push(
        `ANTHROPIC_AUTH_TOKEN=${sanitizeEnvValue(resolved.anthropicAuthToken)}`,
      );
    }
  }

  const customEnv = getGlobalRuntimeCustomEnv();
  for (const [key, value] of Object.entries(customEnv)) {
    if (RESERVED_PROVIDER_ENV_KEYS.has(key)) continue;
    lines.push(`${key}=${sanitizeEnvValue(value)}`);
  }

  return lines;
}

export function appendRuntimeConfigAudit(
  actor: string,
  action: string,
  changedFields: string[],
  metadata?: Record<string, unknown>,
): void {
  const entry: RuntimeConfigAuditEntry = {
    timestamp: new Date().toISOString(),
    actor,
    action,
    changedFields,
    metadata,
  };
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  fs.appendFileSync(
    PROVIDER_CONFIG_AUDIT_FILE,
    `${JSON.stringify(entry)}\n`,
    'utf-8',
  );
}

// ─── Per-container environment config ───────────────────────────

const CONTAINER_ENV_DIR = path.join(DATA_DIR, 'config', 'container-env');

export interface ContainerEnvConfig {
  /** Agent provider override */
  agentRuntime?: AgentProvider;
  /** Claude provider overrides — empty string means "use global" */
  anthropicBaseUrl?: string;
  codexBaseUrl?: string;
  codexModel?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
  geminiAuthMode?: GeminiAuthMode;
  anthropicAuthToken?: string;
  anthropicApiKey?: string;
  claudeCodeOauthToken?: string;
  codexApiKey?: string;
  geminiApiKey?: string;
  claudeOAuthCredentials?: RuntimeOAuthCredentials | null;
  /** Arbitrary extra env vars injected into the container */
  customEnv?: Record<string, string>;
}

export interface ContainerEnvPublicConfig {
  agentRuntime: AgentProvider;
  anthropicBaseUrl: string;
  codexBaseUrl: string;
  codexModel: string;
  geminiBaseUrl: string;
  geminiModel: string;
  geminiAuthMode: GeminiAuthMode;
  anthropicAuthTokenMasked: string | null;
  anthropicApiKeyMasked: string | null;
  claudeCodeOauthTokenMasked: string | null;
  codexApiKeyMasked: string | null;
  geminiApiKeyMasked: string | null;
  hasAnthropicAuthToken: boolean;
  hasAnthropicApiKey: boolean;
  hasClaudeCodeOauthToken: boolean;
  hasCodexApiKey: boolean;
  hasGeminiApiKey: boolean;
  codexApiKeySource: 'override' | RuntimeSecretSource;
  geminiApiKeySource: 'override' | RuntimeSecretSource;
  codexApiKeyDegraded: boolean;
  geminiApiKeyDegraded: boolean;
  customEnv: Record<string, string>;
}

function containerEnvPath(folder: string): string {
  if (folder.includes('..') || folder.includes('/')) {
    throw new Error('Invalid folder name');
  }
  return path.join(CONTAINER_ENV_DIR, `${folder}.json`);
}

export function getContainerEnvConfig(folder: string): ContainerEnvConfig {
  const filePath = containerEnvPath(folder);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(
        fs.readFileSync(filePath, 'utf-8'),
      ) as ContainerEnvConfig;
    }
  } catch (err) {
    logger.warn(
      { err, folder },
      'Failed to read container env config, returning defaults',
    );
  }
  return {};
}

export function saveContainerEnvConfig(
  folder: string,
  config: ContainerEnvConfig,
): void {
  // Sanitize all string fields to prevent env injection
  const sanitized: ContainerEnvConfig = { ...config };
  if (sanitized.agentRuntime)
    sanitized.agentRuntime = normalizeAgentProvider(sanitized.agentRuntime);
  if (sanitized.anthropicBaseUrl)
    sanitized.anthropicBaseUrl = sanitizeEnvValue(sanitized.anthropicBaseUrl);
  if (sanitized.codexBaseUrl)
    sanitized.codexBaseUrl = sanitizeEnvValue(sanitized.codexBaseUrl);
  if (sanitized.codexModel)
    sanitized.codexModel = sanitizeEnvValue(sanitized.codexModel);
  if (sanitized.geminiBaseUrl)
    sanitized.geminiBaseUrl = sanitizeEnvValue(sanitized.geminiBaseUrl);
  if (sanitized.geminiModel)
    sanitized.geminiModel = sanitizeEnvValue(sanitized.geminiModel);
  if (sanitized.geminiAuthMode !== undefined) {
    sanitized.geminiAuthMode = normalizeGeminiAuthMode(
      sanitized.geminiAuthMode,
    );
  }
  if (sanitized.anthropicAuthToken)
    sanitized.anthropicAuthToken = sanitizeEnvValue(
      sanitized.anthropicAuthToken,
    );
  if (sanitized.anthropicApiKey)
    sanitized.anthropicApiKey = sanitizeEnvValue(sanitized.anthropicApiKey);
  if (sanitized.claudeCodeOauthToken)
    sanitized.claudeCodeOauthToken = sanitizeEnvValue(
      sanitized.claudeCodeOauthToken,
    );
  if (sanitized.codexApiKey)
    sanitized.codexApiKey = sanitizeEnvValue(sanitized.codexApiKey);
  if (sanitized.geminiApiKey)
    sanitized.geminiApiKey = sanitizeEnvValue(sanitized.geminiApiKey);
  if (sanitized.customEnv) {
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(sanitized.customEnv)) {
      if (RESERVED_PROVIDER_ENV_KEYS.has(k)) {
        logger.warn({ key: k }, 'Rejected reserved provider env key in saveContainerEnvConfig');
        continue;
      }
      if (DANGEROUS_ENV_VARS.has(k)) {
        logger.warn({ key: k }, 'Rejected dangerous env variable in saveContainerEnvConfig');
        continue;
      }
      cleanEnv[k] = sanitizeEnvValue(v);
    }
    sanitized.customEnv = cleanEnv;
  }

  fs.mkdirSync(CONTAINER_ENV_DIR, { recursive: true });
  const tmp = `${containerEnvPath(folder)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sanitized, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, containerEnvPath(folder));
}

export function deleteContainerEnvConfig(folder: string): void {
  const filePath = containerEnvPath(folder);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function resolveContainerApiKeyWithSource(
  overrideValue: string,
  runtimeSourceInfo: ReturnType<typeof resolveApiKeyWithSource>,
): {
  value: string;
  source: 'override' | RuntimeSecretSource;
  degraded: boolean;
} {
  const overrideTrimmed = sanitizeEnvValue(overrideValue).trim();
  const overrideValid = normalizeApiKeyValue(overrideTrimmed);
  if (overrideValid) {
    return { value: overrideValid, source: 'override', degraded: false };
  }
  if (runtimeSourceInfo.value) {
    return {
      value: runtimeSourceInfo.value,
      source: runtimeSourceInfo.source,
      degraded: overrideTrimmed.length > 0 || runtimeSourceInfo.degraded,
    };
  }
  return {
    value: '',
    source: 'none',
    degraded: overrideTrimmed.length > 0 || runtimeSourceInfo.degraded,
  };
}

export function toPublicContainerEnvConfig(
  config: ContainerEnvConfig,
  runtimeConfig?: RuntimeProviderConfig,
): ContainerEnvPublicConfig {
  const runtime = runtimeConfig ?? getRuntimeProviderConfig();
  const envFallback = defaultsFromEnv();
  const runtimeCodexApiKeyInfo = resolveApiKeyWithSource(
    runtime.codexApiKey,
    envFallback.codexApiKey,
  );
  const runtimeGeminiApiKeyInfo = resolveApiKeyWithSource(
    runtime.geminiApiKey,
    envFallback.geminiApiKey,
  );
  const codexApiKeyInfo = resolveContainerApiKeyWithSource(
    config.codexApiKey || '',
    runtimeCodexApiKeyInfo,
  );
  const effectiveGeminiAuthMode =
    config.geminiAuthMode === 'oauth'
      ? 'oauth'
      : runtime.geminiAuthMode === 'oauth'
        ? 'oauth'
        : 'api_key';
  const geminiApiKeyInfo =
    effectiveGeminiAuthMode === 'oauth'
      ? { value: '', source: 'none' as const, degraded: false }
      : resolveContainerApiKeyWithSource(
          config.geminiApiKey || '',
          runtimeGeminiApiKeyInfo,
        );
  return {
    agentRuntime: normalizeAgentProvider(config.agentRuntime),
    anthropicBaseUrl: config.anthropicBaseUrl || '',
    codexBaseUrl: config.codexBaseUrl || '',
    codexModel: config.codexModel || '',
    geminiBaseUrl: config.geminiBaseUrl || '',
    geminiModel: config.geminiModel || '',
    geminiAuthMode:
      config.geminiAuthMode === 'oauth' ? 'oauth' : 'api_key',
    hasAnthropicAuthToken: !!config.anthropicAuthToken,
    hasAnthropicApiKey: !!config.anthropicApiKey,
    hasClaudeCodeOauthToken: !!config.claudeCodeOauthToken,
    hasCodexApiKey: !!codexApiKeyInfo.value,
    hasGeminiApiKey: !!geminiApiKeyInfo.value,
    anthropicAuthTokenMasked: maskSecret(config.anthropicAuthToken || ''),
    anthropicApiKeyMasked: maskSecret(config.anthropicApiKey || ''),
    claudeCodeOauthTokenMasked: maskSecret(config.claudeCodeOauthToken || ''),
    codexApiKeyMasked: maskSecret(codexApiKeyInfo.value),
    geminiApiKeyMasked: maskSecret(geminiApiKeyInfo.value),
    codexApiKeySource: codexApiKeyInfo.source,
    geminiApiKeySource: geminiApiKeyInfo.source,
    codexApiKeyDegraded: codexApiKeyInfo.degraded,
    geminiApiKeyDegraded: geminiApiKeyInfo.degraded,
    customEnv: config.customEnv || {},
  };
}

/**
 * Merge global config with per-container overrides.
 * Non-empty per-container fields override the global value.
 */
export function mergeRuntimeEnvConfig(
  global: RuntimeProviderConfig,
  override: ContainerEnvConfig,
): RuntimeProviderConfig {
  const overrideCodexApiKey = normalizeApiKeyValue(override.codexApiKey || '');
  const globalCodexApiKey = normalizeApiKeyValue(global.codexApiKey);
  const overrideGeminiApiKey = normalizeApiKeyValue(override.geminiApiKey || '');
  const globalGeminiApiKey = normalizeApiKeyValue(global.geminiApiKey);

  return {
    agentRuntime: normalizeAgentProvider(
      override.agentRuntime || global.agentRuntime,
    ),
    anthropicBaseUrl: override.anthropicBaseUrl || global.anthropicBaseUrl,
    codexBaseUrl: override.codexBaseUrl || global.codexBaseUrl,
    codexModel: override.codexModel || global.codexModel,
    geminiBaseUrl: override.geminiBaseUrl || global.geminiBaseUrl,
    geminiModel: override.geminiModel || global.geminiModel,
    geminiAuthMode: override.geminiAuthMode || global.geminiAuthMode,
    anthropicAuthToken:
      override.anthropicAuthToken || global.anthropicAuthToken,
    anthropicApiKey: override.anthropicApiKey || global.anthropicApiKey,
    claudeCodeOauthToken:
      override.claudeCodeOauthToken || global.claudeCodeOauthToken,
    codexApiKey: overrideCodexApiKey || globalCodexApiKey,
    geminiApiKey: overrideGeminiApiKey || globalGeminiApiKey,
    claudeOAuthCredentials:
      override.claudeOAuthCredentials ?? global.claudeOAuthCredentials,
    updatedAt: global.updatedAt,
  };
}

// ─── Registration config (plain JSON, no encryption) ─────────────

const REGISTRATION_CONFIG_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'registration.json',
);

export interface RegistrationConfig {
  allowRegistration: boolean;
  requireInviteCode: boolean;
  updatedAt: string | null;
}

const DEFAULT_REGISTRATION_CONFIG: RegistrationConfig = {
  allowRegistration: true,
  requireInviteCode: true,
  updatedAt: null,
};

export function getRegistrationConfig(): RegistrationConfig {
  try {
    if (!fs.existsSync(REGISTRATION_CONFIG_FILE)) {
      return { ...DEFAULT_REGISTRATION_CONFIG };
    }
    const raw = JSON.parse(
      fs.readFileSync(REGISTRATION_CONFIG_FILE, 'utf-8'),
    ) as Record<string, unknown>;
    return {
      allowRegistration:
        typeof raw.allowRegistration === 'boolean'
          ? raw.allowRegistration
          : true,
      requireInviteCode:
        typeof raw.requireInviteCode === 'boolean'
          ? raw.requireInviteCode
          : true,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read registration config, returning defaults',
    );
    return { ...DEFAULT_REGISTRATION_CONFIG };
  }
}

export function saveRegistrationConfig(
  next: Pick<RegistrationConfig, 'allowRegistration' | 'requireInviteCode'>,
): RegistrationConfig {
  const config: RegistrationConfig = {
    allowRegistration: next.allowRegistration,
    requireInviteCode: next.requireInviteCode,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${REGISTRATION_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, REGISTRATION_CONFIG_FILE);
  return config;
}

/**
 * Build full env lines: merged runtime config + custom env vars.
 */
export function buildContainerEnvLines(
  global: RuntimeProviderConfig,
  override: ContainerEnvConfig,
): string[] {
  const merged = mergeRuntimeEnvConfig(global, override);
  const lines = buildRuntimeEnvLines(merged);

  // Append custom env vars (with safety sanitization as defense-in-depth)
  if (override.customEnv) {
    for (const [key, value] of Object.entries(override.customEnv)) {
      if (!key || value === undefined) continue;
      if (!ENV_KEY_RE.test(key)) {
        logger.warn(
          { key },
          'Skipping invalid env key in buildContainerEnvLines',
        );
        continue;
      }
      if (RESERVED_PROVIDER_ENV_KEYS.has(key)) {
        logger.warn(
          { key },
          'Blocked reserved provider env key in buildContainerEnvLines',
        );
        continue;
      }
      // Block dangerous environment variables
      if (DANGEROUS_ENV_VARS.has(key)) {
        logger.warn(
          { key },
          'Blocked dangerous env variable in buildContainerEnvLines',
        );
        continue;
      }
      // Strip control characters to prevent env injection
      const sanitized = value.replace(/[\r\n\0]/g, '');
      lines.push(`${key}=${sanitized}`);
    }
  }

  return lines;
}

// ─── OAuth credentials file management ────────────────────────────

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const GEMINI_OAUTH_CREDENTIALS_FILE = 'oauth_creds.json';
const GEMINI_SETTINGS_FILE = 'settings.json';

/**
 * Write .credentials.json to a Claude session directory.
 * Format matches what Claude Code CLI/Agent SDK natively reads.
 */
export function writeCredentialsFile(
  sessionDir: string,
  config: RuntimeProviderConfig,
): void {
  const creds = config.claudeOAuthCredentials;
  if (!creds) return;

  const credentialsData = {
    claudeAiOauth: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes,
    },
  };

  const filePath = path.join(sessionDir, '.credentials.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(credentialsData, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o644,
  });
  fs.renameSync(tmp, filePath);
}

/**
 * Update .credentials.json in all existing session directories + host ~/.claude/
 */
export function updateAllSessionCredentials(config: RuntimeProviderConfig): void {
  if (!config.claudeOAuthCredentials) return;

  const sessionsDir = path.join(DATA_DIR, 'sessions');
  try {
    if (!fs.existsSync(sessionsDir)) return;
    for (const folder of fs.readdirSync(sessionsDir)) {
      const claudeDir = path.join(sessionsDir, folder, '.claude');
      if (fs.existsSync(claudeDir) && fs.statSync(claudeDir).isDirectory()) {
        try {
          writeCredentialsFile(claudeDir, config);
        } catch (err) {
          logger.warn({ err, folder }, 'Failed to write .credentials.json for session');
        }
      }
      // Also update sub-agent session dirs
      const agentsDir = path.join(sessionsDir, folder, 'agents');
      if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
        for (const agentId of fs.readdirSync(agentsDir)) {
          const agentClaudeDir = path.join(agentsDir, agentId, '.claude');
          if (fs.existsSync(agentClaudeDir) && fs.statSync(agentClaudeDir).isDirectory()) {
            try {
              writeCredentialsFile(agentClaudeDir, config);
            } catch (err) {
              logger.warn({ err, folder, agentId }, 'Failed to write .credentials.json for agent session');
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to update session credentials');
  }

  // Host mode: update ~/.claude/.credentials.json
  const homeClaudeDir = path.join(process.env.HOME || '/root', '.claude');
  if (fs.existsSync(homeClaudeDir) && fs.statSync(homeClaudeDir).isDirectory()) {
    try {
      writeCredentialsFile(homeClaudeDir, config);
    } catch (err) {
      logger.warn({ err }, 'Failed to write host ~/.claude/.credentials.json');
    }
  }
}

export function writeGeminiOAuthFile(
  geminiDir: string,
  credentials: GeminiOAuthCredentials,
): void {
  const normalized = normalizeGeminiOAuthCredentials(credentials);
  fs.mkdirSync(geminiDir, { recursive: true });
  const filePath = path.join(geminiDir, GEMINI_OAUTH_CREDENTIALS_FILE);
  const payload = {
    access_token: normalized.accessToken,
    refresh_token: normalized.refreshToken,
    expiry_date: normalized.expiryDate ?? undefined,
    token_type: normalized.tokenType || 'Bearer',
    scope: normalized.scope || undefined,
  };
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  upsertGeminiAuthType(geminiDir, 'oauth-personal');
}

function clearGeminiOAuthFile(geminiDir: string): void {
  try {
    const filePath = path.join(geminiDir, GEMINI_OAUTH_CREDENTIALS_FILE);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // best effort
  }
}

function upsertGeminiAuthType(
  geminiDir: string,
  authType: 'oauth-personal' | 'gemini-api-key',
): void {
  try {
    fs.mkdirSync(geminiDir, { recursive: true });
    const settingsPath = path.join(geminiDir, GEMINI_SETTINGS_FILE);
    let parsed: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          parsed = raw as Record<string, unknown>;
        }
      } catch {
        // If existing settings is malformed, overwrite with minimal valid structure.
      }
    }

    const security =
      parsed.security && typeof parsed.security === 'object' && !Array.isArray(parsed.security)
        ? { ...(parsed.security as Record<string, unknown>) }
        : {};
    const auth =
      security.auth && typeof security.auth === 'object' && !Array.isArray(security.auth)
        ? { ...(security.auth as Record<string, unknown>) }
        : {};
    auth.selectedType = authType;
    security.auth = auth;

    const next = { ...parsed, security };
    const tmp = `${settingsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    fs.renameSync(tmp, settingsPath);
  } catch (err) {
    logger.warn({ err }, 'Failed to update Gemini settings auth type');
  }
}

export function updateAllGeminiSessionCredentials(
  credentials: GeminiOAuthCredentials | null,
): void {
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  try {
    if (fs.existsSync(sessionsDir)) {
      for (const folder of fs.readdirSync(sessionsDir)) {
        const geminiDir = path.join(sessionsDir, folder, '.gemini');
        if (fs.existsSync(geminiDir) && fs.statSync(geminiDir).isDirectory()) {
          try {
            if (credentials) {
              writeGeminiOAuthFile(geminiDir, credentials);
            } else {
              clearGeminiOAuthFile(geminiDir);
              upsertGeminiAuthType(geminiDir, 'gemini-api-key');
            }
          } catch (err) {
            logger.warn({ err, folder }, 'Failed to write Gemini OAuth creds for session');
          }
        }

        const agentsDir = path.join(sessionsDir, folder, 'agents');
        if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
          for (const agentId of fs.readdirSync(agentsDir)) {
            const agentGeminiDir = path.join(agentsDir, agentId, '.gemini');
            if (fs.existsSync(agentGeminiDir) && fs.statSync(agentGeminiDir).isDirectory()) {
              try {
                if (credentials) {
                  writeGeminiOAuthFile(agentGeminiDir, credentials);
                } else {
                  clearGeminiOAuthFile(agentGeminiDir);
                  upsertGeminiAuthType(agentGeminiDir, 'gemini-api-key');
                }
              } catch (err) {
                logger.warn(
                  { err, folder, agentId },
                  'Failed to write Gemini OAuth creds for agent session',
                );
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to update Gemini OAuth credentials for sessions');
  }

  const homeGeminiDir = path.join(process.env.HOME || '/root', '.gemini');
  try {
    if (credentials) {
      writeGeminiOAuthFile(homeGeminiDir, credentials);
    } else {
      clearGeminiOAuthFile(homeGeminiDir);
      upsertGeminiAuthType(homeGeminiDir, 'gemini-api-key');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to update host ~/.gemini/oauth_creds.json');
  }
}

/**
 * Refresh OAuth credentials using the refresh token.
 * Returns new credentials on success, null on failure.
 */
export async function refreshOAuthCredentials(
  credentials: RuntimeOAuthCredentials,
): Promise<RuntimeOAuthCredentials | null> {
  try {
    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://claude.ai/',
        'Origin': 'https://claude.ai',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
        refresh_token: credentials.refreshToken,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn({ status: resp.status, body: errText }, 'OAuth token refresh failed');
      return null;
    }

    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!data.access_token) {
      logger.warn('OAuth refresh response missing access_token');
      return null;
    }

    // expiresAt 计算与 SDK 保持一致：Date.now() + expires_in * 1000
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || credentials.refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : credentials.expiresAt,
      scopes: data.scope ? data.scope.split(' ') : credentials.scopes,
    };
  } catch (err) {
    logger.error({ err }, 'OAuth token refresh error');
    return null;
  }
}

// ─── Appearance config (plain JSON, no encryption) ────────────────

const APPEARANCE_CONFIG_FILE = path.join(
  RUNTIME_CONFIG_DIR,
  'appearance.json',
);

export interface AppearanceConfig {
  appName: string;
  aiName: string;
  aiAvatarEmoji: string;
  aiAvatarColor: string;
}

const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  appName: APP_NAME,
  aiName: APP_NAME,
  aiAvatarEmoji: '\u{1F431}',
  aiAvatarColor: '#0d9488',
};

export function getAppearanceConfig(): AppearanceConfig {
  try {
    if (!fs.existsSync(APPEARANCE_CONFIG_FILE)) {
      return { ...DEFAULT_APPEARANCE_CONFIG };
    }
    const raw = JSON.parse(
      fs.readFileSync(APPEARANCE_CONFIG_FILE, 'utf-8'),
    ) as Record<string, unknown>;
    return {
      appName:
        typeof raw.appName === 'string' && raw.appName
          ? raw.appName
          : DEFAULT_APPEARANCE_CONFIG.appName,
      aiName:
        typeof raw.aiName === 'string' && raw.aiName
          ? raw.aiName
          : DEFAULT_APPEARANCE_CONFIG.aiName,
      aiAvatarEmoji:
        typeof raw.aiAvatarEmoji === 'string' && raw.aiAvatarEmoji
          ? raw.aiAvatarEmoji
          : DEFAULT_APPEARANCE_CONFIG.aiAvatarEmoji,
      aiAvatarColor:
        typeof raw.aiAvatarColor === 'string' && raw.aiAvatarColor
          ? raw.aiAvatarColor
          : DEFAULT_APPEARANCE_CONFIG.aiAvatarColor,
    };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to read appearance config, returning defaults',
    );
    return { ...DEFAULT_APPEARANCE_CONFIG };
  }
}

export function saveAppearanceConfig(
  next: Partial<Pick<AppearanceConfig, 'appName'>> & Omit<AppearanceConfig, 'appName'>,
): AppearanceConfig {
  const existing = getAppearanceConfig();
  const config = {
    appName: next.appName || existing.appName,
    aiName: next.aiName,
    aiAvatarEmoji: next.aiAvatarEmoji,
    aiAvatarColor: next.aiAvatarColor,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${APPEARANCE_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, APPEARANCE_CONFIG_FILE);
  return {
    appName: config.appName,
    aiName: config.aiName,
    aiAvatarEmoji: config.aiAvatarEmoji,
    aiAvatarColor: config.aiAvatarColor,
  };
}

// ─── Per-user IM config (AES-256-GCM encrypted) ─────────────────

const USER_IM_CONFIG_DIR = path.join(DATA_DIR, 'config', 'user-im');

export interface UserFeishuConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
  updatedAt: string | null;
}

export interface UserTelegramConfig {
  botToken: string;
  enabled?: boolean;
  updatedAt: string | null;
}

function userImDir(userId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('Invalid userId');
  }
  return path.join(USER_IM_CONFIG_DIR, userId);
}

export function getUserFeishuConfig(userId: string): UserFeishuConfig | null {
  const filePath = path.join(userImDir(userId), 'feishu.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredFeishuProviderConfigV1;
    const secret = decryptFeishuSecret(stored.secret);
    return {
      appId: normalizeFeishuAppId(stored.appId ?? ''),
      appSecret: secret.appSecret,
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user Feishu config');
    return null;
  }
}

export function saveUserFeishuConfig(
  userId: string,
  next: Omit<UserFeishuConfig, 'updatedAt'>,
): UserFeishuConfig {
  const normalized: UserFeishuConfig = {
    appId: normalizeFeishuAppId(next.appId),
    appSecret: normalizeSecret(next.appSecret, 'appSecret'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredFeishuProviderConfigV1 = {
    version: 1,
    appId: normalized.appId,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptFeishuSecret({ appSecret: normalized.appSecret }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'feishu.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

export function getUserTelegramConfig(userId: string): UserTelegramConfig | null {
  const filePath = path.join(userImDir(userId), 'telegram.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const stored = parsed as unknown as StoredTelegramProviderConfigV1;
    const secret = decryptTelegramSecret(stored.secret);
    return {
      botToken: secret.botToken,
      enabled: stored.enabled,
      updatedAt: stored.updatedAt || null,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read user Telegram config');
    return null;
  }
}

export function saveUserTelegramConfig(
  userId: string,
  next: Omit<UserTelegramConfig, 'updatedAt'>,
): UserTelegramConfig {
  const normalized: UserTelegramConfig = {
    botToken: normalizeSecret(next.botToken, 'botToken'),
    enabled: next.enabled,
    updatedAt: new Date().toISOString(),
  };

  const payload: StoredTelegramProviderConfigV1 = {
    version: 1,
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || new Date().toISOString(),
    secret: encryptTelegramSecret({ botToken: normalized.botToken }),
  };

  const dir = userImDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'telegram.json');
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

// ─── System settings (plain JSON, no encryption) ─────────────────

const SYSTEM_SETTINGS_FILE = path.join(RUNTIME_CONFIG_DIR, 'system-settings.json');

export interface SystemSettings {
  containerTimeout: number;
  idleTimeout: number;
  containerMaxOutputSize: number;
  maxConcurrentContainers: number;
  maxConcurrentHostProcesses: number;
  maxLoginAttempts: number;
  loginLockoutMinutes: number;
}

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  containerTimeout: 1800000,
  idleTimeout: 1800000,
  containerMaxOutputSize: 10485760,
  maxConcurrentContainers: 20,
  maxConcurrentHostProcesses: 5,
  maxLoginAttempts: 5,
  loginLockoutMinutes: 15,
};

function parseIntEnv(envVar: string | undefined, fallback: number): number {
  if (!envVar) return fallback;
  const parsed = parseInt(envVar, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// In-memory cache: avoid synchronous file I/O on hot paths (stdout data handler, queue capacity check)
let _settingsCache: SystemSettings | null = null;
let _settingsMtimeMs = 0;

function readSystemSettingsFromFile(): SystemSettings | null {
  if (!fs.existsSync(SYSTEM_SETTINGS_FILE)) return null;
  const raw = JSON.parse(
    fs.readFileSync(SYSTEM_SETTINGS_FILE, 'utf-8'),
  ) as Record<string, unknown>;
  return {
    containerTimeout:
      typeof raw.containerTimeout === 'number' && raw.containerTimeout > 0
        ? raw.containerTimeout
        : DEFAULT_SYSTEM_SETTINGS.containerTimeout,
    idleTimeout:
      typeof raw.idleTimeout === 'number' && raw.idleTimeout > 0
        ? raw.idleTimeout
        : DEFAULT_SYSTEM_SETTINGS.idleTimeout,
    containerMaxOutputSize:
      typeof raw.containerMaxOutputSize === 'number' && raw.containerMaxOutputSize > 0
        ? raw.containerMaxOutputSize
        : DEFAULT_SYSTEM_SETTINGS.containerMaxOutputSize,
    maxConcurrentContainers:
      typeof raw.maxConcurrentContainers === 'number' && raw.maxConcurrentContainers > 0
        ? raw.maxConcurrentContainers
        : DEFAULT_SYSTEM_SETTINGS.maxConcurrentContainers,
    maxConcurrentHostProcesses:
      typeof raw.maxConcurrentHostProcesses === 'number' && raw.maxConcurrentHostProcesses > 0
        ? raw.maxConcurrentHostProcesses
        : DEFAULT_SYSTEM_SETTINGS.maxConcurrentHostProcesses,
    maxLoginAttempts:
      typeof raw.maxLoginAttempts === 'number' && raw.maxLoginAttempts > 0
        ? raw.maxLoginAttempts
        : DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts,
    loginLockoutMinutes:
      typeof raw.loginLockoutMinutes === 'number' && raw.loginLockoutMinutes > 0
        ? raw.loginLockoutMinutes
        : DEFAULT_SYSTEM_SETTINGS.loginLockoutMinutes,
  };
}

function buildEnvFallbackSettings(): SystemSettings {
  return {
    containerTimeout: parseIntEnv(process.env.CONTAINER_TIMEOUT, DEFAULT_SYSTEM_SETTINGS.containerTimeout),
    idleTimeout: parseIntEnv(process.env.IDLE_TIMEOUT, DEFAULT_SYSTEM_SETTINGS.idleTimeout),
    containerMaxOutputSize: parseIntEnv(process.env.CONTAINER_MAX_OUTPUT_SIZE, DEFAULT_SYSTEM_SETTINGS.containerMaxOutputSize),
    maxConcurrentContainers: parseIntEnv(process.env.MAX_CONCURRENT_CONTAINERS, DEFAULT_SYSTEM_SETTINGS.maxConcurrentContainers),
    maxConcurrentHostProcesses: parseIntEnv(process.env.MAX_CONCURRENT_HOST_PROCESSES, DEFAULT_SYSTEM_SETTINGS.maxConcurrentHostProcesses),
    maxLoginAttempts: parseIntEnv(process.env.MAX_LOGIN_ATTEMPTS, DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts),
    loginLockoutMinutes: parseIntEnv(process.env.LOGIN_LOCKOUT_MINUTES, DEFAULT_SYSTEM_SETTINGS.loginLockoutMinutes),
  };
}

export function getSystemSettings(): SystemSettings {
  // Fast path: return cached value if file hasn't changed
  try {
    if (_settingsCache) {
      if (!fs.existsSync(SYSTEM_SETTINGS_FILE)) return _settingsCache;
      const mtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs;
      if (mtimeMs === _settingsMtimeMs) return _settingsCache;
    }
  } catch {
    // stat failed — fall through to full read
  }

  // 1. Try reading from file
  try {
    if (fs.existsSync(SYSTEM_SETTINGS_FILE)) {
      const settings = readSystemSettingsFromFile();
      if (settings) {
        _settingsCache = settings;
        try { _settingsMtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs; } catch { /* ignore */ }
        return settings;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read system settings, falling back to env/defaults');
  }

  // 2. Fall back to env vars, then hardcoded defaults
  const settings = buildEnvFallbackSettings();
  _settingsCache = settings;
  _settingsMtimeMs = 0; // no file — will re-check on next call
  return settings;
}

export function saveSystemSettings(partial: Partial<SystemSettings>): SystemSettings {
  const existing = getSystemSettings();
  const merged: SystemSettings = { ...existing, ...partial };

  // Range validation
  if (merged.containerTimeout < 60000) merged.containerTimeout = 60000;           // min 1 min
  if (merged.containerTimeout > 86400000) merged.containerTimeout = 86400000;     // max 24 hours
  if (merged.idleTimeout < 60000) merged.idleTimeout = 60000;
  if (merged.idleTimeout > 86400000) merged.idleTimeout = 86400000;
  if (merged.containerMaxOutputSize < 1048576) merged.containerMaxOutputSize = 1048576;   // min 1MB
  if (merged.containerMaxOutputSize > 104857600) merged.containerMaxOutputSize = 104857600; // max 100MB
  if (merged.maxConcurrentContainers < 1) merged.maxConcurrentContainers = 1;
  if (merged.maxConcurrentContainers > 100) merged.maxConcurrentContainers = 100;
  if (merged.maxConcurrentHostProcesses < 1) merged.maxConcurrentHostProcesses = 1;
  if (merged.maxConcurrentHostProcesses > 50) merged.maxConcurrentHostProcesses = 50;
  if (merged.maxLoginAttempts < 1) merged.maxLoginAttempts = 1;
  if (merged.maxLoginAttempts > 100) merged.maxLoginAttempts = 100;
  if (merged.loginLockoutMinutes < 1) merged.loginLockoutMinutes = 1;
  if (merged.loginLockoutMinutes > 1440) merged.loginLockoutMinutes = 1440;       // max 24 hours

  fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
  const tmp = `${SYSTEM_SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, SYSTEM_SETTINGS_FILE);

  // Update in-memory cache immediately
  _settingsCache = merged;
  try { _settingsMtimeMs = fs.statSync(SYSTEM_SETTINGS_FILE).mtimeMs; } catch { /* ignore */ }

  return merged;
}
