import { execFileSync } from 'node:child_process';

export interface GitRefComparison {
  hasSharedHistory: boolean;
  mergeBase: string | null;
  upstreamOnly: number;
  localOnly: number;
  behind: number;
  ahead: number;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseCount(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid git count output: "${value}"`);
  }
  return parsed;
}

function parseTwoCounts(value: string): [number, number] {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error(`Invalid git count pair output: "${value}"`);
  }
  return [parseCount(parts[0]), parseCount(parts[1])];
}

function resolveMergeBase(
  cwd: string,
  upstreamRef: string,
  localRef: string,
): string | null {
  try {
    return runGit(cwd, ['merge-base', upstreamRef, localRef]);
  } catch {
    return null;
  }
}

export function compareRefs(
  cwd: string,
  upstreamRef: string,
  localRef = 'HEAD',
): GitRefComparison {
  const mergeBase = resolveMergeBase(cwd, upstreamRef, localRef);

  if (mergeBase) {
    const localOnly = parseCount(
      runGit(cwd, ['rev-list', '--count', `${upstreamRef}..${localRef}`]),
    );
    const upstreamOnly = parseCount(
      runGit(cwd, ['rev-list', '--count', `${localRef}..${upstreamRef}`]),
    );
    return {
      hasSharedHistory: true,
      mergeBase,
      upstreamOnly,
      localOnly,
      behind: upstreamOnly,
      ahead: localOnly,
    };
  }

  // Unrelated histories: merge-base is absent, so use symmetric difference.
  const [upstreamOnly, localOnly] = parseTwoCounts(
    runGit(cwd, ['rev-list', '--left-right', '--count', `${upstreamRef}...${localRef}`]),
  );
  return {
    hasSharedHistory: false,
    mergeBase: null,
    upstreamOnly,
    localOnly,
    behind: upstreamOnly,
    ahead: localOnly,
  };
}

export function getRefMeta(
  cwd: string,
  ref: string,
): { short: string; subject: string; count: number } {
  return {
    short: runGit(cwd, ['rev-parse', '--short', ref]),
    subject: runGit(cwd, ['log', '-1', '--format=%s', ref]),
    count: parseCount(runGit(cwd, ['rev-list', '--count', ref])),
  };
}

export function ensureRemote(
  cwd: string,
  remoteName: string,
  remoteUrl: string,
): void {
  try {
    const existing = runGit(cwd, ['remote', 'get-url', remoteName]);
    if (existing.trim() === remoteUrl.trim()) return;
    runGit(cwd, ['remote', 'set-url', remoteName, remoteUrl]);
  } catch {
    runGit(cwd, ['remote', 'add', remoteName, remoteUrl]);
  }
}

export function fetchRemote(cwd: string, remoteName: string): void {
  runGit(cwd, ['fetch', remoteName, '--prune']);
}
