import assert from 'node:assert/strict';
import test from 'node:test';

import { Hono } from 'hono';

import remoteAccessRoutes, { injectRemoteAccessDeps } from '../src/routes/remote-access.ts';
import type { RemoteAccessKernel } from '../src/remote-access-kernel/kernel.ts';
import type {
  AccessTokenVerifyResult,
  TunnelStatusSnapshot,
} from '../src/remote-access-kernel/types.ts';

class FakeKernel {
  private readonly result: AccessTokenVerifyResult;
  public readonly calls: Array<{ token: string; consumeOneTime?: boolean }> = [];

  constructor(result: AccessTokenVerifyResult) {
    this.result = result;
  }

  async verifyAccessToken(
    token: string,
    options?: { consumeOneTime?: boolean },
  ): Promise<AccessTokenVerifyResult> {
    this.calls.push({ token, consumeOneTime: options?.consumeOneTime });
    return this.result;
  }

  async getTunnelStatus(): Promise<TunnelStatusSnapshot> {
    return {
      status: 'idle',
      updatedAt: new Date().toISOString(),
      restartCount: 0,
    };
  }
}

function createApp(kernel: FakeKernel, enabled = true): Hono {
  injectRemoteAccessDeps({
    kernel: kernel as unknown as RemoteAccessKernel,
    enabled,
    defaultTargetUrl: 'http://127.0.0.1:3000',
    providerCommands: {
      cloudflared: 'cloudflared',
      ngrok: 'ngrok',
    },
  });
  const app = new Hono();
  app.route('/api/remote-access', remoteAccessRoutes);
  return app;
}

test('public entry returns friendly html for missing token', async () => {
  const app = createApp(new FakeKernel({ valid: false, reason: 'malformed' }));
  const res = await app.request('http://example.com/api/remote-access/public/entry');

  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') || '', /text\/html/i);
  const text = await res.text();
  assert.match(text, /Missing token/i);
  assert.match(text, /SoloMesh Remote Access/i);
});

test('public entry returns friendly html for invalid token', async () => {
  const app = createApp(new FakeKernel({ valid: false, reason: 'expired' }));
  const res = await app.request(
    'http://example.com/api/remote-access/public/entry?token=bad-token',
  );

  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type') || '', /text\/html/i);
  const text = await res.text();
  assert.match(text, /Invalid token/i);
  assert.match(text, /expired/i);
});

test('public entry redirects to requested path when token is valid', async () => {
  const kernel = new FakeKernel({
    valid: true,
    payload: {
      v: 1,
      iat: 1_700_000_000,
      exp: 1_700_000_100,
      jti: 'token-1',
      oneTime: true,
    },
  });
  const app = createApp(kernel);

  const res = await app.request(
    'http://example.com/api/remote-access/public/entry?token=ok-token&path=%2Fsettings%3Ftab%3Druntime',
    { redirect: 'manual' },
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/settings?tab=runtime');
  assert.deepEqual(kernel.calls, [{ token: 'ok-token', consumeOneTime: true }]);
});

test('public entry sanitizes external redirect path', async () => {
  const app = createApp(
    new FakeKernel({
      valid: true,
      payload: {
        v: 1,
        iat: 1_700_000_000,
        exp: 1_700_000_100,
        jti: 'token-2',
        oneTime: false,
      },
    }),
  );

  const res = await app.request(
    'http://example.com/api/remote-access/public/entry?token=ok-token&path=https%3A%2F%2Fevil.example.com%2Fpwn',
    { redirect: 'manual' },
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
});

test('public entry returns html when remote access is disabled', async () => {
  const app = createApp(new FakeKernel({ valid: true }), false);
  const res = await app.request(
    'http://example.com/api/remote-access/public/entry?token=any',
  );

  assert.equal(res.status, 503);
  assert.match(res.headers.get('content-type') || '', /text\/html/i);
  const text = await res.text();
  assert.match(text, /Remote access disabled/i);
});

test('public entry sanitizes malformed redirect path', async () => {
  const app = createApp(
    new FakeKernel({
      valid: true,
      payload: {
        v: 1,
        iat: 1_700_000_000,
        exp: 1_700_000_100,
        jti: 'token-3',
      },
    }),
  );

  const malformed = encodeURIComponent('http://[broken-host');
  const res = await app.request(
    `http://example.com/api/remote-access/public/entry?token=ok-token&path=${malformed}`,
    { redirect: 'manual' },
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
});
