import { logger } from './logger.js';
import type { ImChannel } from './types.js';
import type { WebDeps } from './web-context.js';

type WarnFn = (payload: Record<string, unknown>, message: string) => void;

interface ReloadHelperOptions {
  warn?: WarnFn;
}

export async function reloadGlobalImChannelBestEffort(
  deps: Pick<WebDeps, 'reloadGlobalIMConfig'> | null | undefined,
  channel: ImChannel,
  config: unknown,
  options: ReloadHelperOptions = {},
): Promise<boolean> {
  if (!deps?.reloadGlobalIMConfig) return false;
  const warn = options.warn || ((payload, message) => logger.warn(payload, message));
  try {
    return await deps.reloadGlobalIMConfig(channel, config);
  } catch (err: unknown) {
    warn({ err, channel }, `Failed to reload ${channel} connection`);
    return false;
  }
}

export async function reloadUserImChannelBestEffort(
  deps: Pick<WebDeps, 'reloadUserIMConfig'> | null | undefined,
  userId: string,
  channel: ImChannel,
  options: ReloadHelperOptions = {},
): Promise<void> {
  if (!deps?.reloadUserIMConfig) return;
  const warn = options.warn || ((payload, message) => logger.warn(payload, message));
  try {
    await deps.reloadUserIMConfig(userId, channel);
  } catch (err: unknown) {
    warn({ err, userId, channel }, `Failed to hot-reload user ${channel} connection`);
  }
}
