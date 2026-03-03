import fs from 'node:fs';
import path from 'node:path';

import type { RemoteAccessKernelState, TunnelStatusSnapshot } from './types.js';

const DEFAULT_LINK_PREFERENCES: RemoteAccessKernelState['preferences'] = {
  mode: 'token',
  ttlSeconds: 30 * 60,
  oneTime: false,
};

function createDefaultTunnelSnapshot(): TunnelStatusSnapshot {
  const now = new Date().toISOString();
  return {
    status: 'idle',
    updatedAt: now,
    restartCount: 0,
  };
}

export function createDefaultKernelState(): RemoteAccessKernelState {
  return {
    tunnel: createDefaultTunnelSnapshot(),
    revokedTokenIds: [],
    consumedTokenIds: [],
    issuedTokens: [],
    accessCodes: [],
    preferences: { ...DEFAULT_LINK_PREFERENCES },
  };
}

function parseIssuedTokens(value: unknown): RemoteAccessKernelState['issuedTokens'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: RemoteAccessKernelState['issuedTokens'] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.tokenId !== 'string'
      || typeof record.issuedAt !== 'string'
      || typeof record.expiresAt !== 'string'
      || typeof record.oneTime !== 'boolean'
      || !record.tokenId.trim()
    ) {
      continue;
    }
    out.push({
      tokenId: record.tokenId,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      oneTime: record.oneTime,
    });
  }
  return out;
}

function parseAccessCodes(value: unknown): RemoteAccessKernelState['accessCodes'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: RemoteAccessKernelState['accessCodes'] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.code !== 'string'
      || typeof record.createdAt !== 'string'
      || !record.code.trim()
      || (record.expiresAt !== undefined && typeof record.expiresAt !== 'string')
      || (record.token !== undefined && typeof record.token !== 'string')
      || (record.path !== undefined && typeof record.path !== 'string')
    ) {
      continue;
    }
    out.push({
      code: record.code,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      token: record.token,
      path: record.path,
    });
  }
  return out;
}

function parsePreferences(value: unknown): RemoteAccessKernelState['preferences'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_LINK_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  const mode = record.mode === 'public' ? 'public' : 'token';
  const ttlSecondsRaw = typeof record.ttlSeconds === 'number'
    ? Math.floor(record.ttlSeconds)
    : DEFAULT_LINK_PREFERENCES.ttlSeconds;
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0
    ? ttlSecondsRaw
    : DEFAULT_LINK_PREFERENCES.ttlSeconds;
  const oneTime = typeof record.oneTime === 'boolean'
    ? record.oneTime
    : DEFAULT_LINK_PREFERENCES.oneTime;
  return {
    mode,
    ttlSeconds,
    oneTime,
  };
}

export interface RemoteAccessStateStore {
  read(): Promise<RemoteAccessKernelState>;
  write(state: RemoteAccessKernelState): Promise<void>;
  update(
    updater: (state: RemoteAccessKernelState) => RemoteAccessKernelState,
  ): Promise<RemoteAccessKernelState>;
}

export class InMemoryRemoteAccessStateStore implements RemoteAccessStateStore {
  private state: RemoteAccessKernelState;

  constructor(initialState?: RemoteAccessKernelState) {
    this.state = initialState ?? createDefaultKernelState();
  }

  async read(): Promise<RemoteAccessKernelState> {
    return structuredClone(this.state);
  }

  async write(state: RemoteAccessKernelState): Promise<void> {
    this.state = structuredClone(state);
  }

  async update(
    updater: (state: RemoteAccessKernelState) => RemoteAccessKernelState,
  ): Promise<RemoteAccessKernelState> {
    const next = updater(structuredClone(this.state));
    this.state = structuredClone(next);
    return structuredClone(this.state);
  }
}

export class JsonRemoteAccessStateStore implements RemoteAccessStateStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(): Promise<RemoteAccessKernelState> {
    if (!fs.existsSync(this.filePath)) {
      return createDefaultKernelState();
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as RemoteAccessKernelState;
      return {
        tunnel: parsed.tunnel ?? createDefaultKernelState().tunnel,
        revokedTokenIds: Array.isArray(parsed.revokedTokenIds)
          ? parsed.revokedTokenIds
          : [],
        consumedTokenIds: Array.isArray(parsed.consumedTokenIds)
          ? parsed.consumedTokenIds
          : [],
        issuedTokens: parseIssuedTokens(parsed.issuedTokens),
        accessCodes: parseAccessCodes((parsed as any).accessCodes),
        preferences: parsePreferences((parsed as any).preferences),
      };
    } catch {
      return createDefaultKernelState();
    }
  }

  async write(state: RemoteAccessKernelState): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  async update(
    updater: (state: RemoteAccessKernelState) => RemoteAccessKernelState,
  ): Promise<RemoteAccessKernelState> {
    const current = await this.read();
    const next = updater(current);
    await this.write(next);
    return next;
  }
}
