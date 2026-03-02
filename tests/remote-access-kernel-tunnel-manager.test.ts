import assert from 'node:assert/strict';
import test from 'node:test';

import type { TunnelHandle, TunnelProviderAdapter } from '../src/remote-access-kernel/provider-adapter.ts';
import { InMemoryRemoteAccessStateStore } from '../src/remote-access-kernel/state-store.ts';
import { TunnelManager } from '../src/remote-access-kernel/tunnel-manager.ts';

class FakeTunnelHandle implements TunnelHandle {
  public readonly publicUrl: string;
  public stopCalled = false;
  private readonly exitPromise: Promise<number | null>;
  private readonly resolveExit: (code: number | null) => void;

  constructor(publicUrl: string) {
    this.publicUrl = publicUrl;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
  }

  async waitForExit(): Promise<number | null> {
    return this.exitPromise;
  }

  exit(code: number | null): void {
    this.resolveExit(code);
  }
}

class QueueProviderAdapter implements TunnelProviderAdapter {
  public readonly kind = 'custom' as const;
  public startCalls = 0;
  private readonly handles: FakeTunnelHandle[];

  constructor(handles: FakeTunnelHandle[]) {
    this.handles = handles;
  }

  async start(): Promise<TunnelHandle> {
    this.startCalls += 1;
    const handle = this.handles.shift();
    assert.ok(handle, 'expected queued handle for provider start');
    return handle;
  }
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 300,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timeout waiting for condition');
}

test('start and stop tunnel', async () => {
  const handle = new FakeTunnelHandle('https://first.example.com');
  const provider = new QueueProviderAdapter([handle]);
  const stateStore = new InMemoryRemoteAccessStateStore();
  const manager = new TunnelManager({
    stateStore,
    providers: [provider],
    now: () => new Date('2026-03-02T00:00:00.000Z'),
  });

  const started = await manager.start({
    provider: 'custom',
    targetUrl: 'http://127.0.0.1:3000',
  });

  assert.equal(started.status, 'running');
  assert.equal(started.publicUrl, 'https://first.example.com');

  const stopped = await manager.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(handle.stopCalled, true);
});

test('auto restart tunnel when provider process exits', async () => {
  const first = new FakeTunnelHandle('https://first.example.com');
  const second = new FakeTunnelHandle('https://second.example.com');
  const provider = new QueueProviderAdapter([first, second]);
  const stateStore = new InMemoryRemoteAccessStateStore();
  const manager = new TunnelManager({
    stateStore,
    providers: [provider],
    now: () => new Date('2026-03-02T00:00:00.000Z'),
  });

  await manager.start({
    provider: 'custom',
    targetUrl: 'http://127.0.0.1:3000',
    autoRestart: true,
  });

  first.exit(1);

  await waitFor(async () => {
    const status = await manager.getStatus();
    return status.status === 'running' && status.publicUrl === second.publicUrl;
  });

  const status = await manager.getStatus();
  assert.equal(status.restartCount, 1);
  assert.equal(provider.startCalls, 2);
});
