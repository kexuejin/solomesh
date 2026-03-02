import {
  AccessTokenService,
  type VerifyAccessTokenOptions,
} from './access-token-service.js';
import { AccessLinkBuilder } from './link-builder.js';
import type { TunnelProviderAdapter } from './provider-adapter.js';
import {
  InMemoryRemoteAccessStateStore,
  type RemoteAccessStateStore,
} from './state-store.js';
import { TunnelManager } from './tunnel-manager.js';
import type {
  AccessLinkRequest,
  AccessLinkResult,
  AccessTokenListItem,
  AccessTokenVerifyResult,
  RemoteAccessKernelEvent,
  TunnelStartRequest,
  TunnelStatusSnapshot,
} from './types.js';

export interface RemoteAccessKernelOptions {
  tokenSecret: string;
  providerAdapters: TunnelProviderAdapter[];
  stateStore?: RemoteAccessStateStore;
  tokenQueryKey?: string;
  now?: () => Date;
  randomId?: () => string;
}

export class RemoteAccessKernel {
  private readonly listeners = new Set<(event: RemoteAccessKernelEvent) => void>();
  private readonly tunnelManager: TunnelManager;
  private readonly accessTokenService: AccessTokenService;
  private readonly linkBuilder: AccessLinkBuilder;

  constructor(options: RemoteAccessKernelOptions) {
    const stateStore = options.stateStore ?? new InMemoryRemoteAccessStateStore();
    const now = options.now ?? (() => new Date());
    this.accessTokenService = new AccessTokenService({
      secret: options.tokenSecret,
      stateStore,
      now,
      randomId: options.randomId,
    });
    this.tunnelManager = new TunnelManager({
      stateStore,
      providers: options.providerAdapters,
      now,
      onStatusChanged: (snapshot) => {
        this.emit({ type: 'tunnel_status_changed', snapshot });
      },
    });
    this.linkBuilder = new AccessLinkBuilder({
      tokenQueryKey: options.tokenQueryKey,
    });
  }

  async startTunnel(request: TunnelStartRequest): Promise<TunnelStatusSnapshot> {
    return this.tunnelManager.start(request);
  }

  async stopTunnel(): Promise<TunnelStatusSnapshot> {
    return this.tunnelManager.stop();
  }

  async getTunnelStatus(): Promise<TunnelStatusSnapshot> {
    return this.tunnelManager.getStatus();
  }

  async createAccessLink(request: AccessLinkRequest): Promise<AccessLinkResult> {
    const status = await this.tunnelManager.getStatus();
    if (status.status !== 'running' || !status.publicUrl) {
      throw new Error('Tunnel is not running.');
    }

    const issued = await this.accessTokenService.issueToken({
      ttlSeconds: request.ttlSeconds,
      oneTime: request.oneTime,
    });
    const url = this.linkBuilder.build({
      publicUrl: status.publicUrl,
      token: issued.token,
      path: request.path,
      extraQuery: request.extraQuery,
    });

    const result: AccessLinkResult = {
      token: issued.token,
      expiresAt: issued.expiresAt,
      url,
    };
    this.emit({ type: 'access_link_created', link: result });
    return result;
  }

  async verifyAccessToken(
    token: string,
    options: VerifyAccessTokenOptions = {},
  ): Promise<AccessTokenVerifyResult> {
    return this.accessTokenService.verifyToken(token, options);
  }

  async revokeAccessToken(token: string): Promise<boolean> {
    return this.accessTokenService.revokeToken(token);
  }

  async revokeAccessTokenById(tokenId: string): Promise<boolean> {
    return this.accessTokenService.revokeTokenById(tokenId);
  }

  async listAccessTokens(): Promise<AccessTokenListItem[]> {
    return this.accessTokenService.listTokens();
  }

  subscribe(
    listener: (event: RemoteAccessKernelEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: RemoteAccessKernelEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
