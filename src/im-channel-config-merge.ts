import type {
  FeishuProviderConfig,
  TelegramProviderConfig,
  UserFeishuConfig,
  UserTelegramConfig,
} from './runtime-config.js';

export interface FeishuConfigPatchInput {
  appId?: string;
  appSecret?: string;
  clearAppSecret?: boolean;
  enabled?: boolean;
}

export interface TelegramConfigPatchInput {
  botToken?: string;
  clearBotToken?: boolean;
  enabled?: boolean;
}

export function mergeSystemFeishuConfig(
  current: FeishuProviderConfig,
  patch: FeishuConfigPatchInput,
): Omit<FeishuProviderConfig, 'updatedAt'> {
  const next: Omit<FeishuProviderConfig, 'updatedAt'> = {
    appId: current.appId,
    appSecret: current.appSecret,
    enabled: current.enabled,
  };
  if (typeof patch.appId === 'string') {
    next.appId = patch.appId;
  }
  if (typeof patch.appSecret === 'string') {
    next.appSecret = patch.appSecret;
  } else if (patch.clearAppSecret === true) {
    next.appSecret = '';
  }
  if (typeof patch.enabled === 'boolean') {
    next.enabled = patch.enabled;
  }
  return next;
}

export function mergeSystemTelegramConfig(
  current: TelegramProviderConfig,
  patch: TelegramConfigPatchInput,
): Omit<TelegramProviderConfig, 'updatedAt'> {
  const next: Omit<TelegramProviderConfig, 'updatedAt'> = {
    botToken: current.botToken,
    enabled: current.enabled,
  };
  if (typeof patch.botToken === 'string') {
    next.botToken = patch.botToken;
  } else if (patch.clearBotToken === true) {
    next.botToken = '';
  }
  if (typeof patch.enabled === 'boolean') {
    next.enabled = patch.enabled;
  }
  return next;
}

export function mergeUserFeishuConfig(
  current: UserFeishuConfig | null,
  patch: FeishuConfigPatchInput,
): UserFeishuConfig {
  const next: UserFeishuConfig = {
    appId: current?.appId || '',
    appSecret: current?.appSecret || '',
    enabled: current?.enabled ?? true,
    updatedAt: current?.updatedAt || null,
  };
  if (typeof patch.appId === 'string') {
    const appId = patch.appId.trim();
    if (appId) next.appId = appId;
  }
  if (typeof patch.appSecret === 'string') {
    const appSecret = patch.appSecret.trim();
    if (appSecret) next.appSecret = appSecret;
  } else if (patch.clearAppSecret === true) {
    next.appSecret = '';
  }
  if (typeof patch.enabled === 'boolean') {
    next.enabled = patch.enabled;
  } else if (!current && (next.appId || next.appSecret)) {
    next.enabled = true;
  }
  return next;
}

export function mergeUserTelegramConfig(
  current: UserTelegramConfig | null,
  patch: TelegramConfigPatchInput,
): UserTelegramConfig {
  const next: UserTelegramConfig = {
    botToken: current?.botToken || '',
    enabled: current?.enabled ?? true,
    updatedAt: current?.updatedAt || null,
  };
  if (typeof patch.botToken === 'string') {
    const botToken = patch.botToken.trim();
    if (botToken) next.botToken = botToken;
  } else if (patch.clearBotToken === true) {
    next.botToken = '';
  }
  if (typeof patch.enabled === 'boolean') {
    next.enabled = patch.enabled;
  } else if (!current && next.botToken) {
    next.enabled = true;
  }
  return next;
}
