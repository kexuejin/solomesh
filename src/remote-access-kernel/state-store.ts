import fs from 'node:fs';
import path from 'node:path';

import type { RemoteAccessKernelState, TunnelStatusSnapshot } from './types.js';

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
