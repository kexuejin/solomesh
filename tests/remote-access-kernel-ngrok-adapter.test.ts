import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  NgrokTunnelProviderAdapter,
} from '../src/remote-access-kernel/providers/ngrok-adapter.ts';

class FakeProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public killedSignal: NodeJS.Signals | number | undefined;
  public killCount = 0;
  public pid = 2026;
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

test('starts ngrok and captures public url from JSON log', async () => {
  const fake = new FakeProcess();
  const adapter = new NgrokTunnelProviderAdapter({
    readyTimeoutMs: 200,
    spawnProcess: () => fake as any,
  });

  const startPromise = adapter.start({ targetUrl: 'http://127.0.0.1:3000' });

  fake.emitStdout(
    '{"lvl":"info","msg":"started tunnel","url":"https://demo.ngrok-free.app"}',
  );
  const handle = await startPromise;

  assert.equal(handle.publicUrl, 'https://demo.ngrok-free.app');
  assert.equal(handle.processId, 2026);

  const stopPromise = handle.stop();
  fake.exit(0);
  await stopPromise;
  assert.equal(fake.killedSignal, 'SIGTERM');
});

test('captures ngrok url from plain log line', async () => {
  const fake = new FakeProcess();
  const adapter = new NgrokTunnelProviderAdapter({
    readyTimeoutMs: 200,
    spawnProcess: () => fake as any,
  });

  const startPromise = adapter.start({ targetUrl: 'http://127.0.0.1:3000' });
  fake.emitStderr('t=2026-03-02T00:00:00Z lvl=info msg="started tunnel" url=https://abc.ngrok-free.app');
  const handle = await startPromise;

  assert.equal(handle.publicUrl, 'https://abc.ngrok-free.app');
});

test('fails when ngrok does not output public url in time', async () => {
  const fake = new FakeProcess();
  const adapter = new NgrokTunnelProviderAdapter({
    readyTimeoutMs: 30,
    spawnProcess: () => fake as any,
  });

  await assert.rejects(
    () => adapter.start({ targetUrl: 'http://127.0.0.1:3000' }),
    /did not report public url within timeout/i,
  );
});
