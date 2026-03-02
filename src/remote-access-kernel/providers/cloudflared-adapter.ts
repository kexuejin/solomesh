import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import type {
  TunnelHandle,
  TunnelProviderAdapter,
  TunnelProviderStartContext,
} from '../provider-adapter.js';

export type CloudflaredSpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CloudflaredTunnelProviderOptions {
  executable?: string;
  extraArgs?: string[];
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  urlPattern?: RegExp;
  spawnProcess?: CloudflaredSpawnProcess;
}

const DEFAULT_URL_PATTERN = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com\b)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class CloudflaredTunnelProviderAdapter implements TunnelProviderAdapter {
  readonly kind = 'cloudflared' as const;

  private readonly executable: string;
  private readonly extraArgs: string[];
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly urlPattern: RegExp;
  private readonly spawnProcess: CloudflaredSpawnProcess;

  constructor(options: CloudflaredTunnelProviderOptions = {}) {
    this.executable = options.executable ?? 'cloudflared';
    this.extraArgs = options.extraArgs ?? [];
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.urlPattern = options.urlPattern ?? DEFAULT_URL_PATTERN;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async start(context: TunnelProviderStartContext): Promise<TunnelHandle> {
    const args = [
      'tunnel',
      '--no-autoupdate',
      '--url',
      context.targetUrl,
      ...this.extraArgs,
    ];

    const child = this.spawnProcess(this.executable, args, {
      env: {
        ...process.env,
        ...context.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const exitPromise = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => {
        resolve(code);
      });
    });

    let publicUrl: string;
    try {
      publicUrl = await this.waitForPublicUrl(child, this.readyTimeoutMs);
    } catch (error) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill error on best-effort cleanup.
      }
      throw error;
    }

    return {
      publicUrl,
      processId: child.pid ?? undefined,
      stop: async () => {
        if (child.exitCode !== null) {
          return;
        }
        try {
          child.kill('SIGTERM');
        } catch {
          return;
        }

        const exitedByTerm = await Promise.race([
          exitPromise.then(() => true),
          sleep(this.stopTimeoutMs).then(() => false),
        ]);
        if (!exitedByTerm && child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          await exitPromise;
        }
      },
      waitForExit: async () => exitPromise,
    };
  }

  private waitForPublicUrl(
    child: ChildProcess,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let done = false;
      const complete = (handler: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        handler();
      };

      const onData = (chunk: unknown): void => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        const matched = text.match(this.urlPattern);
        if (matched?.[1] || matched?.[0]) {
          const url = matched[1] ?? matched[0];
          complete(() => resolve(url));
        }
      };

      const onError = (error: Error): void => {
        complete(() => reject(error));
      };

      const onExit = (code: number | null): void => {
        complete(() => {
          reject(
            new Error(
              `cloudflared exited before publishing public url (code=${String(code)}).`,
            ),
          );
        });
      };

      child.on('error', onError);
      child.on('exit', onExit);
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      const timer = setTimeout(() => {
        complete(() => {
          reject(new Error('cloudflared did not report public url within timeout.'));
        });
      }, timeoutMs);
    });
  }
}
