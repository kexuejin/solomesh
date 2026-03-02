import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type RemoteAccessProviderKind = 'cloudflared' | 'ngrok';

export type ProviderInstallCommandRunner = (
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<boolean>;

interface EnsureProviderExecutableOptions {
  env?: NodeJS.ProcessEnv;
  autoInstall?: boolean;
  checkExecutable?: (executable: string, env?: NodeJS.ProcessEnv) => boolean;
  runCommand?: ProviderInstallCommandRunner;
}

const installAttemptCache = new Map<string, Promise<boolean>>();

function hasExecutablePermission(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isExecutableAvailable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const trimmed = executable.trim();
  if (!trimmed) {
    return false;
  }

  if (path.isAbsolute(trimmed) || trimmed.includes(path.sep)) {
    return hasExecutablePermission(trimmed);
  }

  const pathEntries = (env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, trimmed);
    if (hasExecutablePermission(candidate)) {
      return true;
    }
  }

  return false;
}

async function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: 'ignore',
    });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

function getBrewFormula(provider: RemoteAccessProviderKind): string {
  if (provider === 'ngrok') return 'ngrok';
  return 'cloudflared';
}

export async function ensureProviderExecutableAvailable(
  provider: RemoteAccessProviderKind,
  executable: string,
  options: EnsureProviderExecutableOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const autoInstall = options.autoInstall ?? true;
  const checkExecutable = options.checkExecutable ?? isExecutableAvailable;
  const runInstallCommand = options.runCommand ?? runCommand;

  if (checkExecutable(executable, env)) {
    return true;
  }
  if (!autoInstall) {
    return false;
  }

  // If caller specified a custom executable/path, don't mutate host environment.
  if (executable.trim() !== provider) {
    return false;
  }
  if (!checkExecutable('brew', env)) {
    return false;
  }

  const cacheKey = `${provider}:${executable}`;
  let pending = installAttemptCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const installOk = await runInstallCommand(
        'brew',
        ['install', getBrewFormula(provider)],
        {
          env: {
            ...env,
            HOMEBREW_NO_AUTO_UPDATE: '1',
          },
        },
      );
      if (!installOk) {
        return false;
      }
      return checkExecutable(executable, env);
    })().finally(() => {
      installAttemptCache.delete(cacheKey);
    });
    installAttemptCache.set(cacheKey, pending);
  }
  return pending;
}
