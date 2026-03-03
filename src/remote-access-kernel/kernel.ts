import crypto from 'node:crypto';

import {
  AccessTokenService,
  type VerifyAccessTokenOptions,
} from './access-token-service.js';
import type { TunnelProviderAdapter } from './provider-adapter.js';
import {
  InMemoryRemoteAccessStateStore,
  type RemoteAccessStateStore,
} from './state-store.js';
import { TunnelManager } from './tunnel-manager.js';
import type {
  AccessLinkRequest,
  AccessLinkResult,
  AccessLinkMode,
  AccessTokenListItem,
  AccessTokenVerifyResult,
  RemoteAccessLinkPreferences,
  RemoteAccessKernelEvent,
  TunnelStartRequest,
  TunnelStatusSnapshot,
} from './types.js';

export interface RemoteAccessKernelOptions {
  tokenSecret: string;
  providerAdapters: TunnelProviderAdapter[];
  stateStore?: RemoteAccessStateStore;
  now?: () => Date;
  randomId?: () => string;
}

export class RemoteAccessKernel {
  private readonly listeners = new Set<(event: RemoteAccessKernelEvent) => void>();
  private readonly stateStore: RemoteAccessStateStore;
  private readonly tunnelManager: TunnelManager;
  private readonly accessTokenService: AccessTokenService;
  private readonly now: () => Date;

  constructor(options: RemoteAccessKernelOptions) {
    const stateStore = options.stateStore ?? new InMemoryRemoteAccessStateStore();
    const now = options.now ?? (() => new Date());
    this.stateStore = stateStore;
    this.now = now;
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

  async getLinkPreferences(): Promise<RemoteAccessLinkPreferences> {
    const state = await this.stateStore.read();
    return normalizeLinkPreferences(state.preferences);
  }

  async updateLinkPreferences(
    partial: Partial<RemoteAccessLinkPreferences>,
  ): Promise<RemoteAccessLinkPreferences> {
    let nextPreferences: RemoteAccessLinkPreferences = DEFAULT_LINK_PREFERENCES;
    await this.stateStore.update((current) => {
      nextPreferences = normalizeLinkPreferences({
        ...current.preferences,
        ...partial,
      });
      return {
        ...current,
        preferences: nextPreferences,
      };
    });
    return nextPreferences;
  }

  async createAccessLink(request: AccessLinkRequest): Promise<AccessLinkResult> {
    const status = await this.tunnelManager.getStatus();
    if (status.status !== 'running' || !status.publicUrl) {
      throw new Error('Tunnel is not running.');
    }

    const preferences = await this.getLinkPreferences();
    const mode: AccessLinkMode = request.mode === 'public' || request.mode === 'token'
      ? request.mode
      : preferences.mode;
    const linkPath = normalizeLinkPath(request.path);
    let token: string | undefined;
    let expiresAt: string | undefined;
    let code: string;
    if (mode === 'token') {
      const ttlSeconds = request.ttlSeconds ?? preferences.ttlSeconds;
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error('ttlSeconds must be a positive number.');
      }
      const issued = await this.accessTokenService.issueToken({
        ttlSeconds: Math.floor(ttlSeconds),
        oneTime: request.oneTime ?? preferences.oneTime,
        path: linkPath,
      });
      token = issued.token;
      expiresAt = issued.expiresAt;
      code = await this.createAccessCode({
        token,
        path: linkPath,
        expiresAt,
      });
    } else {
      code = await this.createAccessCode({
        path: linkPath,
      });
    }

    const linkUrl = new URL(status.publicUrl);
    linkUrl.pathname = `/r/${encodeURIComponent(code)}`;
    for (const [key, value] of Object.entries(request.extraQuery ?? {})) {
      linkUrl.searchParams.set(key, value);
    }

    const result: AccessLinkResult = {
      mode,
      code,
      token,
      expiresAt,
      url: linkUrl.toString(),
    };
    this.emit({ type: 'access_link_created', link: result });
    return result;
  }

  async resolveAccessCode(
    code: string,
  ): Promise<
      | { ok: true; token?: string; path?: string }
      | { ok: false; reason: 'not_found' | 'expired' }
    > {
    const normalized = code.trim();
    if (!normalized) return { ok: false, reason: 'not_found' };
    const state = await this.stateStore.read();
    const record = state.accessCodes.find((item) => item.code === normalized);
    if (!record) return { ok: false, reason: 'not_found' };
    if (record.expiresAt) {
      const expiresAtMs = new Date(record.expiresAt).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= this.now().getTime()) {
        return { ok: false, reason: 'expired' };
      }
    }
    return {
      ok: true,
      token: record.token,
      path: record.path,
    };
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

  private async createAccessCode(record: {
    token?: string;
    path?: string;
    expiresAt?: string;
  }): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = crypto.randomBytes(6).toString('base64url');
      let created = false;
      await this.stateStore.update((current) => {
        if (current.accessCodes.some((item) => item.code === code)) {
          return current;
        }
        created = true;
        return {
          ...current,
          accessCodes: [
            ...current.accessCodes,
            {
              code,
              createdAt: this.now().toISOString(),
              expiresAt: record.expiresAt,
              token: record.token,
              path: record.path,
            },
          ],
        };
      });
      if (created) {
        return code;
      }
    }
    throw new Error('Failed to allocate unique access code.');
  }
}

const DEFAULT_LINK_PREFERENCES: RemoteAccessLinkPreferences = {
  mode: 'token',
  ttlSeconds: 30 * 60,
  oneTime: false,
};

function normalizeLinkPreferences(
  input: Partial<RemoteAccessLinkPreferences> | undefined,
): RemoteAccessLinkPreferences {
  const mode: AccessLinkMode = input?.mode === 'public' ? 'public' : 'token';
  const ttlCandidate = typeof input?.ttlSeconds === 'number'
    ? Math.floor(input.ttlSeconds)
    : DEFAULT_LINK_PREFERENCES.ttlSeconds;
  const ttlSeconds = Number.isFinite(ttlCandidate) && ttlCandidate > 0
    ? ttlCandidate
    : DEFAULT_LINK_PREFERENCES.ttlSeconds;
  const oneTime = typeof input?.oneTime === 'boolean'
    ? input.oneTime
    : DEFAULT_LINK_PREFERENCES.oneTime;
  return { mode, ttlSeconds, oneTime };
}

function normalizeLinkPath(value: string | undefined): string {
  const input = (value || '/').trim();
  const normalized = input.startsWith('/') ? input : `/${input}`;
  try {
    const parsed = new URL(normalized, 'http://solomesh.local');
    const query = parsed.searchParams.toString();
    return query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    return '/';
  }
}
