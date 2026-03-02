import type {
  TunnelHandle,
  TunnelProviderAdapter,
} from './provider-adapter.js';
import type { RemoteAccessStateStore } from './state-store.js';
import type {
  TunnelStartRequest,
  TunnelStatusSnapshot,
} from './types.js';

export interface TunnelManagerOptions {
  stateStore: RemoteAccessStateStore;
  providers: TunnelProviderAdapter[];
  now?: () => Date;
  onStatusChanged?: (snapshot: TunnelStatusSnapshot) => void;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class TunnelManager {
  private readonly stateStore: RemoteAccessStateStore;
  private readonly providers: Map<string, TunnelProviderAdapter>;
  private readonly now: () => Date;
  private readonly onStatusChanged?: (snapshot: TunnelStatusSnapshot) => void;
  private activeHandle: TunnelHandle | undefined;
  private activeRequest: TunnelStartRequest | undefined;
  private stopRequested = false;
  private restartCount = 0;

  constructor(options: TunnelManagerOptions) {
    this.stateStore = options.stateStore;
    this.providers = new Map(
      options.providers.map((provider) => [provider.kind, provider]),
    );
    this.now = options.now ?? (() => new Date());
    this.onStatusChanged = options.onStatusChanged;
  }

  async start(request: TunnelStartRequest): Promise<TunnelStatusSnapshot> {
    if (this.activeHandle) {
      await this.stop();
    }
    this.stopRequested = false;
    this.restartCount = 0;
    this.activeRequest = { ...request };
    return this.startCurrentRequest();
  }

  async stop(): Promise<TunnelStatusSnapshot> {
    this.stopRequested = true;
    this.activeRequest = undefined;

    const handle = this.activeHandle;
    this.activeHandle = undefined;
    if (handle) {
      try {
        await handle.stop();
      } catch (error) {
        return this.patchTunnel({
          status: 'error',
          publicUrl: undefined,
          lastError: formatError(error),
        });
      }
    }

    this.restartCount = 0;
    return this.patchTunnel({
      status: 'stopped',
      publicUrl: undefined,
      lastError: undefined,
    });
  }

  async getStatus(): Promise<TunnelStatusSnapshot> {
    const state = await this.stateStore.read();
    return state.tunnel;
  }

  private async startCurrentRequest(): Promise<TunnelStatusSnapshot> {
    if (!this.activeRequest) {
      throw new Error('No active tunnel request.');
    }

    const request = this.activeRequest;
    await this.patchTunnel({
      status: 'starting',
      provider: request.provider,
      targetUrl: request.targetUrl,
      publicUrl: undefined,
      startedAt: undefined,
      lastError: undefined,
      restartCount: this.restartCount,
    });

    const provider = this.providers.get(request.provider);
    if (!provider) {
      await this.patchTunnel({
        status: 'error',
        provider: request.provider,
        targetUrl: request.targetUrl,
        publicUrl: undefined,
        lastError: `Tunnel provider "${request.provider}" is not registered.`,
      });
      throw new Error(`Tunnel provider "${request.provider}" is not registered.`);
    }

    try {
      const handle = await provider.start({
        targetUrl: request.targetUrl,
        metadata: request.metadata,
      });
      this.activeHandle = handle;
      const running = await this.patchTunnel({
        status: 'running',
        provider: request.provider,
        targetUrl: request.targetUrl,
        publicUrl: handle.publicUrl,
        startedAt: this.now().toISOString(),
        lastError: undefined,
        restartCount: this.restartCount,
      });
      this.watchHandle(handle, request);
      return running;
    } catch (error) {
      const message = formatError(error);
      await this.patchTunnel({
        status: 'error',
        provider: request.provider,
        targetUrl: request.targetUrl,
        publicUrl: undefined,
        lastError: message,
      });
      throw new Error(message);
    }
  }

  private watchHandle(handle: TunnelHandle, request: TunnelStartRequest): void {
    if (!handle.waitForExit) {
      return;
    }

    void handle
      .waitForExit()
      .then(async (exitCode) => {
        if (this.activeHandle !== handle) {
          return;
        }
        this.activeHandle = undefined;
        await this.onUnexpectedExit(request, exitCode ?? null, undefined);
      })
      .catch(async (error) => {
        if (this.activeHandle !== handle) {
          return;
        }
        this.activeHandle = undefined;
        await this.onUnexpectedExit(request, null, error);
      });
  }

  private async onUnexpectedExit(
    request: TunnelStartRequest,
    exitCode: number | null,
    error: unknown,
  ): Promise<void> {
    if (this.stopRequested) {
      return;
    }

    const errorMessage = error
      ? formatError(error)
      : `Tunnel process exited with code ${String(exitCode)}.`;

    if (!request.autoRestart) {
      await this.patchTunnel({
        status: 'stopped',
        publicUrl: undefined,
        lastError: errorMessage,
      });
      return;
    }

    this.restartCount += 1;
    await this.startCurrentRequest().catch(() => undefined);
  }

  private async patchTunnel(
    patch: Partial<TunnelStatusSnapshot>,
  ): Promise<TunnelStatusSnapshot> {
    const updated = await this.stateStore.update((state) => ({
      ...state,
      tunnel: {
        ...state.tunnel,
        ...patch,
        updatedAt: this.now().toISOString(),
      },
    }));
    this.onStatusChanged?.(updated.tunnel);
    return updated.tunnel;
  }
}
