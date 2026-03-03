import type { RemoteAccessKernel } from './kernel.js';
import type { TunnelProviderKind, TunnelStatusSnapshot } from './types.js';

export interface EnsureRemoteAccessTunnelRunningOptions {
  kernel: RemoteAccessKernel;
  defaultTargetUrl: string;
  autoRestart?: boolean;
  fallbackProvider?: TunnelProviderKind;
}

const DEFAULT_FALLBACK_PROVIDER: TunnelProviderKind = 'cloudflared';

export async function ensureRemoteAccessTunnelRunning(
  options: EnsureRemoteAccessTunnelRunningOptions,
): Promise<TunnelStatusSnapshot> {
  const status = await options.kernel.getTunnelStatus();
  if (status.status === 'running' && status.publicUrl) {
    return status;
  }

  const provider = status.provider
    ?? options.fallbackProvider
    ?? DEFAULT_FALLBACK_PROVIDER;
  const targetUrl = status.targetUrl ?? options.defaultTargetUrl;

  return options.kernel.startTunnel({
    provider,
    targetUrl,
    autoRestart: options.autoRestart ?? true,
  });
}
