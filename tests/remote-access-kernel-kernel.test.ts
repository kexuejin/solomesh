import assert from 'node:assert/strict';
import test from 'node:test';

import { RemoteAccessKernel } from '../src/remote-access-kernel/kernel.ts';
import type { TunnelHandle, TunnelProviderAdapter } from '../src/remote-access-kernel/provider-adapter.ts';

class StaticTunnelHandle implements TunnelHandle {
  public readonly publicUrl: string;
  public stopCalled = false;

  constructor(publicUrl: string) {
    this.publicUrl = publicUrl;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
  }
}

class StaticProviderAdapter implements TunnelProviderAdapter {
  public readonly kind = 'custom' as const;
  private readonly handle: StaticTunnelHandle;

  constructor(handle: StaticTunnelHandle) {
    this.handle = handle;
  }

  async start(): Promise<TunnelHandle> {
    return this.handle;
  }
}

test('kernel lifecycle: start, create link, verify one-time token, stop', async () => {
  const handle = new StaticTunnelHandle('https://public.example.com');
  const provider = new StaticProviderAdapter(handle);
  const kernel = new RemoteAccessKernel({
    tokenSecret: 'kernel-secret',
    providerAdapters: [provider],
    now: () => new Date('2026-03-02T00:00:00.000Z'),
    randomId: () => 'kernel-token-1',
  });

  const events: string[] = [];
  const unsubscribe = kernel.subscribe((event) => {
    events.push(event.type);
  });

  const started = await kernel.startTunnel({
    provider: 'custom',
    targetUrl: 'http://127.0.0.1:3000',
  });
  assert.equal(started.status, 'running');

  const link = await kernel.createAccessLink({
    ttlSeconds: 300,
    oneTime: true,
    path: '/im',
  });
  assert.match(link.url, /^https:\/\/public\.example\.com\/r\//);
  assert.equal(link.mode, 'token');
  assert.ok(link.token);

  const first = await kernel.verifyAccessToken(link.token, { consumeOneTime: true });
  const second = await kernel.verifyAccessToken(link.token, { consumeOneTime: true });
  const tokens = await kernel.listAccessTokens();
  const revoked = await kernel.revokeAccessTokenById(tokens[0]?.tokenId || '');
  const afterRevoke = await kernel.listAccessTokens();

  assert.equal(first.valid, true);
  assert.deepEqual(second, { valid: false, reason: 'consumed' });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.status, 'consumed');
  assert.equal(revoked, true);
  assert.equal(afterRevoke[0]?.status, 'revoked');

  const stopped = await kernel.stopTunnel();
  assert.equal(stopped.status, 'stopped');
  assert.equal(handle.stopCalled, true);

  assert.deepEqual(events, [
    'tunnel_status_changed',
    'tunnel_status_changed',
    'access_link_created',
    'tunnel_status_changed',
  ]);
  unsubscribe();
});

test('kernel supports public mode defaults with short-code resolution', async () => {
  const handle = new StaticTunnelHandle('https://public.example.com');
  const provider = new StaticProviderAdapter(handle);
  const kernel = new RemoteAccessKernel({
    tokenSecret: 'kernel-secret',
    providerAdapters: [provider],
    now: () => new Date('2026-03-02T00:00:00.000Z'),
  });

  await kernel.startTunnel({
    provider: 'custom',
    targetUrl: 'http://127.0.0.1:3000',
  });

  const updated = await kernel.updateLinkPreferences({
    mode: 'public',
    ttlSeconds: 7200,
    oneTime: true,
  });
  assert.deepEqual(updated, {
    mode: 'public',
    ttlSeconds: 7200,
    oneTime: true,
  });

  const link = await kernel.createAccessLink({
    path: '/chat/main',
  });
  assert.equal(link.mode, 'public');
  assert.equal(link.token, undefined);
  assert.equal(link.expiresAt, undefined);
  assert.match(link.url, /^https:\/\/public\.example\.com\/r\//);

  const resolved = await kernel.resolveAccessCode(link.code);
  assert.deepEqual(resolved, {
    ok: true,
    path: '/chat/main',
    token: undefined,
  });
});
