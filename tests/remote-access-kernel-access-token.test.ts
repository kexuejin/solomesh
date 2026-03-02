import assert from 'node:assert/strict';
import test from 'node:test';

import { AccessTokenService } from '../src/remote-access-kernel/access-token-service.ts';
import { InMemoryRemoteAccessStateStore } from '../src/remote-access-kernel/state-store.ts';

test('issue and verify signed token', async () => {
  const now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => 'token-1',
  });

  const issued = await service.issueToken({ ttlSeconds: 300, oneTime: false });
  const verified = await service.verifyToken(issued.token);

  assert.equal(verified.valid, true);
  assert.equal(issued.tokenId, 'token-1');
  assert.equal(issued.oneTime, false);
  assert.equal(issued.expiresAt, '2026-03-02T00:05:00.000Z');
});

test('reject revoked token', async () => {
  const now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => 'token-2',
  });

  const issued = await service.issueToken({ ttlSeconds: 300, oneTime: false });
  const revoked = await service.revokeToken(issued.token);
  const verified = await service.verifyToken(issued.token);

  assert.equal(revoked, true);
  assert.deepEqual(verified, { valid: false, reason: 'revoked' });
});

test('consume one-time token only once', async () => {
  const now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => 'token-3',
  });

  const issued = await service.issueToken({ ttlSeconds: 300, oneTime: true });

  const first = await service.verifyToken(issued.token, { consumeOneTime: true });
  const second = await service.verifyToken(issued.token, { consumeOneTime: true });

  assert.equal(first.valid, true);
  assert.deepEqual(second, { valid: false, reason: 'consumed' });
});

test('reject expired token', async () => {
  let now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => 'token-4',
  });

  const issued = await service.issueToken({ ttlSeconds: 1, oneTime: false });
  now = new Date('2026-03-02T00:00:02.000Z');

  const verified = await service.verifyToken(issued.token);
  assert.deepEqual(verified, { valid: false, reason: 'expired' });
});

test('reject malformed and tampered token', async () => {
  const now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => 'token-5',
  });

  const issued = await service.issueToken({ ttlSeconds: 60, oneTime: false });
  const malformed = await service.verifyToken('invalid-token');
  const tampered = await service.verifyToken(`${issued.token}tampered`);

  assert.deepEqual(malformed, { valid: false, reason: 'malformed' });
  assert.deepEqual(tampered, { valid: false, reason: 'invalid_signature' });
});

test('list tokens includes status and supports revoke by tokenId', async () => {
  let now = new Date('2026-03-02T00:00:00.000Z');
  const stateStore = new InMemoryRemoteAccessStateStore();
  let counter = 0;
  const service = new AccessTokenService({
    secret: 'unit-test-secret',
    stateStore,
    now: () => now,
    randomId: () => `token-list-${++counter}`,
  });

  const active = await service.issueToken({ ttlSeconds: 300, oneTime: false });
  const oneTime = await service.issueToken({ ttlSeconds: 300, oneTime: true });
  const expiring = await service.issueToken({ ttlSeconds: 1, oneTime: false });

  await service.verifyToken(oneTime.token, { consumeOneTime: true });
  now = new Date('2026-03-02T00:00:02.000Z');
  const revoked = await service.revokeTokenById(active.tokenId);

  const tokens = await service.listTokens();
  assert.equal(revoked, true);
  assert.equal(tokens.length, 3);
  assert.deepEqual(
    new Map(tokens.map((item) => [item.tokenId, item.status])),
    new Map([
      [active.tokenId, 'revoked'],
      [oneTime.tokenId, 'consumed'],
      [expiring.tokenId, 'expired'],
    ]),
  );
});
