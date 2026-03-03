import type { z } from 'zod';

import {
  mergeSystemFeishuConfig,
  mergeSystemTelegramConfig,
  mergeUserFeishuConfig,
  mergeUserTelegramConfig,
  type FeishuConfigPatchInput,
  type TelegramConfigPatchInput,
} from './im-channel-config-merge.js';
import { logger } from './logger.js';
import { FeishuConfigSchema, TelegramConfigSchema } from './schemas.js';
import {
  getFeishuProviderConfig,
  getFeishuProviderConfigWithSource,
  getTelegramProviderConfig,
  getTelegramProviderConfigWithSource,
  getUserFeishuConfig,
  getUserTelegramConfig,
  saveFeishuProviderConfig,
  saveTelegramProviderConfig,
  saveUserFeishuConfig,
  saveUserTelegramConfig,
  toPublicFeishuProviderConfig,
  toPublicTelegramProviderConfig,
  type FeishuConfigSource,
  type FeishuProviderConfig,
  type FeishuProviderPublicConfig,
  type TelegramConfigSource,
  type TelegramProviderConfig,
  type TelegramProviderPublicConfig,
  type UserFeishuConfig,
  type UserTelegramConfig,
} from './runtime-config.js';
import type { ImChannel } from './types.js';

type ImChannelConfigSourceMap = {
  feishu: FeishuConfigSource;
  telegram: TelegramConfigSource;
};

type ImChannelSystemConfigMap = {
  feishu: FeishuProviderConfig;
  telegram: TelegramProviderConfig;
};

type ImChannelUserConfigMap = {
  feishu: UserFeishuConfig;
  telegram: UserTelegramConfig;
};

type ImChannelPatchInputMap = {
  feishu: FeishuConfigPatchInput;
  telegram: TelegramConfigPatchInput;
};

type ImChannelSystemPublicConfigMap = {
  feishu: FeishuProviderPublicConfig;
  telegram: TelegramProviderPublicConfig;
};

type ImChannelUserPublicConfigMap = {
  feishu: Omit<FeishuProviderPublicConfig, 'source'> & {
    source?: FeishuConfigSource;
  };
  telegram: Omit<TelegramProviderPublicConfig, 'source'> & {
    source?: TelegramConfigSource;
  };
};

type ImChannelSchemaMap = {
  feishu: typeof FeishuConfigSchema;
  telegram: typeof TelegramConfigSchema;
};

export interface ImChannelConnectionTestResult {
  status: 200 | 400;
  payload: Record<string, unknown>;
}

export interface ImChannelConfigRouteDescriptor<C extends ImChannel = ImChannel> {
  channel: C;
  routeSegment: C;
  displayName: string;
  schema: ImChannelSchemaMap[C];
  getSystemConfigWithSource(): {
    config: ImChannelSystemConfigMap[C];
    source: ImChannelConfigSourceMap[C];
  };
  getSystemConfig(): ImChannelSystemConfigMap[C];
  mergeSystemConfig(
    current: ImChannelSystemConfigMap[C],
    patch: ImChannelPatchInputMap[C],
  ): Omit<ImChannelSystemConfigMap[C], 'updatedAt'>;
  saveSystemConfig(
    next: Omit<ImChannelSystemConfigMap[C], 'updatedAt'>,
  ): ImChannelSystemConfigMap[C];
  toPublicSystemConfig(
    config: ImChannelSystemConfigMap[C],
    source: ImChannelConfigSourceMap[C],
  ): ImChannelSystemPublicConfigMap[C];
  getUserConfig(userId: string): ImChannelUserConfigMap[C] | null;
  mergeUserConfig(
    current: ImChannelUserConfigMap[C] | null,
    patch: ImChannelPatchInputMap[C],
  ): ImChannelUserConfigMap[C];
  saveUserConfig(
    userId: string,
    next: ImChannelUserConfigMap[C],
  ): ImChannelUserConfigMap[C];
  toPublicUserConfig(
    config: ImChannelUserConfigMap[C],
  ): ImChannelUserPublicConfigMap[C];
  emptyUserPublicConfig: ImChannelUserPublicConfigMap[C];
  loadSystemErrorMessage: string;
  invalidSystemPayloadMessage: string;
  loadUserErrorMessage: string;
  invalidUserPayloadMessage: string;
  invalidUserPayloadLogMessage: string;
  systemConnectionTest?(): Promise<ImChannelConnectionTestResult>;
  userConnectionTest?(userId: string): Promise<ImChannelConnectionTestResult>;
}

async function runTelegramConnectionTest(
  botToken: string,
  missingConfigError: string,
  failureLogMessage: string,
): Promise<ImChannelConnectionTestResult> {
  if (!botToken) {
    return {
      status: 400,
      payload: { error: missingConfigError },
    };
  }
  try {
    const { Bot } = await import('grammy');
    const testBot = new Bot(botToken);
    const me = await testBot.api.getMe();
    return {
      status: 200,
      payload: {
        success: true,
        bot_username: me.username,
        bot_id: me.id,
        bot_name: me.first_name,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to connect to Telegram';
    logger.warn({ err }, failureLogMessage);
    return {
      status: 400,
      payload: { error: message },
    };
  }
}

type ImChannelDescriptorMap = {
  [K in ImChannel]: ImChannelConfigRouteDescriptor<K>;
};

const CHANNEL_CONFIG_DESCRIPTORS: ImChannelDescriptorMap = {
  feishu: {
    channel: 'feishu',
    routeSegment: 'feishu',
    displayName: 'Feishu',
    schema: FeishuConfigSchema,
    getSystemConfigWithSource: () => getFeishuProviderConfigWithSource(),
    getSystemConfig: () => getFeishuProviderConfig(),
    mergeSystemConfig: (current, patch) => mergeSystemFeishuConfig(current, patch),
    saveSystemConfig: (next) => saveFeishuProviderConfig(next),
    toPublicSystemConfig: (config, source) =>
      toPublicFeishuProviderConfig(config, source),
    getUserConfig: (userId) => getUserFeishuConfig(userId),
    mergeUserConfig: (current, patch) => mergeUserFeishuConfig(current, patch),
    saveUserConfig: (userId, next) =>
      saveUserFeishuConfig(userId, {
        appId: next.appId,
        appSecret: next.appSecret,
        enabled: next.enabled,
      }),
    toPublicUserConfig: (config) => toPublicFeishuProviderConfig(config, 'runtime'),
    emptyUserPublicConfig: {
      appId: '',
      hasAppSecret: false,
      appSecretMasked: null,
      enabled: false,
      updatedAt: null,
    },
    loadSystemErrorMessage: 'Failed to load Feishu config',
    invalidSystemPayloadMessage: 'Invalid Feishu config payload',
    loadUserErrorMessage: 'Failed to load user Feishu config',
    invalidUserPayloadMessage: 'Invalid Feishu config payload',
    invalidUserPayloadLogMessage: 'Invalid user Feishu config payload',
  },
  telegram: {
    channel: 'telegram',
    routeSegment: 'telegram',
    displayName: 'Telegram',
    schema: TelegramConfigSchema,
    getSystemConfigWithSource: () => getTelegramProviderConfigWithSource(),
    getSystemConfig: () => getTelegramProviderConfig(),
    mergeSystemConfig: (current, patch) => mergeSystemTelegramConfig(current, patch),
    saveSystemConfig: (next) => saveTelegramProviderConfig(next),
    toPublicSystemConfig: (config, source) =>
      toPublicTelegramProviderConfig(config, source),
    getUserConfig: (userId) => getUserTelegramConfig(userId),
    mergeUserConfig: (current, patch) => mergeUserTelegramConfig(current, patch),
    saveUserConfig: (userId, next) =>
      saveUserTelegramConfig(userId, {
        botToken: next.botToken,
        enabled: next.enabled,
      }),
    toPublicUserConfig: (config) => toPublicTelegramProviderConfig(config, 'runtime'),
    emptyUserPublicConfig: {
      hasBotToken: false,
      botTokenMasked: null,
      proxyUrl: '',
      enabled: false,
      updatedAt: null,
    },
    loadSystemErrorMessage: 'Failed to load Telegram config',
    invalidSystemPayloadMessage: 'Invalid Telegram config payload',
    loadUserErrorMessage: 'Failed to load user Telegram config',
    invalidUserPayloadMessage: 'Invalid Telegram config payload',
    invalidUserPayloadLogMessage: 'Invalid user Telegram config payload',
    systemConnectionTest: async () =>
      runTelegramConnectionTest(
        getTelegramProviderConfig().botToken,
        'Telegram bot token not configured',
        'Failed to test Telegram connection',
      ),
    userConnectionTest: async (userId) =>
      runTelegramConnectionTest(
        getUserTelegramConfig(userId)?.botToken || '',
        'Telegram bot token not configured',
        'Failed to test user Telegram connection',
      ),
  },
};

export function listImChannelConfigDescriptors(): ImChannelConfigRouteDescriptor[] {
  return [CHANNEL_CONFIG_DESCRIPTORS.feishu, CHANNEL_CONFIG_DESCRIPTORS.telegram];
}

export function getImChannelConfigDescriptor<C extends ImChannel>(
  channel: C,
): ImChannelConfigRouteDescriptor<C> {
  return CHANNEL_CONFIG_DESCRIPTORS[channel];
}
