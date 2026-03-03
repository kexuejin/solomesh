import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureRemoteAccessTunnelRunning } from '../src/remote-access-kernel/ensure-tunnel-running.ts';
import type {
  TunnelStartRequest,
  TunnelStatusSnapshot,
} from '../src/remote-access-kernel/types.ts';

function snapshot(patch: Partial<TunnelStatusSnapshot>): TunnelStatusSnapshot {
  return {
    status: 'idle',
    updatedAt: '2026-03-03T00:00:00.000Z',
    restartCount: 0,
    ...patch,
  };
}

test('auto-start tunnel reuses previous provider and target when stopped', async () => {
  let startRequest: TunnelStartRequest | null = null;
  const kernel = {
    async getTunnelStatus() {
      return snapshot({
        status: 'stopped',
        provider: 'ngrok',
        targetUrl: 'http://127.0.0.1:3001',
      });
    },
    async startTunnel(request: TunnelStartRequest) {
      startRequest = request;
      return snapshot({
        status: 'running',
        provider: request.provider,
        targetUrl: request.targetUrl,
        publicUrl: 'https://example.ngrok.app',
      });
    },
  };

  await ensureRemoteAccessTunnelRunning({
    kernel: kernel as any,
    defaultTargetUrl: 'http://127.0.0.1:3000',
  });

  assert.deepEqual(startRequest, {
    provider: 'ngrok',
    targetUrl: 'http://127.0.0.1:3001',
    autoRestart: true,
  });
});

test('auto-start tunnel falls back to cloudflared and default target when no history', async () => {
  let startRequest: TunnelStartRequest | null = null;
  const kernel = {
    async getTunnelStatus() {
      return snapshot({ status: 'idle' });
    },
    async startTunnel(request: TunnelStartRequest) {
      startRequest = request;
      return snapshot({
        status: 'running',
        provider: request.provider,
        targetUrl: request.targetUrl,
        publicUrl: 'https://example.cloudflare.com',
      });
    },
  };

  await ensureRemoteAccessTunnelRunning({
    kernel: kernel as any,
    defaultTargetUrl: 'http://127.0.0.1:3000',
  });

  assert.deepEqual(startRequest, {
    provider: 'cloudflared',
    targetUrl: 'http://127.0.0.1:3000',
    autoRestart: true,
  });
});

test('auto-start tunnel skips restart when tunnel is already running', async () => {
  let startCalled = false;
  const kernel = {
    async getTunnelStatus() {
      return snapshot({
        status: 'running',
        provider: 'cloudflared',
        targetUrl: 'http://127.0.0.1:3000',
        publicUrl: 'https://running.example.com',
      });
    },
    async startTunnel(_request: TunnelStartRequest) {
      startCalled = true;
      return snapshot({
        status: 'running',
        provider: 'cloudflared',
        targetUrl: 'http://127.0.0.1:3000',
        publicUrl: 'https://running.example.com',
      });
    },
  };

  const status = await ensureRemoteAccessTunnelRunning({
    kernel: kernel as any,
    defaultTargetUrl: 'http://127.0.0.1:3000',
  });

  assert.equal(startCalled, false);
  assert.equal(status.status, 'running');
  assert.equal(status.publicUrl, 'https://running.example.com');
});
