import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  CloudflaredTunnelProviderAdapter,
} from '../src/remote-access-kernel/providers/cloudflared-adapter.ts';

class FakeProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public killedSignal: NodeJS.Signals | number | undefined;
  public killCount = 0;
  public pid = 4242;
  public exitCode: number | null = null;

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.killedSignal = signal;
    this.killCount += 1;
    return true;
  }

  emitStdout(line: string): void {
    this.stdout.emit('data', Buffer.from(line, 'utf8'));
  }

  emitStderr(line: string): void {
    this.stderr.emit('data', Buffer.from(line, 'utf8'));
  }

  exit(code: number | null): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

test('starts cloudflared and captures public url', async () => {
  const fake = new FakeProcess();
  const adapter = new CloudflaredTunnelProviderAdapter({
    readyTimeoutMs: 200,
    spawnProcess: () => fake as any,
  });

  const startPromise = adapter.start({ targetUrl: 'http://127.0.0.1:3000' });

  fake.emitStdout('INF generated quick Tunnel URL: https://abc.trycloudflare.com');
  const handle = await startPromise;

  assert.equal(handle.publicUrl, 'https://abc.trycloudflare.com');
  assert.equal(handle.processId, 4242);

  const stopPromise = handle.stop();
  fake.exit(0);
  await stopPromise;
  assert.equal(fake.killedSignal, 'SIGTERM');
});

test('waitForExit resolves process exit code', async () => {
  const fake = new FakeProcess();
  const adapter = new CloudflaredTunnelProviderAdapter({
    readyTimeoutMs: 200,
    spawnProcess: () => fake as any,
  });

  const startPromise = adapter.start({ targetUrl: 'http://127.0.0.1:3000' });
  fake.emitStderr('INF tunnel ready at https://xyz.trycloudflare.com');
  const handle = await startPromise;

  const waitPromise = handle.waitForExit?.();
  fake.exit(7);
  const exitCode = await waitPromise;

  assert.equal(exitCode, 7);
});

test('fails when cloudflared does not output public url in time', async () => {
  const fake = new FakeProcess();
  const adapter = new CloudflaredTunnelProviderAdapter({
    readyTimeoutMs: 30,
    spawnProcess: () => fake as any,
  });

  await assert.rejects(
    () => adapter.start({ targetUrl: 'http://127.0.0.1:3000' }),
    /did not report public url within timeout/i,
  );
});
