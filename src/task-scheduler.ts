import { ChildProcess, execFileSync } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import {
  AGENT_PROVIDER_IDS,
  type AgentProvider,
  isAgentProviderConfigured,
  normalizeAgentProvider,
} from './agent-providers.js';
import { DailySummaryDeps, runDailySummaryIfNeeded } from './daily-summary.js';
import {
  getContainerEnvConfig,
  getRuntimeProviderConfig,
  getSystemSettings,
  mergeRuntimeEnvConfig,
} from './runtime-config.js';
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
  updateTaskAfterManualRun,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { hasScriptCapacity, runScript } from './script-runner.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

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
const SCHEDULED_TASK_RESULT_CLOSE_MS = 5_000;
const RETRYABLE_RUNTIME_ERROR_RE = /(no available accounts|all accounts rate limited|rate[\s-]*limit|resource_exhausted|too many requests|api error:\s*(429|503)|service unavailable|temporarily unavailable|route family|process exited with code 143|claude code process exited with code 143|日次数额度上限|次数额度上限)/i;

type TaskExecutionOptions = {
  advanceSchedule?: boolean;
};

export type TriggerTaskRunNowResult = {
  accepted: boolean;
  queued: boolean;
  mode: 'agent' | 'script';
  error?: string;
};

type TaskExecutionEnvironment = 'local' | 'worktree';

type TaskWorkspaceHandle = {
  cwd: string;
  environment: TaskExecutionEnvironment;
  cleanup?: () => void;
};

function getProviderDisplayName(provider: AgentProvider): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return 'Claude';
}

function resolveTaskRuntimeCandidates(
  groupFolder: string,
  preferredRuntimeOverride?: AgentProvider | null,
): AgentProvider[] {
  const globalConfig = getRuntimeProviderConfig();
  const mergedConfig = mergeRuntimeEnvConfig(
    globalConfig,
    getContainerEnvConfig(groupFolder),
  );
  const preferred = normalizeAgentProvider(
    preferredRuntimeOverride ?? mergedConfig.agentRuntime,
  );
  const configured = AGENT_PROVIDER_IDS.filter((provider) =>
    isAgentProviderConfigured(provider, mergedConfig),
  );
  if (configured.length === 0) return [preferred];
  if (!configured.includes(preferred)) return [preferred, ...configured];
  return [preferred, ...configured.filter((provider) => provider !== preferred)];
}

function resolveTaskExecutionEnvironment(task: ScheduledTask): TaskExecutionEnvironment {
  return task.execution_environment === 'worktree' ? 'worktree' : 'local';
}

function resolveTaskProjectDir(group: RegisteredGroup, groupFolder: string): string {
  const fallback = path.join(GROUPS_DIR, groupFolder);
  const raw = group.customCwd?.trim() || fallback;
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(raw);
  if (!fs.existsSync(absolute)) fs.mkdirSync(absolute, { recursive: true });
  const realPath = fs.realpathSync(absolute);
  if (!fs.statSync(realPath).isDirectory()) {
    throw new Error(`Task project directory is not a directory: ${realPath}`);
  }
  return realPath;
}

function isGitWorktreeRepo(cwd: string): boolean {
  try {
    const output = execFileSync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function createTaskWorktree(projectDir: string, taskId: string): TaskWorkspaceHandle {
  if (!isGitWorktreeRepo(projectDir)) {
    throw new Error(
      `execution_environment=worktree requires a git repository project directory: ${projectDir}`,
    );
  }

  const worktreeRoot = path.join(DATA_DIR, 'task-worktrees', taskId);
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const worktreeDir = path.join(
    worktreeRoot,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    execFileSync(
      'git',
      ['worktree', 'add', '--detach', worktreeDir, 'HEAD'],
      { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    throw new Error(
      `Failed to create git worktree for task ${taskId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    cwd: worktreeDir,
    environment: 'worktree',
    cleanup: () => {
      try {
        execFileSync(
          'git',
          ['worktree', 'remove', '--force', worktreeDir],
          { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (error) {
        logger.warn(
          { taskId, worktreeDir, error },
          'Failed to remove task git worktree with git, falling back to filesystem cleanup',
        );
        try {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup fallback errors
        }
      }
      try {
        execFileSync('git', ['worktree', 'prune'], {
          cwd: projectDir,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch {
        // ignore prune errors
      }
    },
  };
}

function createTaskWorkspaceHandle(
  task: ScheduledTask,
  group: RegisteredGroup,
  executionMode: 'container' | 'host',
): TaskWorkspaceHandle {
  const projectDir = resolveTaskProjectDir(group, task.group_folder);
  const environment = resolveTaskExecutionEnvironment(task);
  if (environment !== 'worktree') {
    return {
      cwd: projectDir,
      environment: 'local',
    };
  }
  if (executionMode !== 'host') {
    logger.warn(
      { taskId: task.id, requestedEnvironment: environment, executionMode },
      'Task requested worktree environment in non-host mode, falling back to local project directory',
    );
    return {
      cwd: projectDir,
      environment: 'local',
    };
  }
  return createTaskWorktree(projectDir, task.id);
}

function resolveTaskTargetGroupJid(
  task: ScheduledTask,
  groups: Record<string, RegisteredGroup>,
): string | null {
  let targetGroupJid = task.chat_jid;
  const directTarget = groups[targetGroupJid];
  if (!directTarget || directTarget.folder !== task.group_folder) {
    const sameFolder = Object.entries(groups).filter(
      ([, group]) => group.folder === task.group_folder,
    );
    const preferred =
      sameFolder.find(([jid]) => jid.startsWith('web:')) ||
      sameFolder[0];
    targetGroupJid = preferred?.[0] || '';
  }
  return targetGroupJid || null;
}

function shouldRetryWithFallbackRuntime(
  runtimeError: string | null | undefined,
  runtimeResult: string | null | undefined,
): boolean {
  const combined = `${runtimeError || ''}\n${runtimeResult || ''}`.trim();
  if (!combined) return false;
  return RETRYABLE_RUNTIME_ERROR_RE.test(combined);
}

export function shouldRetryScheduledTaskRuntimeAttempt(
  runtimeError: string | null | undefined,
  runtimeResult: string | null | undefined,
  hasNextRuntime: boolean,
): boolean {
  if (!hasNextRuntime) return false;
  return shouldRetryWithFallbackRuntime(runtimeError, runtimeResult);
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

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
  options: TaskExecutionOptions = {},
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
  let workspaceHandle: TaskWorkspaceHandle | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // Idle timer: writes _close sentinel after idleTimeout of no output,
  // so the container exits instead of hanging at waitForIpcMessage forever.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = (timeoutMs = getSystemSettings().idleTimeout) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { taskId: task.id },
        'Scheduled task idle timeout, closing container stdin',
      );
      deps.queue.closeStdin(groupJid);
    }, timeoutMs);
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
    workspaceHandle = createTaskWorkspaceHandle(task, group, executionMode);
    const runGroup = executionMode === 'host'
      ? { ...group, customCwd: workspaceHandle.cwd }
      : group;
    const runtimeCandidates = resolveTaskRuntimeCandidates(
      task.group_folder,
      task.agent_runtime_override ?? null,
    );
    let attemptOutput: ContainerOutput | null = null;

    for (let index = 0; index < runtimeCandidates.length; index += 1) {
      const runtime = runtimeCandidates[index];
      const isFallbackAttempt = index > 0;
      if (isFallbackAttempt) {
        const fromRuntime = runtimeCandidates[index - 1];
        const notice =
          `${deps.assistantName}: 检测到 ${getProviderDisplayName(fromRuntime)} 运行异常，` +
          `自动切换到 ${getProviderDisplayName(runtime)} 重试（${index + 1}/${runtimeCandidates.length}）。`;
        try {
          await deps.sendMessage(groupJid, notice);
        } catch (notifyErr) {
          logger.warn(
            { taskId: task.id, notifyErr },
            'Failed to send runtime fallback notice',
          );
        }
      }

      attemptOutput = await runAgent(
        runGroup,
        {
          prompt: task.prompt,
          sessionId: isFallbackAttempt ? undefined : sessionId,
          groupFolder: task.group_folder,
          chatJid: groupJid,
          operationPermissionMode: task.operation_permission_mode === 'bypass'
            ? 'bypass'
            : 'default',
          isMain: isAdminHome,
          isHome,
          isAdminHome,
          isScheduledTask: true,
          agentRuntimeOverride: runtime,
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
          }
          if (streamedOutput.status === 'success') {
            // Scheduled tasks are one-shot; close session shortly after final success output.
            resetIdleTimer(SCHEDULED_TASK_RESULT_CLOSE_MS);
          } else if (streamedOutput.result) {
            // Keep legacy idle timeout for non-terminal result markers.
            resetIdleTimer();
          }
          if (streamedOutput.status === 'error') {
            error = streamedOutput.error || 'Unknown error';
          }
        },
      );

      const hasNext = index < runtimeCandidates.length - 1;
      const shouldRetry = shouldRetryScheduledTaskRuntimeAttempt(
        attemptOutput.error,
        attemptOutput.result,
        hasNext,
      );
      if (!shouldRetry) break;

      const failureReason = attemptOutput.error
        || attemptOutput.result
        || 'Unknown runtime failure';
      logger.warn(
        {
          taskId: task.id,
          runtime,
          nextRuntime: runtimeCandidates[index + 1],
          reason: failureReason,
        },
        'Scheduled task runtime failed, auto-falling back to next provider',
      );
      error = null;
    }

    if (idleTimer) clearTimeout(idleTimer);

    if (attemptOutput?.status === 'error') {
      error = attemptOutput.error || 'Unknown error';
      if (attemptOutput.result) result = attemptOutput.result;
    } else if (attemptOutput?.result) {
      // Messages are sent via MCP tool (IPC), result text is just logged
      result = attemptOutput.result;
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
    if (workspaceHandle?.cleanup) {
      try {
        workspaceHandle.cleanup();
      } catch (cleanupError) {
        logger.warn(
          { taskId: task.id, cleanupError },
          'Failed to cleanup task workspace',
        );
      }
    }
    runningTaskIds.delete(task.id);
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  if (options.advanceSchedule === false) {
    updateTaskAfterManualRun(task.id, resultSummary);
    return;
  }
  const nextRun = computeNextRun(task);
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

async function runScriptTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
  groupJid: string,
  options: TaskExecutionOptions = {},
): Promise<void> {
  runningTaskIds.add(task.id);
  const startTime = Date.now();
  let workspaceHandle: TaskWorkspaceHandle | null = null;

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
    const groups = deps.registeredGroups();
    const group = groups[groupJid];
    if (!group || group.folder !== task.group_folder) {
      throw new Error(`Group not found for task script execution: ${task.group_folder}`);
    }

    // Keep host/container mode resolution consistent with agent tasks.
    let executionMode = group.executionMode || 'container';
    if (!group.is_home) {
      const homeSibling = Object.values(groups).find(
        (g) => g.folder === group.folder && g.is_home,
      );
      if (homeSibling) executionMode = homeSibling.executionMode || 'container';
    }
    workspaceHandle = createTaskWorkspaceHandle(task, group, executionMode);

    const scriptResult = await runScript(
      scriptCommand,
      task.group_folder,
      workspaceHandle.cwd,
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
    if (workspaceHandle?.cleanup) {
      try {
        workspaceHandle.cleanup();
      } catch (cleanupError) {
        logger.warn(
          { taskId: task.id, cleanupError },
          'Failed to cleanup script task workspace',
        );
      }
    }
    runningTaskIds.delete(task.id);
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  if (options.advanceSchedule === false) {
    updateTaskAfterManualRun(task.id, resultSummary);
    return;
  }
  const nextRun = computeNextRun(task);
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

export function triggerTaskRunNow(taskId: string): TriggerTaskRunNowResult {
  const deps = schedulerDepsRef;
  if (!deps) {
    return {
      accepted: false,
      queued: false,
      mode: 'agent',
      error: 'Scheduler is not ready',
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

  const mode: 'agent' | 'script' = task.execution_type === 'script'
    ? 'script'
    : 'agent';

  if (runningTaskIds.has(task.id)) {
    return {
      accepted: false,
      queued: false,
      mode,
      error: 'Task is already running',
    };
  }

  const groups = deps.registeredGroups();
  const targetGroupJid = resolveTaskTargetGroupJid(task, groups);
  if (!targetGroupJid) {
    return {
      accepted: false,
      queued: false,
      mode,
      error: 'Target group not registered',
    };
  }

  if (mode === 'script') {
    if (!hasScriptCapacity()) {
      return {
        accepted: false,
        queued: false,
        mode,
        error: 'Script concurrency limit reached',
      };
    }
    runScriptTask(task, deps, targetGroupJid, { advanceSchedule: false }).catch((err) => {
      logger.error({ taskId: task.id, err }, 'Unhandled error in manual runScriptTask');
    });
    return {
      accepted: true,
      queued: false,
      mode,
    };
  }

  // Mark as running before enqueue to prevent duplicate run-now clicks creating duplicate queue items.
  runningTaskIds.add(task.id);
  try {
    deps.queue.enqueueTask(targetGroupJid, task.id, async () => {
      try {
        await runTask(task, deps, targetGroupJid, { advanceSchedule: false });
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  } catch (error) {
    runningTaskIds.delete(task.id);
    throw error;
  }
  return {
    accepted: true,
    queued: true,
    mode,
  };
}

let schedulerRunning = false;
let schedulerDepsRef: SchedulerDependencies | null = null;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastCleanupTime = 0;

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

        const groups = deps.registeredGroups();
        const targetGroupJid = resolveTaskTargetGroupJid(currentTask, groups);

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
            runTask(currentTask, deps, targetGroupJid, { advanceSchedule: true }),
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
