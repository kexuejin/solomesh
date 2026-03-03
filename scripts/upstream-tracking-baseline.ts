#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Args {
  command: 'get' | 'set' | 'show';
  repoPath: string;
  filePath: string;
  fallbackRef?: string;
  localRef?: string;
  source?: string;
}

interface BaselineState {
  local_ref: string;
  updated_at: string;
  source: string;
}

function parseArgs(argv: string[]): Args {
  if (argv.length === 0) {
    throw new Error('Usage: upstream-tracking-baseline.ts <get|set|show> [options]');
  }

  const commandRaw = argv[0]?.trim().toLowerCase();
  if (commandRaw !== 'get' && commandRaw !== 'set' && commandRaw !== 'show') {
    throw new Error(`Unknown command: ${argv[0]}`);
  }

  const args: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    args[key] = value;
    i += 1;
  }

  const repoPath = path.resolve(args['repo-path'] || process.cwd());
  const filePath = path.resolve(args['file'] || 'data/upstream-tracking/baseline.json');
  const fallbackRef = args['fallback']?.trim();
  const localRef = args['local-ref']?.trim();
  const source = args['source']?.trim() || 'manual';

  return {
    command: commandRaw,
    repoPath,
    filePath,
    fallbackRef: fallbackRef && fallbackRef.length > 0 ? fallbackRef : undefined,
    localRef: localRef && localRef.length > 0 ? localRef : undefined,
    source,
  };
}

function ensureGitCommitExists(repoPath: string, ref: string): void {
  execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
    cwd: repoPath,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function readBaseline(filePath: string): BaselineState | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<BaselineState>;
  const localRef = typeof parsed.local_ref === 'string' ? parsed.local_ref.trim() : '';
  if (!localRef) return null;
  return {
    local_ref: localRef,
    updated_at:
      typeof parsed.updated_at === 'string' && parsed.updated_at.trim()
        ? parsed.updated_at
        : new Date().toISOString(),
    source:
      typeof parsed.source === 'string' && parsed.source.trim()
        ? parsed.source
        : 'unknown',
  };
}

function writeBaseline(filePath: string, state: BaselineState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function cmdGet(opts: Args): void {
  const baseline = readBaseline(opts.filePath);
  if (baseline?.local_ref) {
    ensureGitCommitExists(opts.repoPath, baseline.local_ref);
    process.stdout.write(`${baseline.local_ref}\n`);
    return;
  }
  if (opts.fallbackRef) {
    ensureGitCommitExists(opts.repoPath, opts.fallbackRef);
    process.stdout.write(`${opts.fallbackRef}\n`);
    return;
  }
  throw new Error(
    `No baseline found at ${opts.filePath}. Use "set --local-ref <sha>" first or pass --fallback.`,
  );
}

function cmdSet(opts: Args): void {
  if (!opts.localRef) {
    throw new Error('Missing required option: --local-ref <sha>');
  }
  ensureGitCommitExists(opts.repoPath, opts.localRef);
  const nextState: BaselineState = {
    local_ref: opts.localRef,
    updated_at: new Date().toISOString(),
    source: opts.source || 'manual',
  };
  writeBaseline(opts.filePath, nextState);
  process.stdout.write(`${JSON.stringify(nextState)}\n`);
}

function cmdShow(opts: Args): void {
  const baseline = readBaseline(opts.filePath);
  if (!baseline) {
    process.stdout.write('{}\n');
    return;
  }
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'get') cmdGet(opts);
  else if (opts.command === 'set') cmdSet(opts);
  else cmdShow(opts);
}

main();
