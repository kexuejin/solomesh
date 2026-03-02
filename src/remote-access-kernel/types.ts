export type TunnelProviderKind = 'cloudflared' | 'ngrok' | 'tunwg' | 'custom';

export type TunnelStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface TunnelStatusSnapshot {
  status: TunnelStatus;
  provider?: TunnelProviderKind;
  targetUrl?: string;
  publicUrl?: string;
  startedAt?: string;
  updatedAt: string;
  restartCount: number;
  lastError?: string;
}

export interface TunnelStartRequest {
  provider: TunnelProviderKind;
  targetUrl: string;
  autoRestart?: boolean;
  metadata?: Record<string, string>;
}

export interface AccessLinkRequest {
  ttlSeconds: number;
  oneTime?: boolean;
  path?: string;
  extraQuery?: Record<string, string>;
}

export interface AccessLinkResult {
  token: string;
  expiresAt: string;
  url: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: string;
  tokenId: string;
  oneTime: boolean;
  issuedAt: string;
}

export interface AccessTokenRecord {
  tokenId: string;
  issuedAt: string;
  expiresAt: string;
  oneTime: boolean;
}

export type AccessTokenStatus = 'active' | 'expired' | 'revoked' | 'consumed';

export interface AccessTokenListItem extends AccessTokenRecord {
  status: AccessTokenStatus;
}

export type AccessTokenVerifyReason =
  | 'malformed'
  | 'invalid_signature'
  | 'expired'
  | 'revoked'
  | 'consumed';

export interface AccessTokenPayload {
  v: 1;
  iat: number;
  exp: number;
  jti: string;
  oneTime: boolean;
}

export type AccessTokenVerifyResult =
  | {
    valid: true;
    payload: AccessTokenPayload;
  }
  | {
    valid: false;
    reason: AccessTokenVerifyReason;
  };

export interface RemoteAccessKernelState {
  tunnel: TunnelStatusSnapshot;
  revokedTokenIds: string[];
  consumedTokenIds: string[];
  issuedTokens: AccessTokenRecord[];
}

export type RemoteAccessKernelEvent =
  | { type: 'tunnel_status_changed'; snapshot: TunnelStatusSnapshot }
  | { type: 'access_link_created'; link: AccessLinkResult };
