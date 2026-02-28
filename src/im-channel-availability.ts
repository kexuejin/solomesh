import { listImChannelDefinitions } from './im-channel.js';
import { resolveEffectiveImChannelConfigs } from './im-channel-effective-config.js';
import { buildGlobalImChannelConfigMap } from './im-channel-runtime-config.js';
import type { ImChannel } from './types.js';

export type ImChannelAvailabilityMap = Record<string, boolean>;
export type ImChannelAvailabilityResolvers = Partial<
  Record<ImChannel, () => boolean>
>;

const registeredChannelAvailabilityResolvers = new Map<ImChannel, () => boolean>();

export function registerImChannelAvailabilityResolver(
  channel: ImChannel,
  resolver: () => boolean,
): (() => boolean) | null {
  const previous = registeredChannelAvailabilityResolvers.get(channel) || null;
  registeredChannelAvailabilityResolvers.set(channel, resolver);
  return previous;
}

function getRegisteredImChannelAvailabilityResolvers(): ImChannelAvailabilityResolvers {
  return Object.fromEntries(
    registeredChannelAvailabilityResolvers.entries(),
  ) as ImChannelAvailabilityResolvers;
}

function buildDefaultImChannelAvailabilityResolvers(): ImChannelAvailabilityResolvers {
  const effectiveConfigs = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {},
    globalConfigs: buildGlobalImChannelConfigMap(),
  });
  const resolvers: ImChannelAvailabilityResolvers = {};
  for (const def of listImChannelDefinitions()) {
    resolvers[def.id] = () => {
      const config = effectiveConfigs[def.id];
      return !!config && config.enabled !== false;
    };
  }
  return resolvers;
}

export function buildImChannelAvailability(
  resolvers: ImChannelAvailabilityResolvers = {},
): ImChannelAvailabilityMap {
  const availability: ImChannelAvailabilityMap = {};
  for (const def of listImChannelDefinitions()) {
    availability[def.id] = false;
    const resolver = resolvers[def.id];
    if (!resolver) continue;
    try {
      availability[def.id] = resolver() === true;
    } catch {
      availability[def.id] = false;
    }
  }
  return availability;
}

export function getConfiguredImChannelAvailability(): ImChannelAvailabilityMap {
  return buildImChannelAvailability({
    ...buildDefaultImChannelAvailabilityResolvers(),
    ...getRegisteredImChannelAvailabilityResolvers(),
  });
}
