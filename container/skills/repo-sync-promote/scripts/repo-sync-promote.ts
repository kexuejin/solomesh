#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Command = 'prepare' | 'advance-baseline' | 'show-baseline';

interface ParsedArgs {
  command: Command;
  options: Record<string, string>;
}

interface PrepareResult {
  localRef: string;
  baselineFile: string;
  outputDir: string;
  integrationBase: string;
  upstreamRef: string;
  upstreamHeadCommit: string;
  upstreamHead: string;
  syncBranch: string;
  syncWorktree: string;
  integrationBranch: string;
  integrationWorktree: string;
  reportPath: string;
  statePath: string;
  absorbPlanPath: string;
  promotePlanPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const commandRaw = (argv[0] || '').trim().toLowerCase();
  if (!['prepare', 'advance-baseline', 'show-baseline'].includes(commandRaw)) {
    throw new Error(
      'Usage: repo-sync-promote.ts <prepare|advance-baseline|show-baseline> [--key value]',
    );
  }

  const options: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    options[key] = value;
    i += 1;
  }

  return { command: commandRaw as Command, options };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function toAbsolute(p: string, cwd: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function resolveRepoRoot(repoPathOption?: string): string {
  const candidate = path.resolve(repoPathOption || process.cwd());
  return runGit(candidate, ['rev-parse', '--show-toplevel']);
}

function requireFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

function runNodeTsx(repoRoot: string, scriptPath: string, args: string[]): string {
  return execFileSync('node', ['--import', 'tsx', scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function toDateStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}${m}${d}`;
}

function sanitizeSuffix(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'head';
}

function parseStateJson(statePath: string): {
  upstream_ref?: string;
  upstream_head?: string;
} {
  const raw = fs.readFileSync(statePath, 'utf8');
  return JSON.parse(raw) as { upstream_ref?: string; upstream_head?: string };
}

function cmdPrepare(options: Record<string, string>): void {
  const repoRoot = resolveRepoRoot(options['repo-path']);
  const baselineFile = toAbsolute(
    options['baseline-file'] || 'data/repo-sync-tracking/baseline.json',
    repoRoot,
  );
  const outputDir = toAbsolute(options['output-dir'] || 'data/repo-sync-tracking', repoRoot);
  const fallbackRef = options['fallback-ref']?.trim();
  const remoteName = options['remote-name'] || 'upstream';
  const remoteUrl = options['remote-url'] || 'https://github.com/kexuejin/solomesh.git';
  const upstreamRef = options['upstream-ref'] || `${remoteName}/main`;
  const integrationBase = options['integration-base'] || 'dev';

  const baselineScript = path.join(repoRoot, 'scripts', 'repo-sync-baseline.ts');
  const reportScript = path.join(repoRoot, 'scripts', 'repo-sync-report.ts');
  requireFile(baselineScript);
  requireFile(reportScript);

  const getArgs = ['get', '--repo-path', repoRoot, '--file', baselineFile];
  if (fallbackRef) getArgs.push('--fallback', fallbackRef);
  const localRef = runNodeTsx(repoRoot, baselineScript, getArgs).trim();
  if (!localRef) {
    throw new Error('Failed to resolve local baseline ref.');
  }

  runNodeTsx(repoRoot, reportScript, [
    '--repo-path',
    repoRoot,
    '--output-dir',
    outputDir,
    '--remote-name',
    remoteName,
    '--remote-url',
    remoteUrl,
    '--upstream-ref',
    upstreamRef,
    '--local-ref',
    localRef,
  ]);

  const statePath = path.join(outputDir, 'last-sync.json');
  const reportPath = path.join(outputDir, 'sync-report.md');
  const absorbPlanPath = path.join(outputDir, 'absorb-plan.json');
  requireFile(statePath);
  requireFile(reportPath);
  requireFile(absorbPlanPath);

  const state = parseStateJson(statePath);
  const upstreamHead = sanitizeSuffix(state.upstream_head || 'head');
  const upstreamHeadCommit = runGit(repoRoot, ['rev-parse', upstreamRef]);
  const syncTag = `${toDateStamp()}-${upstreamHead}`;

  const result: PrepareResult = {
    localRef,
    baselineFile,
    outputDir,
    integrationBase,
    upstreamRef: state.upstream_ref || upstreamRef,
    upstreamHeadCommit,
    upstreamHead,
    syncBranch: `bot/repo-sync-${syncTag}`,
    syncWorktree: path.join(repoRoot, '.worktrees', `repo-sync-${syncTag}`),
    integrationBranch: `integrate/repo-sync-${syncTag}`,
    integrationWorktree: path.join(
      repoRoot,
      '.worktrees',
      `integrate-repo-sync-${syncTag}`,
    ),
    reportPath,
    statePath,
    absorbPlanPath,
    promotePlanPath: path.join(outputDir, 'promote-plan.json'),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(result.promotePlanPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function cmdAdvanceBaseline(options: Record<string, string>): void {
  const repoRoot = resolveRepoRoot(options['repo-path']);
  const baselineFile = toAbsolute(
    options['baseline-file'] || 'data/repo-sync-tracking/baseline.json',
    repoRoot,
  );
  const source = options['source'] || 'manual-merge';
  let localRef = options['local-ref']?.trim() || '';

  if (!localRef && options['from-plan']?.trim()) {
    const planPath = toAbsolute(options['from-plan'], repoRoot);
    const parsed = JSON.parse(fs.readFileSync(planPath, 'utf8')) as {
      upstreamHeadCommit?: string;
      upstreamHead?: string;
    };
    localRef = parsed.upstreamHeadCommit || parsed.upstreamHead || '';
  }
  if (!localRef) {
    throw new Error(
      'advance-baseline requires --local-ref <sha> or --from-plan <path-to-promote-plan.json>',
    );
  }

  const baselineScript = path.join(repoRoot, 'scripts', 'repo-sync-baseline.ts');
  requireFile(baselineScript);
  const output = runNodeTsx(repoRoot, baselineScript, [
    'set',
    '--repo-path',
    repoRoot,
    '--file',
    baselineFile,
    '--local-ref',
    localRef,
    '--source',
    source,
  ]);
  process.stdout.write(`${output}\n`);
}

function cmdShowBaseline(options: Record<string, string>): void {
  const repoRoot = resolveRepoRoot(options['repo-path']);
  const baselineFile = toAbsolute(
    options['baseline-file'] || 'data/repo-sync-tracking/baseline.json',
    repoRoot,
  );
  const baselineScript = path.join(repoRoot, 'scripts', 'repo-sync-baseline.ts');
  requireFile(baselineScript);
  const output = runNodeTsx(repoRoot, baselineScript, [
    'show',
    '--repo-path',
    repoRoot,
    '--file',
    baselineFile,
  ]);
  process.stdout.write(`${output}\n`);
}

function main(): void {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'prepare') cmdPrepare(options);
  else if (command === 'advance-baseline') cmdAdvanceBaseline(options);
  else cmdShowBaseline(options);
}

main();
