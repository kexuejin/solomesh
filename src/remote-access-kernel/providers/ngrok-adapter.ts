import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import type {
  TunnelHandle,
  TunnelProviderAdapter,
  TunnelProviderStartContext,
} from '../provider-adapter.js';

export type NgrokSpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface NgrokTunnelProviderOptions {
  executable?: string;
  authtoken?: string;
  domain?: string;
  extraArgs?: string[];
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  spawnProcess?: NgrokSpawnProcess;
}

const DEFAULT_URL_PATTERN = /(https:\/\/[a-z0-9.-]*ngrok(?:-free)?\.app\b)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractUrlFromLine(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { url?: unknown };
    if (typeof parsed.url === 'string' && parsed.url.startsWith('https://')) {
      return parsed.url;
    }
  } catch {
    // ignore non-json logs
  }

  const match = line.match(DEFAULT_URL_PATTERN);
  if (match?.[1]) {
    return match[1];
  }
  return null;
}

export class NgrokTunnelProviderAdapter implements TunnelProviderAdapter {
  readonly kind = 'ngrok' as const;

  private readonly executable: string;
  private readonly authtoken?: string;
  private readonly domain?: string;
  private readonly extraArgs: string[];
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly spawnProcess: NgrokSpawnProcess;

  constructor(options: NgrokTunnelProviderOptions = {}) {
    this.executable = options.executable ?? 'ngrok';
    this.authtoken = options.authtoken;
    this.domain = options.domain;
    this.extraArgs = options.extraArgs ?? [];
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async start(context: TunnelProviderStartContext): Promise<TunnelHandle> {
    const args = [
      'http',
      context.targetUrl,
      '--log',
      'stdout',
      '--log-format',
      'json',
    ];
    if (this.domain) {
      args.push('--domain', this.domain);
    }
    args.push(...this.extraArgs);

    const child = this.spawnProcess(this.executable, args, {
      env: {
        ...process.env,
        ...context.env,
        ...(this.authtoken ? { NGROK_AUTHTOKEN: this.authtoken } : {}),
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
        // ignore cleanup error
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

        const exited = await Promise.race([
          exitPromise.then(() => true),
          sleep(this.stopTimeoutMs).then(() => false),
        ]);
        if (!exited && child.exitCode === null) {
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

  private waitForPublicUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let done = false;
      let buffer = '';

      const complete = (handler: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
        child.stdout?.off('data', onChunk);
        child.stderr?.off('data', onChunk);
        handler();
      };

      const consumeLine = (line: string): void => {
        const url = extractUrlFromLine(line);
        if (url) {
          complete(() => resolve(url));
        }
      };

      const onChunk = (chunk: unknown): void => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        buffer += text;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          consumeLine(line.trim());
          if (done) return;
        }

        if (!done && buffer.includes('https://')) {
          consumeLine(buffer.trim());
        }
      };

      const onError = (error: Error): void => {
        complete(() => reject(error));
      };

      const onExit = (code: number | null): void => {
        complete(() => {
          reject(
            new Error(
              `ngrok exited before publishing public url (code=${String(code)}).`,
            ),
          );
        });
      };

      child.on('error', onError);
      child.on('exit', onExit);
      child.stdout?.on('data', onChunk);
      child.stderr?.on('data', onChunk);

      const timer = setTimeout(() => {
        complete(() => {
          reject(new Error('ngrok did not report public url within timeout.'));
        });
      }, timeoutMs);
    });
  }
}
