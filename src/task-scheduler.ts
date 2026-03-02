import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { DailySummaryDeps, runDailySummaryIfNeeded } from './daily-summary.js';
import { getSystemSettings } from './runtime-config.js';
import {
  ContainerOutput,
  runContainerAgent,
  runHostAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  cleanupOldTaskRunLogs,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { hasScriptCapacity, runScript } from './script-runner.js';
import { ingestTodo } from './todo-core.js';
import { RegisteredGroup, ScheduledTask, TaskWorkflowRules } from './types.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string | null,
    groupFolder: string,
    displayName?: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
  assistantName: string;
  dailySummaryDeps?: DailySummaryDeps;
}

const runningTaskIds = new Set<string>();
const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GIT_SHA_CAPTURE_RE =
  /(?:SOLOMESH_COMPETITOR_GIT_HEAD|competitor_git_next_sha)\s*[:=]\s*([0-9a-f]{7,40})/gi;

export interface CompetitorGitCursorConfig {
  repo: string;
  branch: string;
  lastSha: string | null;
  lookbackCommits: number;
}

export function shouldIngestAutomationErrorTodo(
  task: Pick<ScheduledTask, 'workflow_rules'>,
  error: string | null,
): boolean {
  if (!error) return false;
  return task.workflow_rules?.on_error?.todo_ingest === true;
}

function normalizeGitSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!GIT_SHA_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function parsePromptCompetitorGitHints(prompt: string): {
  repo?: string;
  branch?: string;
  lookbackCommits?: number;
} {
  const repo =
    prompt.match(/^\s*(?:repo|repo_url)\s*[:=]\s*(\S+)/im)?.[1]?.trim() || '';
  const branch =
    prompt.match(/^\s*branch\s*[:=]\s*([^\s]+)/im)?.[1]?.trim() || '';
  const lookbackRaw = prompt.match(/^\s*lookback_commits\s*[:=]\s*(\d+)/im)?.[1];
  const lookback = lookbackRaw ? Number.parseInt(lookbackRaw, 10) : NaN;
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
    ...(Number.isFinite(lookback) && lookback > 0 ? { lookbackCommits: lookback } : {}),
  };
}

export function getCompetitorGitCursorConfig(
  task: Pick<ScheduledTask, 'workflow_rules' | 'prompt'>,
): CompetitorGitCursorConfig | null {
  const state = task.workflow_rules?.plugin_state?.competitor_git;
  if (state?.enabled === false) return null;
  const hint = parsePromptCompetitorGitHints(task.prompt);
  const repo = (state?.repo ?? hint.repo ?? '').trim();
  if (!repo) return null;

  const branchRaw = (state?.branch ?? hint.branch ?? '').trim();
  const branch = branchRaw || 'main';
  const lastSha = normalizeGitSha(state?.last_sha ?? null);
  const lookbackRaw = Number(state?.lookback_commits ?? hint.lookbackCommits);
  const lookbackCommits =
    Number.isFinite(lookbackRaw) && lookbackRaw > 0
      ? Math.min(500, Math.max(1, Math.floor(lookbackRaw)))
      : 50;

  return {
    repo,
    branch,
    lastSha,
    lookbackCommits,
  };
}

function buildCompetitorGitRange(config: CompetitorGitCursorConfig): string {
  if (config.lastSha) return `${config.lastSha}..HEAD`;
  return `HEAD~${config.lookbackCommits}..HEAD`;
}

export function buildPromptWithCompetitorGitCursor(
  basePrompt: string,
  config: CompetitorGitCursorConfig,
): string {
  return [
    basePrompt.trim(),
    '',
    '[competitor-git-cursor]',
    `repo: ${config.repo}`,
    `branch: ${config.branch}`,
    `range: ${buildCompetitorGitRange(config)}`,
    '请只分析上述 commit 范围内的变更，提炼新功能、优化、修复及影响。',
    '回复末尾必须附一行：competitor_git_next_sha: <HEAD_SHA>',
    '[/competitor-git-cursor]',
  ].join('\n');
}

export function extractCompetitorGitNextSha(
  output: string | null | undefined,
): string | null {
  if (typeof output !== 'string' || output.trim().length === 0) return null;
  GIT_SHA_CAPTURE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = GIT_SHA_CAPTURE_RE.exec(output)) !== null) {
    last = normalizeGitSha(match[1]);
  }
  return last;
}

function updateCompetitorGitCursorState(
  task: ScheduledTask,
  result: string | null,
  error: string | null,
): void {
  if (error) return;
  const config = getCompetitorGitCursorConfig(task);
  if (!config) return;

  const nextSha = extractCompetitorGitNextSha(result);
  const nowIso = new Date().toISOString();
  const currentRules = task.workflow_rules ?? {};
  const currentState = currentRules.plugin_state?.competitor_git ?? {};
  const existingSha = normalizeGitSha(currentState.last_sha ?? null);
  const resolvedSha = nextSha ?? existingSha;

  const nextRules: TaskWorkflowRules = {
    ...currentRules,
    plugin_state: {
      ...(currentRules.plugin_state ?? {}),
      competitor_git: {
        ...currentState,
        enabled: currentState.enabled ?? true,
        repo: config.repo,
        branch: config.branch,
        lookback_commits: config.lookbackCommits,
        last_sha: resolvedSha,
        last_scan_at: nowIso,
      },
    },
  };
  updateTask(task.id, { workflow_rules: nextRules });

  if (nextSha && nextSha !== existingSha) {
    logger.info(
      { taskId: task.id, previousSha: existingSha, nextSha },
      'Updated competitor_git cursor',
    );
    return;
  }
  if (!nextSha) {
    logger.warn(
      { taskId: task.id },
      'competitor_git cursor marker missing from task output; cursor not advanced',
    );
  }
}

function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    const anchor = task.next_run ? new Date(task.next_run).getTime() : Date.now();
    let nextTime = anchor + ms;
    while (nextTime <= Date.now()) {
      nextTime += ms;
    }
    return new Date(nextTime).toISOString();
  }
  // 'once' tasks have no next run
  return null;
}

function maybeIngestAutomationFailureTodo(
  task: ScheduledTask,
  runAtIso: string,
  error: string | null,
  result: string | null,
): void {
  if (!shouldIngestAutomationErrorTodo(task, error)) {
    return;
  }

  try {
    ingestTodo(
      {
        title: `Automation task failed: ${task.id}`,
        description: (error ?? '').slice(0, 4000),
        priority: 'high',
        source_type: 'automation',
        source_id: task.id,
        source_run_id: runAtIso,
        trigger_mode: 'automation',
        evidence: {
          error,
          result,
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
        },
      },
      'system:scheduler',
    );
  } catch (ingestError) {
    logger.warn(
      { taskId: task.id, ingestError },
      'Failed to ingest automation failure todo',
    );
  }
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
): Promise<void> {
  runningTaskIds.add(task.id);
  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = groups[groupJid];

  if (!group || group.folder !== task.group_folder) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, groupJid },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    runningTaskIds.delete(task.id);
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isHome = !!group.is_home;
  const isAdminHome = isHome && task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isAdminHome,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;
  const competitorGitConfig = getCompetitorGitCursorConfig(task);
  const agentPrompt = competitorGitConfig
    ? buildPromptWithCompetitorGitCursor(task.prompt, competitorGitConfig)
    : task.prompt;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // Idle timer: writes _close sentinel after idleTimeout of no output,
  // so the container exits instead of hanging at waitForIpcMessage forever.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { taskId: task.id },
        'Scheduled task idle timeout, closing container stdin',
      );
      deps.queue.closeStdin(groupJid);
    }, getSystemSettings().idleTimeout);
  };

  try {
    // Resolve execution mode: if this group is not is_home but shares a folder
    // with an is_home group, inherit that group's execution mode (same logic as
    // queue.setHostModeResolver). Fixes tasks created from Telegram/IM picking
    // container mode even though admin home folder should run in host mode.
    let executionMode = group.executionMode || 'container';
    if (!group.is_home) {
      const allGroups = deps.registeredGroups();
      const homeSibling = Object.values(allGroups).find(
        (g) => g.folder === group.folder && g.is_home,
      );
      if (homeSibling) {
        executionMode = homeSibling.executionMode || 'container';
      }
    }
    const runAgent =
      executionMode === 'host' ? runHostAgent : runContainerAgent;

    const output = await runAgent(
      group,
      {
        prompt: agentPrompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: groupJid,
        isMain: isAdminHome,
        isHome,
        isAdminHome,
        isScheduledTask: true,
      },
      (proc, identifier) =>
        deps.onProcess(
          groupJid,
          proc,
          executionMode === 'container' ? identifier : null,
          task.group_folder,
          identifier,
        ),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (strip <internal> tags)
          const text = streamedOutput.result
            .replace(/<internal>[\s\S]*?<\/internal>/g, '')
            .trim();
          if (text) {
            await deps.sendMessage(
              groupJid,
              `${deps.assistantName}: ${text}`,
            );
          }
          // Only reset idle timer on actual results, not session-update markers
          resetIdleTimer();
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (idleTimer) clearTimeout(idleTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Messages are sent via MCP tool (IPC), result text is just logged
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (idleTimer) clearTimeout(idleTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  } finally {
    runningTaskIds.delete(task.id);
  }

  const durationMs = Date.now() - startTime;
  const runAt = new Date().toISOString();

  logTaskRun({
    task_id: task.id,
    run_at: runAt,
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });
  maybeIngestAutomationFailureTodo(task, runAt, error, result);
  updateCompetitorGitCursorState(task, result, error);

  const nextRun = computeNextRun(task);

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

async function runScriptTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
): Promise<void> {
  runningTaskIds.add(task.id);
  const startTime = Date.now();

  logger.info(
    { taskId: task.id, group: task.group_folder, executionType: 'script' },
    'Running script task',
  );

  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const scriptCommand = task.script_command?.trim() || '';
  if (!scriptCommand) {
    const reason = 'script_command is empty';
    logger.error({ taskId: task.id }, 'Script task has no script_command, skipping');
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: reason,
    });
    const nextRun = computeNextRun(task);
    updateTaskAfterRun(task.id, nextRun, `Error: ${reason}`);
    runningTaskIds.delete(task.id);
    return;
  }

  let result: string | null = null;
  let error: string | null = null;

  try {
    const scriptResult = await runScript(scriptCommand, task.group_folder);

    if (scriptResult.timedOut) {
      error = `Script timed out (${Math.round(scriptResult.durationMs / 1000)}s)`;
    } else if (scriptResult.exitCode !== 0) {
      error = scriptResult.stderr.trim() || `Exit code: ${scriptResult.exitCode}`;
      result = scriptResult.stdout.trim() || null;
    } else {
      result = scriptResult.stdout.trim() || '(no output)';
    }

    const text = error
      ? `[script] failed: ${error}${result ? `\noutput:\n${result.slice(0, 500)}` : ''}`
      : `[script] ${result!.slice(0, 1000)}`;

    await deps.sendMessage(groupJid, `${deps.assistantName}: ${text}`);

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime, exitCode: scriptResult.exitCode },
      'Script task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Script task failed');
  } finally {
    runningTaskIds.delete(task.id);
  }

  const durationMs = Date.now() - startTime;
  const runAt = new Date().toISOString();

  logTaskRun({
    task_id: task.id,
    run_at: runAt,
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });
  maybeIngestAutomationFailureTodo(task, runAt, error, result);
  updateCompetitorGitCursorState(task, result, error);

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastCleanupTime = 0;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      // Periodic cleanup of old task run logs (every 24h)
      const now = Date.now();
      if (now - lastCleanupTime >= CLEANUP_INTERVAL_MS) {
        lastCleanupTime = now;
        try {
          const deleted = cleanupOldTaskRunLogs();
          if (deleted > 0) {
            logger.info({ deleted }, 'Cleaned up old task run logs');
          }
        } catch (err) {
          logger.error({ err }, 'Failed to cleanup old task run logs');
        }
      }

      // Daily summary generation (runs at most once per hour, 2-3 AM)
      if (deps.dailySummaryDeps) {
        try {
          runDailySummaryIfNeeded(deps.dailySummaryDeps);
        } catch (err) {
          logger.error({ err }, 'Daily summary check failed');
        }
      }

      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        if (runningTaskIds.has(currentTask.id)) {
          continue;
        }

        const groups = deps.registeredGroups();
        let targetGroupJid = currentTask.chat_jid;
        const directTarget = groups[targetGroupJid];
        if (!directTarget || directTarget.folder !== currentTask.group_folder) {
          const sameFolder = Object.entries(groups).filter(
            ([, group]) => group.folder === currentTask.group_folder,
          );
          const preferred =
            sameFolder.find(([jid]) => jid.startsWith('web:')) ||
            sameFolder[0];
          targetGroupJid = preferred?.[0] || '';
        }

        if (!targetGroupJid) {
          logger.error(
            { taskId: currentTask.id, groupFolder: currentTask.group_folder },
            'Target group not registered, skipping scheduled task',
          );
          continue;
        }

        if (currentTask.execution_type === 'script') {
          if (!hasScriptCapacity()) {
            logger.debug(
              { taskId: currentTask.id },
              'Script concurrency limit reached, skipping',
            );
            continue;
          }
          runScriptTask(currentTask, deps, targetGroupJid).catch((err) => {
            logger.error({ taskId: currentTask.id, err }, 'Unhandled error in runScriptTask');
          });
        } else {
          deps.queue.enqueueTask(targetGroupJid, currentTask.id, () =>
            runTask(currentTask, deps, targetGroupJid),
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}
