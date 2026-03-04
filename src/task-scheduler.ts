import { ChildProcess, execFileSync } from 'child_process';
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
  updateTaskAfterManualRun,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { hasScriptCapacity, runScript } from './script-runner.js';
import { ingestTodo } from './todo-core.js';
import { ingestDecisionItem } from './decision-core.js';
import { RegisteredGroup, ScheduledTask, TaskState } from './types.js';

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
const TASK_WORKTREE_DIR = path.join(GROUPS_DIR, '.task-worktrees');

interface TaskRunOptions {
  manualRun?: boolean;
}

interface TaskExecutionContext {
  group: RegisteredGroup;
  cleanup: () => void;
}

export interface TriggerTaskRunNowResult {
  accepted: boolean;
  queued: boolean;
  mode: 'agent' | 'script';
  error?: string;
}

export interface CompetitorGitCursorConfig {
  repo: string;
  branch: string;
  lastSha: string | null;
  lookbackCommits: number;
}

export function shouldIngestAutomationErrorTodo(
  task: Pick<ScheduledTask, 'task_config'>,
  error: string | null,
): boolean {
  if (!error) return false;
  return task.task_config?.on_error?.todo_ingest === true;
}

export function shouldIngestAutomationDecisionItem(
  task: Pick<ScheduledTask, 'task_config'>,
  error: string | null,
  result: string | null,
): boolean {
  if (error) return false;
  if (!result || result.trim().length === 0) return false;
  return task.task_config?.on_success?.decision_ingest === true;
}

function normalizeGitSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!GIT_SHA_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function getCompetitorGitCursorConfig(
  task: Pick<ScheduledTask, 'task_config' | 'task_state'>,
): CompetitorGitCursorConfig | null {
  const config = task.task_config?.plugins?.competitor_git;
  if (config?.enabled === false) return null;
  const repo = (config?.repo ?? '').trim();
  if (!repo) return null;

  const branchRaw = (config?.branch ?? '').trim();
  const branch = branchRaw || 'main';
  const lastSha = normalizeGitSha(
    task.task_state?.plugins?.competitor_git?.last_sha ?? null,
  );
  const lookbackRaw = Number(config?.lookback_commits);
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
  const currentState = task.task_state ?? {};
  const currentPluginState = currentState.plugins?.competitor_git ?? {};
  const existingSha = normalizeGitSha(currentPluginState.last_sha ?? null);
  const resolvedSha = nextSha ?? existingSha;

  const nextState: TaskState = {
    ...currentState,
    plugins: {
      ...(currentState.plugins ?? {}),
      competitor_git: {
        ...currentPluginState,
        last_sha: resolvedSha,
        last_scan_at: nowIso,
      },
    },
  };
  updateTask(task.id, { task_state: nextState });

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

function resolveExecutionModeForTask(
  group: RegisteredGroup,
  allGroups: Record<string, RegisteredGroup>,
): 'host' | 'container' {
  // Non-home groups can share a folder with a home group (web/im aliases).
  // In that case, inherit the home group's mode for consistent behavior.
  if (!group.is_home) {
    const homeSibling = Object.values(allGroups).find(
      (item) => item.folder === group.folder && item.is_home,
    );
    if (homeSibling?.executionMode === 'host') return 'host';
  }
  return group.executionMode === 'host' ? 'host' : 'container';
}

function getTaskGroupForExecution(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
): RegisteredGroup | null {
  const groups = deps.registeredGroups();
  const group = groups[groupJid];
  if (!group || group.folder !== task.group_folder) {
    return null;
  }
  return group;
}

function getTaskGitRoot(group: RegisteredGroup, task: ScheduledTask): string | null {
  const candidates = [group.customCwd, path.join(GROUPS_DIR, task.group_folder)].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  for (const candidate of candidates) {
    try {
      const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: candidate,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (gitRoot) return gitRoot;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function createTaskExecutionContext(
  task: ScheduledTask,
  group: RegisteredGroup,
  executionMode: 'host' | 'container',
): TaskExecutionContext {
  if (task.execution_environment !== 'worktree') {
    return { group, cleanup: () => {} };
  }

  if (executionMode !== 'host') {
    logger.warn(
      { taskId: task.id, groupFolder: task.group_folder, executionMode },
      'execution_environment=worktree is only supported in host mode; using local execution',
    );
    return { group, cleanup: () => {} };
  }

  const gitRoot = getTaskGitRoot(group, task);
  if (!gitRoot) {
    logger.warn(
      { taskId: task.id, groupFolder: task.group_folder },
      'execution_environment=worktree requested but no git repository found; using local execution',
    );
    return { group, cleanup: () => {} };
  }

  fs.mkdirSync(path.join(TASK_WORKTREE_DIR, task.group_folder), { recursive: true });
  const worktreeDir = fs.mkdtempSync(
    path.join(TASK_WORKTREE_DIR, task.group_folder, `${task.id}-`),
  );

  try {
    const addArgs = ['worktree', 'add', '--detach', worktreeDir, 'HEAD'];
    execFileSync('git', addArgs, {
      cwd: gitRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logger.info(
      { taskId: task.id, gitRoot, worktreeDir },
      'Created task worktree',
    );
  } catch (err) {
    try {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
    logger.warn(
      { taskId: task.id, gitRoot, err },
      'Failed to create git worktree; using local execution',
    );
    return { group, cleanup: () => {} };
  }

  return {
    group: {
      ...group,
      customCwd: worktreeDir,
    },
    cleanup: () => {
      try {
        const removeArgs = ['worktree', 'remove', '--force', worktreeDir];
        execFileSync('git', removeArgs, {
          cwd: gitRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        logger.warn(
          { taskId: task.id, worktreeDir, err },
          'Failed to remove task worktree cleanly; forcing directory cleanup',
        );
        try {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        } catch {
          // Best effort cleanup.
        }
      }
    },
  };
}

function summarizeTaskResult(result: string | null, error: string | null): string {
  if (error) return `Error: ${error}`;
  if (result) return result.slice(0, 200);
  return 'Completed';
}

function persistTaskRun(
  task: ScheduledTask,
  options: TaskRunOptions,
  startedAtMs: number,
  result: string | null,
  error: string | null,
): void {
  const durationMs = Date.now() - startedAtMs;
  const runAt = new Date().toISOString();
  const resultSummary = summarizeTaskResult(result, error);

  logTaskRun({
    task_id: task.id,
    run_at: runAt,
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });
  maybeIngestAutomationFailureTodo(task, runAt, error, result);
  maybeIngestAutomationDecisionItem(task, runAt, error, result);
  updateCompetitorGitCursorState(task, result, error);

  if (options.manualRun) {
    updateTaskAfterManualRun(task.id, resultSummary);
    return;
  }

  const nextRun = computeNextRun(task);
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

function resolveTaskTargetGroupJid(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): string | null {
  const groups = deps.registeredGroups();
  let targetGroupJid = task.chat_jid;
  const directTarget = groups[targetGroupJid];
  if (!directTarget || directTarget.folder !== task.group_folder) {
    const sameFolder = Object.entries(groups).filter(
      ([, group]) => group.folder === task.group_folder,
    );
    const preferred = sameFolder.find(([jid]) => jid.startsWith('web:')) || sameFolder[0];
    targetGroupJid = preferred?.[0] || '';
  }
  return targetGroupJid || null;
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

function maybeIngestAutomationDecisionItem(
  task: ScheduledTask,
  runAtIso: string,
  error: string | null,
  result: string | null,
): void {
  if (!shouldIngestAutomationDecisionItem(task, error, result)) {
    return;
  }

  try {
    const taskPrompt = task.prompt.trim();
    const title = taskPrompt.length > 0
      ? `Automation suggestion: ${taskPrompt.slice(0, 80)}`
      : `Automation suggestion: ${task.id}`;
    const scopeLevel =
      task.group_folder === MAIN_GROUP_FOLDER ? 'global' : 'workspace';
    const summary = (result ?? '').trim().slice(0, 4000);
    ingestDecisionItem(
      {
        title,
        summary,
        scope_level: scopeLevel,
        scope_id: scopeLevel === 'workspace' ? task.group_folder : undefined,
        source_type: 'automation',
        source_id: task.id,
        source_run_id: runAtIso,
        evidence: {
          result,
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
          task_id: task.id,
        },
        suggested_todo: {
          title,
          description: summary,
          priority: 'medium',
        },
      },
      'system:scheduler',
    );
  } catch (ingestError) {
    logger.warn(
      { taskId: task.id, ingestError },
      'Failed to ingest automation decision item',
    );
  }
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
  options: TaskRunOptions = {},
): Promise<void> {
  runningTaskIds.add(task.id);
  const startTime = Date.now();
  let result: string | null = null;
  let error: string | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let executionContext: TaskExecutionContext | null = null;
  let executionMode: 'host' | 'container' = 'container';

  try {
    const groupDir = path.join(GROUPS_DIR, task.group_folder);
    fs.mkdirSync(groupDir, { recursive: true });

    logger.info(
      {
        taskId: task.id,
        group: task.group_folder,
        manualRun: options.manualRun === true,
        executionEnvironment: task.execution_environment || 'local',
      },
      'Running scheduled task',
    );

    const group = getTaskGroupForExecution(task, deps, groupJid);
    if (!group) {
      error = `Group not found: ${task.group_folder}`;
      logger.error(
        { taskId: task.id, groupFolder: task.group_folder, groupJid },
        'Group not found for task',
      );
      return;
    }

    const allGroups = deps.registeredGroups();
    executionMode = resolveExecutionModeForTask(group, allGroups);
    executionContext = createTaskExecutionContext(task, group, executionMode);
    const effectiveGroup = executionContext.group;

    // Update tasks snapshot for container to read (filtered by group).
    const isHome = !!effectiveGroup.is_home;
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

    const competitorGitConfig = getCompetitorGitCursorConfig(task);
    const agentPrompt = competitorGitConfig
      ? buildPromptWithCompetitorGitCursor(task.prompt, competitorGitConfig)
      : task.prompt;

    // For group context mode, use the group's current session.
    const sessions = deps.getSessions();
    const sessionId =
      task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

    // Idle timer: writes _close sentinel after idleTimeout of no output,
    // so the container exits instead of hanging at waitForIpcMessage forever.
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

    const runAgent =
      executionMode === 'host' ? runHostAgent : runContainerAgent;

    const output = await runAgent(
      effectiveGroup,
      {
        prompt: agentPrompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: groupJid,
        operationPermissionMode: task.operation_permission_mode,
        agentRuntimeOverride: task.agent_runtime_override ?? undefined,
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
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    runningTaskIds.delete(task.id);
    try {
      executionContext?.cleanup();
    } catch (cleanupError) {
      logger.warn(
        { taskId: task.id, cleanupError },
        'Task execution context cleanup failed',
      );
    }
  }

  persistTaskRun(task, options, startTime, result, error);
}

async function runScriptTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
  options: TaskRunOptions = {},
): Promise<void> {
  runningTaskIds.add(task.id);
  const startTime = Date.now();

  logger.info(
    {
      taskId: task.id,
      group: task.group_folder,
      executionType: 'script',
      manualRun: options.manualRun === true,
      executionEnvironment: task.execution_environment || 'local',
    },
    'Running script task',
  );

  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const scriptCommand = task.script_command?.trim() || '';
  if (!scriptCommand) {
    const reason = 'script_command is empty';
    logger.error({ taskId: task.id }, 'Script task has no script_command, skipping');
    runningTaskIds.delete(task.id);
    persistTaskRun(task, options, startTime, null, reason);
    return;
  }

  let result: string | null = null;
  let error: string | null = null;
  let executionContext: TaskExecutionContext | null = null;

  try {
    const group = getTaskGroupForExecution(task, deps, groupJid);
    if (!group) {
      error = `Group not found: ${task.group_folder}`;
      logger.error(
        { taskId: task.id, groupFolder: task.group_folder, groupJid },
        'Group not found for script task',
      );
      return;
    }

    const allGroups = deps.registeredGroups();
    const executionMode = resolveExecutionModeForTask(group, allGroups);
    executionContext = createTaskExecutionContext(task, group, executionMode);
    const effectiveGroup = executionContext.group;

    const scriptResult = await runScript(
      scriptCommand,
      task.group_folder,
      executionMode === 'host' ? effectiveGroup.customCwd : undefined,
    );

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
    try {
      executionContext?.cleanup();
    } catch (cleanupError) {
      logger.warn(
        { taskId: task.id, cleanupError },
        'Script task execution context cleanup failed',
      );
    }
  }

  persistTaskRun(task, options, startTime, result, error);
}

let schedulerRunning = false;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastCleanupTime = 0;
let schedulerDepsRef: SchedulerDependencies | null = null;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  schedulerDepsRef = deps;
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

        const targetGroupJid = resolveTaskTargetGroupJid(currentTask, deps);
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

export function triggerTaskRunNow(taskId: string): TriggerTaskRunNowResult {
  const deps = schedulerDepsRef;
  if (!deps) {
    return {
      accepted: false,
      queued: false,
      mode: 'agent',
      error: 'Scheduler not initialized',
    };
  }

  const task = getTaskById(taskId);
  if (!task) {
    return {
      accepted: false,
      queued: false,
      mode: 'agent',
      error: 'Task not found',
    };
  }

  if (runningTaskIds.has(task.id)) {
    return {
      accepted: false,
      queued: false,
      mode: task.execution_type === 'script' ? 'script' : 'agent',
      error: 'Task is already running',
    };
  }

  const targetGroupJid = resolveTaskTargetGroupJid(task, deps);
  if (!targetGroupJid) {
    return {
      accepted: false,
      queued: false,
      mode: task.execution_type === 'script' ? 'script' : 'agent',
      error: 'Target group is not registered',
    };
  }

  if (task.execution_type === 'script') {
    if (!hasScriptCapacity()) {
      return {
        accepted: false,
        queued: false,
        mode: 'script',
        error: 'Script runner is busy',
      };
    }
    runScriptTask(task, deps, targetGroupJid, { manualRun: true }).catch((err) => {
      logger.error({ taskId: task.id, err }, 'Unhandled error in manual runScriptTask');
    });
    return {
      accepted: true,
      queued: false,
      mode: 'script',
    };
  }

  deps.queue.enqueueTask(targetGroupJid, task.id, () =>
    runTask(task, deps, targetGroupJid, { manualRun: true }),
  );
  return {
    accepted: true,
    queued: true,
    mode: 'agent',
  };
}
