import type {
  FeishuConnectConfig,
  ImChannelConnectConfigMap,
  TelegramConnectConfig,
} from './im-manager.js';
import {
  resolveEffectiveImChannelConfigs,
  type EffectiveImChannelConfigs,
} from './im-channel-effective-config.js';
import type { ImChannel } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toFeishuConnectConfig(value: unknown): FeishuConnectConfig | null {
  if (!isRecord(value)) return null;
  const appId = typeof value.appId === 'string' ? value.appId.trim() : '';
  const appSecret =
    typeof value.appSecret === 'string' ? value.appSecret.trim() : '';
  if (!appId || !appSecret) return null;
  const enabled =
    typeof value.enabled === 'boolean' ? value.enabled : undefined;
  return { appId, appSecret, enabled };
}

function toTelegramConnectConfig(value: unknown): TelegramConnectConfig | null {
  if (!isRecord(value)) return null;
  const botToken =
    typeof value.botToken === 'string' ? value.botToken.trim() : '';
  if (!botToken) return null;
  const enabled =
    typeof value.enabled === 'boolean' ? value.enabled : undefined;
  return { botToken, enabled };
}

function isImChannel(channel: string): channel is ImChannel {
  return channel === 'feishu' || channel === 'telegram';
}

export type GlobalReloadConfigParser<C extends ImChannel> = (
  value: unknown,
) => ImChannelConnectConfigMap[C] | null;

type GlobalReloadConfigParserMap = {
  [K in ImChannel]: GlobalReloadConfigParser<K>;
};

const globalReloadConfigParsers: GlobalReloadConfigParserMap = {
  feishu: toFeishuConnectConfig,
  telegram: toTelegramConnectConfig,
};

export function registerGlobalReloadConfigParser<C extends ImChannel>(
  channel: C,
  parser: GlobalReloadConfigParser<C>,
): GlobalReloadConfigParser<C> | null {
  const previous = globalReloadConfigParsers[channel];
  globalReloadConfigParsers[channel] = parser as GlobalReloadConfigParserMap[C];
  return previous as GlobalReloadConfigParser<C>;
}

export function buildGlobalReloadCandidateConfigs(
  channel: string,
  config: unknown,
): EffectiveImChannelConfigs | null {
  if (!isImChannel(channel)) return null;
  const parser = globalReloadConfigParsers[channel];
  const parsed = parser(config);
  if (!parsed) return null;

  const globalConfigs: EffectiveImChannelConfigs = {
    feishu: null,
    telegram: null,
  };
  if (channel === 'feishu') {
    globalConfigs.feishu = parsed as FeishuConnectConfig;
  } else {
    globalConfigs.telegram = parsed as TelegramConnectConfig;
  }

  return resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {},
    globalConfigs: {
      feishu: {
        source: globalConfigs.feishu ? 'runtime' : 'none',
        config: globalConfigs.feishu,
      },
      telegram: {
        source: globalConfigs.telegram ? 'runtime' : 'none',
        config: globalConfigs.telegram,
      },
    },
  });
}
