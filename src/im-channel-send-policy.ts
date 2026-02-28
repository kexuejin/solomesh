import type { ImChannel } from './types.js';

export interface ImChannelSendOptions {
  allowChannels?: Partial<Record<ImChannel, boolean>>;
}

export function isImChannelSendAllowed(
  channel: ImChannel,
  options?: ImChannelSendOptions,
): boolean {
  const policy = options?.allowChannels;
  if (!policy) return true;
  return policy[channel] !== false;
}
