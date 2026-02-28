import type {
  FeishuConnectConfig,
  ImChannelConnectConfigMap,
  TelegramConnectConfig,
} from './im-manager.js';
import { listImChannelDefinitions } from './im-channel.js';
import type { ImChannel } from './types.js';

interface WithSource<T> {
  source: string;
  config: T;
}

export type ResolveImChannelConfigInputMap = Partial<
  Record<ImChannel, unknown>
>;

export type ResolveImChannelConfigWithSourceInputMap = Partial<
  Record<ImChannel, WithSource<unknown>>
>;

export interface ResolveEffectiveImChannelConfigsInput {
  isAdmin: boolean;
  userConfigs: ResolveImChannelConfigInputMap;
  globalConfigs: ResolveImChannelConfigWithSourceInputMap;
}

export type EffectiveImChannelConfigs = {
  [K in ImChannel]: ImChannelConnectConfigMap[K] | null;
};

export type AnyEffectiveImChannelConfig =
  ImChannelConnectConfigMap[ImChannel];

export type EffectiveImChannelConfigNormalizer<C extends ImChannel> = (
  config: unknown,
) => ImChannelConnectConfigMap[C] | null;

type EffectiveImChannelConfigNormalizerMap = {
  [K in ImChannel]: EffectiveImChannelConfigNormalizer<K>;
};

function isImChannel(channel: string): channel is ImChannel {
  return channel === 'feishu' || channel === 'telegram';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFeishuConfig(
  config: unknown,
): FeishuConnectConfig | null {
  if (!isRecord(config)) return null;
  const appId = typeof config.appId === 'string' ? config.appId.trim() : '';
  const appSecret =
    typeof config.appSecret === 'string' ? config.appSecret.trim() : '';
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : undefined,
  };
}

function normalizeTelegramConfig(
  config: unknown,
): TelegramConnectConfig | null {
  if (!isRecord(config)) return null;
  const botToken = typeof config.botToken === 'string' ? config.botToken.trim() : '';
  if (!botToken) return null;
  return {
    botToken,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : undefined,
  };
}

const effectiveImChannelConfigNormalizers: EffectiveImChannelConfigNormalizerMap = {
  feishu: normalizeFeishuConfig,
  telegram: normalizeTelegramConfig,
};

export function registerEffectiveImChannelConfigNormalizer<C extends ImChannel>(
  channel: C,
  normalizer: EffectiveImChannelConfigNormalizer<C>,
): EffectiveImChannelConfigNormalizer<C> | null {
  const previous = effectiveImChannelConfigNormalizers[channel];
  effectiveImChannelConfigNormalizers[channel] =
    normalizer as EffectiveImChannelConfigNormalizerMap[C];
  return previous as EffectiveImChannelConfigNormalizer<C>;
}

function createEmptyEffectiveImChannelConfigs(): EffectiveImChannelConfigs {
  const configs = {} as EffectiveImChannelConfigs;
  for (const def of listImChannelDefinitions()) {
    configs[def.id] = null;
  }
  return configs;
}

export function resolveEffectiveImChannelConfigs(
  input: ResolveEffectiveImChannelConfigsInput,
): EffectiveImChannelConfigs {
  const effectiveConfigs = createEmptyEffectiveImChannelConfigs();
  const effectiveConfigMap = effectiveConfigs as Record<
    ImChannel,
    AnyEffectiveImChannelConfig | null
  >;
  for (const def of listImChannelDefinitions()) {
    const channel = def.id;
    const normalize = effectiveImChannelConfigNormalizers[channel];
    const user = normalize(input.userConfigs[channel]);

    let global: AnyEffectiveImChannelConfig | null = null;
    const globalConfig = input.globalConfigs[channel];
    if (input.isAdmin && globalConfig && globalConfig.source !== 'none') {
      global = normalize(globalConfig.config);
    }

    effectiveConfigMap[channel] = user || global;
  }
  return effectiveConfigs;
}

export function selectEffectiveImChannelConfig<C extends ImChannel>(
  configs: EffectiveImChannelConfigs,
  channel: C,
): EffectiveImChannelConfigs[C];
export function selectEffectiveImChannelConfig(
  configs: EffectiveImChannelConfigs,
  channel: string,
): AnyEffectiveImChannelConfig | null;
export function selectEffectiveImChannelConfig(
  configs: EffectiveImChannelConfigs,
  channel: string,
): AnyEffectiveImChannelConfig | null {
  if (!isImChannel(channel)) return null;
  const value = configs[channel];
  return value || null;
}

export function hasAnyEffectiveImChannelConfig(
  configs: EffectiveImChannelConfigs,
): boolean {
  for (const def of listImChannelDefinitions()) {
    if (configs[def.id]) return true;
  }
  return false;
}

export function hasEnabledGlobalImChannelConfig(
  globalConfigs: ResolveImChannelConfigWithSourceInputMap,
  channel: ImChannel,
): boolean {
  const effectiveConfigs = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {},
    globalConfigs,
  });
  const channelConfig = selectEffectiveImChannelConfig(effectiveConfigs, channel);
  return !!channelConfig && channelConfig.enabled !== false;
}
