export interface RuntimeConfigPublic {
  agentRuntime: 'claude' | 'codex';
  anthropicBaseUrl: string;
  codexBaseUrl: string;
  codexModel: string;
  updatedAt: string | null;
  hasAnthropicAuthToken: boolean;
  hasAnthropicApiKey: boolean;
  hasClaudeCodeOauthToken: boolean;
  hasCodexApiKey: boolean;
  anthropicAuthTokenMasked: string | null;
  anthropicApiKeyMasked: string | null;
  claudeCodeOauthTokenMasked: string | null;
  codexApiKeyMasked: string | null;
  hasRuntimeOAuthCredentials: boolean;
  claudeOAuthCredentialsExpiresAt: number | null;
  claudeOAuthCredentialsAccessTokenMasked: string | null;
}

export interface FeishuConfigPublic {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
  enabled: boolean;
  connected: boolean;
  updatedAt: string | null;
  source: 'runtime' | 'env' | 'none';
}

export interface TelegramConfigPublic {
  hasBotToken: boolean;
  botTokenMasked: string | null;
  enabled: boolean;
  connected: boolean;
  updatedAt: string | null;
  source: 'runtime' | 'env' | 'none';
}

export interface TelegramTestResult {
  success: boolean;
  bot_username?: string;
  bot_id?: number;
  bot_name?: string;
  error?: string;
}

export interface RuntimeCustomEnvResp {
  customEnv: Record<string, string>;
}

export interface RuntimeApplyResult {
  success: boolean;
  stoppedCount: number;
  failedCount?: number;
  error?: string;
}

export interface EnvRow {
  key: string;
  value: string;
}

export interface SessionInfo {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export interface SettingsNotification {
  setNotice: (msg: string | null) => void;
  setError: (msg: string | null) => void;
}

export interface SystemSettings {
  containerTimeout: number;
  idleTimeout: number;
  containerMaxOutputSize: number;
  maxConcurrentContainers: number;
  maxConcurrentHostProcesses: number;
  maxLoginAttempts: number;
  loginLockoutMinutes: number;
}

export type WorkflowTemplateScope = 'global' | 'user';
export type WorkflowTemplateLifecycle = 'draft' | 'published' | 'archived';
export type WorkflowStageDependencyType = 'provider' | 'skill' | 'channel' | 'mcp';
export type WorkflowStageDependencyOnMissing = 'auto_fix' | 'guide_user' | 'fallback' | 'fail';

export interface WorkflowStageDependencyDef {
  type: WorkflowStageDependencyType;
  ref: string;
  required?: boolean;
  capability?: string;
  onMissing?: WorkflowStageDependencyOnMissing;
}

export interface WorkflowStageDef {
  id: string;
  name: string;
  defaultProvider: 'claude' | 'codex';
  strictProvider?: boolean;
  fallbackProviders?: Array<'claude' | 'codex'>;
  goal: string;
  requiredOutputHints: string[];
  doneKeywords: string[];
  skillRefs?: string[];
  dependencies?: WorkflowStageDependencyDef[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  stages: WorkflowStageDef[];
  recommendedTriggers: string[];
}

export interface WorkflowTemplateRecordPublic {
  scope: WorkflowTemplateScope;
  ownerUserId: string | null;
  lifecycle: WorkflowTemplateLifecycle;
  template: WorkflowTemplate;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  editable: boolean;
  publishable: boolean;
  archivable: boolean;
}

export type SettingsTab =
  | 'channels'
  | 'runtime'
  | 'registration'
  | 'appearance'
  | 'profile'
  | 'my-channels'
  | 'security'
  | 'groups'
  | 'memory'
  | 'skills'
  | 'mcp-servers'
  | 'workflows'
  | 'users'
  | 'about';

export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function sourceLabel(source: FeishuConfigPublic['source']): string {
  if (source === 'runtime') return '来自设置页';
  if (source === 'env') return '来自环境变量';
  return '未配置';
}
