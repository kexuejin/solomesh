import { listImChannelDefinitions } from './im-channel.js';
import type {
  ResolveImChannelConfigInputMap,
  ResolveImChannelConfigWithSourceInputMap,
} from './im-channel-effective-config.js';
import {
  getFeishuProviderConfigWithSource,
  getTelegramProviderConfigWithSource,
  getUserFeishuConfig,
  getUserTelegramConfig,
} from './runtime-config.js';
import type { ImChannel } from './types.js';

export type ImChannelUserConfigGetter<C extends ImChannel> = (
  userId: string,
) => unknown;
export type ImChannelGlobalConfigGetter<C extends ImChannel> = () => {
  source: string;
  config: unknown;
};

type ImChannelUserConfigGetterMap = {
  [K in ImChannel]: ImChannelUserConfigGetter<K>;
};

type ImChannelGlobalConfigGetterMap = {
  [K in ImChannel]: ImChannelGlobalConfigGetter<K>;
};

const DEFAULT_IM_CHANNEL_USER_CONFIG_GETTERS: ImChannelUserConfigGetterMap = {
  feishu: (userId) => getUserFeishuConfig(userId),
  telegram: (userId) => getUserTelegramConfig(userId),
};

const DEFAULT_IM_CHANNEL_GLOBAL_CONFIG_GETTERS: ImChannelGlobalConfigGetterMap = {
  feishu: () => getFeishuProviderConfigWithSource(),
  telegram: () => getTelegramProviderConfigWithSource(),
};

const registeredImChannelUserConfigGetters = new Map<
  ImChannel,
  ImChannelUserConfigGetter<ImChannel>
>(
  Object.entries(DEFAULT_IM_CHANNEL_USER_CONFIG_GETTERS) as Array<
    [ImChannel, ImChannelUserConfigGetter<ImChannel>]
  >,
);

const registeredImChannelGlobalConfigGetters = new Map<
  ImChannel,
  ImChannelGlobalConfigGetter<ImChannel>
>(
  Object.entries(DEFAULT_IM_CHANNEL_GLOBAL_CONFIG_GETTERS) as Array<
    [ImChannel, ImChannelGlobalConfigGetter<ImChannel>]
  >,
);

export function registerImChannelUserConfigGetter<C extends ImChannel>(
  channel: C,
  getter: ImChannelUserConfigGetter<C>,
): ImChannelUserConfigGetter<C> | null {
  const previous = registeredImChannelUserConfigGetters.get(channel) || null;
  registeredImChannelUserConfigGetters.set(
    channel,
    getter as ImChannelUserConfigGetter<ImChannel>,
  );
  return previous as ImChannelUserConfigGetter<C> | null;
}

export function registerImChannelGlobalConfigGetter<C extends ImChannel>(
  channel: C,
  getter: ImChannelGlobalConfigGetter<C>,
): ImChannelGlobalConfigGetter<C> | null {
  const previous = registeredImChannelGlobalConfigGetters.get(channel) || null;
  registeredImChannelGlobalConfigGetters.set(
    channel,
    getter as ImChannelGlobalConfigGetter<ImChannel>,
  );
  return previous as ImChannelGlobalConfigGetter<C> | null;
}

export function buildUserImChannelConfigMap(
  userId: string,
): ResolveImChannelConfigInputMap {
  const configs: ResolveImChannelConfigInputMap = {};
  for (const def of listImChannelDefinitions()) {
    const getter = registeredImChannelUserConfigGetters.get(def.id);
    if (!getter) continue;
    configs[def.id] = getter(userId);
  }
  return configs;
}

export function buildGlobalImChannelConfigMap(): ResolveImChannelConfigWithSourceInputMap {
  const configs: ResolveImChannelConfigWithSourceInputMap = {};
  for (const def of listImChannelDefinitions()) {
    const getter = registeredImChannelGlobalConfigGetters.get(def.id);
    if (!getter) continue;
    configs[def.id] = getter();
  }
  return configs;
}
