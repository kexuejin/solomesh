#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  compareRefs,
  ensureRemote,
  fetchRemote,
  getRefMeta,
} from '../src/upstream-tracking.ts';

interface Args {
  repoPath: string;
  outputDir: string;
  remoteName: string;
  remoteUrl: string;
  upstreamRef: string;
  localRef: string;
  includeMerges: boolean;
}

interface CommitInfo {
  hash: string;
  short: string;
  date: string;
  subject: string;
  files: string[];
  insertions: number;
  deletions: number;
  patchId: string | null;
  matchedLocalCommit: string | null;
  recommendation: 'required' | 'optional_docs' | 'already_applied';
  domain: 'frontend' | 'backend' | 'runtime' | 'tooling' | 'docs' | 'mixed';
  isMerge: boolean;
}

interface SuggestedCommitPlan {
  domain: CommitInfo['domain'];
  recommendedMessage: string;
  upstreamCommits: Array<Pick<CommitInfo, 'hash' | 'short' | 'subject' | 'date'>>;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    args[key] = value;
    i += 1;
  }

  const remoteName = args['remote-name'] || process.env.UPSTREAM_REMOTE || 'upstream';
  const remoteUrl =
    args['remote-url'] ||
    process.env.UPSTREAM_URL ||
    'https://github.com/kexuejin/solomesh.git';
  const upstreamRef = args['upstream-ref'] || `${remoteName}/main`;
  const includeMerges = parseBoolArg(args['include-merges'], false);

  return {
    repoPath: path.resolve(args['repo-path'] || process.cwd()),
    outputDir: path.resolve(args['output-dir'] || 'data/upstream-tracking'),
    remoteName,
    remoteUrl,
    upstreamRef,
    localRef: args['local-ref'] || 'HEAD',
    includeMerges,
  };
}

function parseBoolArg(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveStatus(shared: boolean, upstreamOnly: number, localOnly: number): string {
  if (!shared) return 'diverged_unrelated';
  if (upstreamOnly === 0 && localOnly === 0) return 'in_sync';
  if (upstreamOnly > 0 && localOnly === 0) return 'upstream_ahead';
  if (upstreamOnly === 0 && localOnly > 0) return 'local_ahead';
  return 'diverged_shared';
}

function toIsoSeconds(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function parseShortstat(text: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  const insMatch = text.match(/(\d+)\s+insertion(?:s)?\(\+\)/);
  const delMatch = text.match(/(\d+)\s+deletion(?:s)?\(-\)/);
  if (insMatch?.[1]) insertions = Number.parseInt(insMatch[1], 10) || 0;
  if (delMatch?.[1]) deletions = Number.parseInt(delMatch[1], 10) || 0;
  return { insertions, deletions };
}

function getPatchId(cwd: string, commit: string): string | null {
  const patch = execFileSync('git', ['show', commit, '--pretty=format:'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!patch.trim()) return null;
  const piped = spawnSync('git', ['patch-id', '--stable'], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input: patch,
  });
  if (piped.status !== 0) return null;
  const output = (piped.stdout || '').trim();
  if (!output) return null;
  const first = output.split(/\s+/)[0];
  return first || null;
}

function isMergeCommit(cwd: string, commit: string): boolean {
  const parentsLine = runGit(cwd, ['rev-list', '--parents', '-n', '1', commit]);
  const parts = parentsLine.split(/\s+/).filter(Boolean);
  return parts.length > 2;
}

function listRangeCommits(
  cwd: string,
  fromRef: string,
  toRef: string,
  options?: { includeMerges?: boolean },
): CommitInfo[] {
  const includeMerges = options?.includeMerges ?? true;
  const logArgs = [
    'log',
    '--reverse',
    '--pretty=format:%H%x1f%h%x1f%ad%x1f%s',
    '--date=iso-strict',
    `${fromRef}..${toRef}`,
  ];
  if (!includeMerges) logArgs.splice(1, 0, '--no-merges');
  const rows = runGit(cwd, logArgs);
  if (!rows) return [];
  return rows.split('\n').filter(Boolean).map((line) => {
    const [hash, short, date, subject] = line.split('\x1f');
    const fileRaw = runGit(cwd, ['show', '--pretty=format:', '--name-only', hash]);
    const files = fileRaw ? fileRaw.split('\n').map((item) => item.trim()).filter(Boolean) : [];
    const shortstat = runGit(cwd, ['show', '--shortstat', '--pretty=format:', hash]);
    const { insertions, deletions } = parseShortstat(shortstat);
    return {
      hash,
      short,
      date,
      subject,
      files,
      insertions,
      deletions,
      patchId: getPatchId(cwd, hash),
      matchedLocalCommit: null,
      recommendation: 'required',
      domain: 'mixed',
      isMerge: isMergeCommit(cwd, hash),
    };
  });
}

function countMergeCommitsInRange(cwd: string, fromRef: string, toRef: string): number {
  return Number.parseInt(
    runGit(cwd, ['rev-list', '--count', '--merges', `${fromRef}..${toRef}`]),
    10,
  ) || 0;
}

function buildLocalPatchIdMap(cwd: string, localRef: string): Map<string, string> {
  const hashesRaw = runGit(cwd, ['rev-list', '--max-count', '800', localRef]);
  const hashes = hashesRaw ? hashesRaw.split('\n').map((item) => item.trim()).filter(Boolean) : [];
  const map = new Map<string, string>();
  for (const hash of hashes) {
    const patchId = getPatchId(cwd, hash);
    if (!patchId || map.has(patchId)) continue;
    map.set(patchId, hash);
  }
  return map;
}

function classifyDomain(files: string[]): CommitInfo['domain'] {
  if (files.length === 0) return 'mixed';
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) || 0) + 1);
  for (const file of files) {
    if (file.startsWith('web/')) add('frontend');
    else if (file.startsWith('src/')) add('backend');
    else if (file.startsWith('container/')) add('runtime');
    else if (file.startsWith('scripts/') || file.startsWith('shared/') || file === 'Makefile' || file === 'package.json' || file === 'package-lock.json') add('tooling');
    else if (file.startsWith('docs/') || file.endsWith('.md') || file === 'CLAUDE.md' || file === 'README.md') add('docs');
    else add('mixed');
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (sorted[0]?.[0] as CommitInfo['domain'] | undefined) || 'mixed';
}

function isDocsOnly(files: string[]): boolean {
  if (files.length === 0) return false;
  return files.every((file) =>
    file.startsWith('docs/')
    || file.endsWith('.md')
    || file === 'CLAUDE.md'
    || file === 'README.md',
  );
}

function enrichCommitRecommendations(
  commits: CommitInfo[],
  localPatchMap: Map<string, string>,
): CommitInfo[] {
  return commits.map((commit) => {
    const domain = classifyDomain(commit.files);
    const matchedHash = commit.patchId ? localPatchMap.get(commit.patchId) || null : null;
    let recommendation: CommitInfo['recommendation'] = 'required';
    if (matchedHash) recommendation = 'already_applied';
    else if (isDocsOnly(commit.files)) recommendation = 'optional_docs';
    return {
      ...commit,
      domain,
      matchedLocalCommit: matchedHash,
      recommendation,
    };
  });
}

function buildSuggestedPlans(
  commits: CommitInfo[],
): SuggestedCommitPlan[] {
  const needed = commits.filter((commit) => commit.recommendation === 'required');
  const byDomain = new Map<CommitInfo['domain'], CommitInfo[]>();
  for (const commit of needed) {
    const list = byDomain.get(commit.domain) || [];
    list.push(commit);
    byDomain.set(commit.domain, list);
  }
  const orderedDomains: CommitInfo['domain'][] = ['backend', 'frontend', 'runtime', 'tooling', 'mixed', 'docs'];
  const plans: SuggestedCommitPlan[] = [];
  for (const domain of orderedDomains) {
    const list = byDomain.get(domain);
    if (!list || list.length === 0) continue;
    plans.push({
      domain,
      // Commit message should be generated by execution agent from includes.
      recommendedMessage: '',
      upstreamCommits: list.map((item) => ({
        hash: item.hash,
        short: item.short,
        subject: item.subject,
        date: item.date,
      })),
    });
  }
  return plans;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.outputDir, { recursive: true });

  ensureRemote(opts.repoPath, opts.remoteName, opts.remoteUrl);
  fetchRemote(opts.repoPath, opts.remoteName);

  const comparison = compareRefs(opts.repoPath, opts.upstreamRef, opts.localRef);
  const upstreamMeta = getRefMeta(opts.repoPath, opts.upstreamRef);
  const localMeta = getRefMeta(opts.repoPath, opts.localRef);
  const status = resolveStatus(
    comparison.hasSharedHistory,
    comparison.upstreamOnly,
    comparison.localOnly,
  );

  const checkedAt = toIsoSeconds();
  const mergeCommitsInRange = countMergeCommitsInRange(
    opts.repoPath,
    opts.localRef,
    opts.upstreamRef,
  );
  const upstreamCommitsRaw = listRangeCommits(
    opts.repoPath,
    opts.localRef,
    opts.upstreamRef,
    { includeMerges: opts.includeMerges },
  );
  const localPatchMap = buildLocalPatchIdMap(opts.repoPath, 'HEAD');
  const upstreamCommits = enrichCommitRecommendations(upstreamCommitsRaw, localPatchMap);
  const suggestedPlans = buildSuggestedPlans(
    upstreamCommits,
  );
  const requiredCount = upstreamCommits.filter((item) => item.recommendation === 'required').length;
  const optionalDocsCount = upstreamCommits.filter((item) => item.recommendation === 'optional_docs').length;
  const alreadyAppliedCount = upstreamCommits.filter((item) => item.recommendation === 'already_applied').length;

  const state = {
    last_check: checkedAt,
    relation: comparison.hasSharedHistory ? 'shared' : 'unrelated',
    status,
    merge_base: comparison.mergeBase,
    upstream_ref: opts.upstreamRef,
    upstream_head: upstreamMeta.short,
    upstream_head_message: upstreamMeta.subject,
    upstream_total_commits: upstreamMeta.count,
    local_ref: opts.localRef,
    local_head: localMeta.short,
    local_head_message: localMeta.subject,
    local_total_commits: localMeta.count,
    upstream_only_count: comparison.upstreamOnly,
    local_only_count: comparison.localOnly,
    ahead_count: comparison.ahead,
    behind_count: comparison.behind,
    notes:
      comparison.hasSharedHistory
        ? 'Counts derived from two-dot ranges against merge-base lineage.'
        : 'No merge-base found; counts derived from symmetric difference.',
    absorb_summary: {
      total_upstream_commits_in_range: upstreamCommits.length,
      required_count: requiredCount,
      optional_docs_count: optionalDocsCount,
      already_applied_count: alreadyAppliedCount,
      merge_commits_in_range: mergeCommitsInRange,
      merge_commits_skipped: opts.includeMerges ? 0 : mergeCommitsInRange,
      merge_strategy: opts.includeMerges ? 'included' : 'excluded',
    },
  };

  const statePath = path.join(opts.outputDir, 'last-sync.json');
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const reportLines = [
    '# Upstream Sync Report',
    '',
    `Generated at: ${checkedAt}`,
    '',
    '## Summary',
    '',
    `- relation: ${state.relation}`,
    `- status: ${state.status}`,
    `- merge_base: ${state.merge_base ?? '(none)'}`,
    `- upstream_ref: ${state.upstream_ref} (${state.upstream_head})`,
    `- local_ref: ${state.local_ref} (${state.local_head})`,
    '',
    '## Counts',
    '',
    `- upstream_only_count: ${state.upstream_only_count}`,
    `- local_only_count: ${state.local_only_count}`,
    `- behind_count: ${state.behind_count}`,
    `- ahead_count: ${state.ahead_count}`,
    '',
    '## Notes',
    '',
    `- ${state.notes}`,
    '',
    '## Absorb Summary',
    '',
    `- total_upstream_commits_in_range: ${upstreamCommits.length}`,
    `- required_count: ${requiredCount}`,
    `- optional_docs_count: ${optionalDocsCount}`,
    `- already_applied_count: ${alreadyAppliedCount}`,
    `- merge_commits_in_range: ${mergeCommitsInRange}`,
    `- merge_commits_skipped: ${opts.includeMerges ? 0 : mergeCommitsInRange}`,
    `- merge_strategy: ${opts.includeMerges ? 'included' : 'excluded'}`,
    '',
    '## Upstream Commit Evaluation',
    '',
    '| commit | date | recommendation | domain | files | +/- | subject |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    ...upstreamCommits.map((item) =>
      `| ${item.short} | ${item.date.slice(0, 10)} | ${item.recommendation} | ${item.domain} | ${item.files.length} | +${item.insertions}/-${item.deletions} | ${item.subject.replace(/\|/g, '\\|')} |`,
    ),
    '',
    '## Suggested Local Commits',
    '',
    ...(suggestedPlans.length === 0
      ? ['- No required upstream commits need absorption.']
      : suggestedPlans.flatMap((plan) => [
        `### ${plan.domain}`,
        '',
        plan.recommendedMessage.trim().length > 0
          ? `- recommended_message: \`${plan.recommendedMessage}\``
          : '- recommended_message: (由执行 Agent 基于 includes 自动生成)',
        '- includes:',
        ...plan.upstreamCommits.map((commit) =>
          `  - ${commit.short} ${commit.subject} (${commit.date.slice(0, 10)})`,
        ),
        '',
      ])),
  ];
  const reportPath = path.join(opts.outputDir, 'sync-report.md');
  fs.writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  const absorbJsonPath = path.join(opts.outputDir, 'absorb-plan.json');
  fs.writeFileSync(
    absorbJsonPath,
    `${JSON.stringify({
      checked_at: checkedAt,
      upstream_ref: opts.upstreamRef,
      upstream_head: upstreamMeta.short,
      local_ref: opts.localRef,
      local_head: localMeta.short,
      summary: state.absorb_summary,
      commits: upstreamCommits,
      suggested_local_commits: suggestedPlans,
    }, null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(
    `upstream-tracking: status=${status} relation=${state.relation} ahead=${state.ahead_count} behind=${state.behind_count}\n`,
  );
  process.stdout.write(`upstream-tracking: wrote ${statePath}\n`);
  process.stdout.write(`upstream-tracking: wrote ${reportPath}\n`);
  process.stdout.write(`upstream-tracking: wrote ${absorbJsonPath}\n`);
}

main();
