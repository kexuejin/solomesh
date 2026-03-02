import crypto from 'node:crypto';

import type { RemoteAccessStateStore } from './state-store.js';
import type {
  AccessTokenListItem,
  AccessTokenPayload,
  AccessTokenRecord,
  AccessTokenVerifyResult,
  IssuedAccessToken,
} from './types.js';

export interface IssueAccessTokenRequest {
  ttlSeconds: number;
  oneTime?: boolean;
}

export interface VerifyAccessTokenOptions {
  consumeOneTime?: boolean;
}

export interface AccessTokenServiceOptions {
  secret: string;
  stateStore: RemoteAccessStateStore;
  now?: () => Date;
  randomId?: () => string;
}

function addUnique(items: string[], item: string): string[] {
  if (items.includes(item)) {
    return items;
  }
  return [...items, item];
}

function addOrReplaceIssuedToken(
  issuedTokens: AccessTokenRecord[],
  nextToken: AccessTokenRecord,
): AccessTokenRecord[] {
  const next: AccessTokenRecord[] = issuedTokens.filter(
    (item) => item.tokenId !== nextToken.tokenId,
  );
  next.push(nextToken);
  return next;
}

function parsePayload(value: string): AccessTokenPayload | null {
  try {
    const parsed = JSON.parse(value) as AccessTokenPayload;
    if (
      parsed.v !== 1
      || !Number.isInteger(parsed.iat)
      || !Number.isInteger(parsed.exp)
      || typeof parsed.jti !== 'string'
      || parsed.jti.length === 0
      || typeof parsed.oneTime !== 'boolean'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class AccessTokenService {
  private readonly secret: string;
  private readonly stateStore: RemoteAccessStateStore;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(options: AccessTokenServiceOptions) {
    if (!options.secret) {
      throw new Error('Access token secret must not be empty.');
    }
    this.secret = options.secret;
    this.stateStore = options.stateStore;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  async issueToken(request: IssueAccessTokenRequest): Promise<IssuedAccessToken> {
    if (!Number.isFinite(request.ttlSeconds) || request.ttlSeconds <= 0) {
      throw new Error('ttlSeconds must be a positive number.');
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const expiresAt = issuedAt + Math.floor(request.ttlSeconds);
    const payload: AccessTokenPayload = {
      v: 1,
      iat: issuedAt,
      exp: expiresAt,
      jti: this.randomId(),
      oneTime: request.oneTime ?? false,
    };

    const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const signaturePart = this.sign(payloadPart);
    const token = `${payloadPart}.${signaturePart}`;

    const result: IssuedAccessToken = {
      token,
      tokenId: payload.jti,
      oneTime: payload.oneTime,
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };

    await this.stateStore.update((current) => ({
      ...current,
      issuedTokens: addOrReplaceIssuedToken(current.issuedTokens, {
        tokenId: result.tokenId,
        issuedAt: result.issuedAt,
        expiresAt: result.expiresAt,
        oneTime: result.oneTime,
      }),
    }));

    return result;
  }

  async verifyToken(
    token: string,
    options: VerifyAccessTokenOptions = {},
  ): Promise<AccessTokenVerifyResult> {
    const parsed = this.parseSignedToken(token);
    if (!parsed.ok) {
      return { valid: false, reason: parsed.reason };
    }

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (parsed.payload.exp <= nowSeconds) {
      return { valid: false, reason: 'expired' };
    }

    const state = await this.stateStore.read();
    if (state.revokedTokenIds.includes(parsed.payload.jti)) {
      return { valid: false, reason: 'revoked' };
    }

    if (parsed.payload.oneTime && state.consumedTokenIds.includes(parsed.payload.jti)) {
      return { valid: false, reason: 'consumed' };
    }

    if (options.consumeOneTime && parsed.payload.oneTime) {
      await this.stateStore.update((current) => ({
        ...current,
        consumedTokenIds: addUnique(current.consumedTokenIds, parsed.payload.jti),
      }));
    }

    return { valid: true, payload: parsed.payload };
  }

  async revokeToken(token: string): Promise<boolean> {
    const parsed = this.parseSignedToken(token);
    if (!parsed.ok) {
      return false;
    }
    await this.stateStore.update((current) => ({
      ...current,
      revokedTokenIds: addUnique(current.revokedTokenIds, parsed.payload.jti),
    }));
    return true;
  }

  async revokeTokenById(tokenId: string): Promise<boolean> {
    const normalized = tokenId.trim();
    if (!normalized) {
      return false;
    }

    let existed = false;
    await this.stateStore.update((current) => {
      existed = current.issuedTokens.some((item) => item.tokenId === normalized);
      if (!existed) {
        return current;
      }
      return {
        ...current,
        revokedTokenIds: addUnique(current.revokedTokenIds, normalized),
      };
    });
    return existed;
  }

  async listTokens(): Promise<AccessTokenListItem[]> {
    const state = await this.stateStore.read();
    const nowSeconds = Math.floor(this.now().getTime() / 1000);

    return state.issuedTokens
      .map((item) => {
        let status: AccessTokenListItem['status'] = 'active';
        if (state.revokedTokenIds.includes(item.tokenId)) {
          status = 'revoked';
        } else if (item.oneTime && state.consumedTokenIds.includes(item.tokenId)) {
          status = 'consumed';
        } else if (Math.floor(new Date(item.expiresAt).getTime() / 1000) <= nowSeconds) {
          status = 'expired';
        }
        return {
          tokenId: item.tokenId,
          issuedAt: item.issuedAt,
          expiresAt: item.expiresAt,
          oneTime: item.oneTime,
          status,
        } satisfies AccessTokenListItem;
      })
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }

  private sign(payloadPart: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(payloadPart)
      .digest('base64url');
  }

  private parseSignedToken(token: string):
    | { ok: true; payload: AccessTokenPayload }
    | { ok: false; reason: 'malformed' | 'invalid_signature' } {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: 'malformed' };
    }

    const payloadPart = parts[0];
    const signaturePart = parts[1];
    const expectedSignature = this.sign(payloadPart);

    const providedBuffer = Buffer.from(signaturePart, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
    if (providedBuffer.length !== expectedBuffer.length) {
      return { ok: false, reason: 'invalid_signature' };
    }
    if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    try {
      const payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
      const payload = parsePayload(payloadJson);
      if (!payload) {
        return { ok: false, reason: 'malformed' };
      }
      return { ok: true, payload };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }
}
