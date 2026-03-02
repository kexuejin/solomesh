import type { TunnelProviderKind } from './types.js';

export interface TunnelProviderStartContext {
  targetUrl: string;
  metadata?: Record<string, string>;
  env?: NodeJS.ProcessEnv;
}

export interface TunnelHandle {
  publicUrl: string;
  processId?: number;
  stop(): Promise<void>;
  waitForExit?(): Promise<number | null>;
}

export interface TunnelProviderAdapter {
  readonly kind: TunnelProviderKind;
  start(context: TunnelProviderStartContext): Promise<TunnelHandle>;
}
