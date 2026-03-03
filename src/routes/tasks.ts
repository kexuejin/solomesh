// Task management routes

import { Hono } from 'hono';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CronExpressionParser } from 'cron-parser';
import type { Variables } from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { TaskCreateSchema, TaskPatchSchema } from '../schemas.js';
import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getTaskRunLogs,
  getRegisteredGroup,
} from '../db.js';
import type { AuthUser } from '../types.js';
import { TIMEZONE } from '../config.js';
import { isHostExecutionGroup, hasHostExecutionPermission, canAccessGroup } from '../web-context.js';
import { isScriptTaskAdminOnlyMutation } from '../task-script-policy.js';
import { checkWorkflowSkillDependencies } from '../skills-registry.js';
import { parseSkillsSearchOutput } from '../skills-search-parser.js';
import { triggerTaskRunNow } from '../task-scheduler.js';

const tasksRoutes = new Hono<{ Variables: Variables }>();
const execFileAsync = promisify(execFile);
const SKILL_PACKAGE_RE = /^[\w\-]+\/[\w\-.]+(?:[@#][\w\-.\/]+)?$/;

function normalizeSkillRef(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTaskSkillRefs(value: string[] | undefined): string[] {
  if (!value) return [];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const ref = normalizeSkillRef(raw);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    deduped.push(ref);
  }
  return deduped;
}

function isSkillPackage(value: string): boolean {
  return SKILL_PACKAGE_RE.test(value.trim());
}

function packageMatchScore(skillRef: string, pkg: string): number {
  const ref = skillRef.trim().toLowerCase();
  const normalized = pkg.trim().toLowerCase();
  if (!ref || !normalized) return 0;
  if (normalized === ref) return 120;
  if (normalized.endsWith(`@${ref}`)) return 100;

  const slashIdx = normalized.indexOf('/');
  if (slashIdx > 0) {
    const repoAndSkill = normalized.slice(slashIdx + 1);
    const [repo] = repoAndSkill.split('@');
    if (repo === ref) return 80;
  }

  if (normalized.includes(ref)) return 40;
  return 0;
}

interface SkillInstallCandidate {
  package: string;
  installs?: string;
  url?: string;
}

interface SkillInstallResolution {
  optionsBySkillRef: Record<string, string[]>;
  candidatesBySkillRef: Record<string, SkillInstallCandidate[]>;
}

async function resolveSkillInstallOptions(skillRefs: string[]): Promise<SkillInstallResolution> {
  const optionsBySkillRef: Record<string, string[]> = {};
  const candidatesBySkillRef: Record<string, SkillInstallCandidate[]> = {};

  for (const rawRef of skillRefs) {
    const ref = normalizeSkillRef(rawRef);
    if (!ref) continue;
    if (isSkillPackage(ref)) {
      optionsBySkillRef[ref] = [ref];
      candidatesBySkillRef[ref] = [{ package: ref }];
      continue;
    }

    try {
      const { stdout } = await execFileAsync(
        'npx',
        ['-y', 'skills', 'find', ref],
        { timeout: 30_000 },
      );
      const parsed = parseSkillsSearchOutput(stdout);
      const scored = parsed
        .map((item) => ({
          package: item.package.trim(),
          installs: item.installs,
          url: item.url,
          score: packageMatchScore(ref, item.package),
        }))
        .filter((item) => isSkillPackage(item.package))
        .sort((a, b) => b.score - a.score || a.package.localeCompare(b.package));

      const dedupPackages: string[] = [];
      const dedupCandidates: SkillInstallCandidate[] = [];
      for (const item of scored) {
        if (dedupPackages.includes(item.package)) continue;
        dedupPackages.push(item.package);
        dedupCandidates.push({
          package: item.package,
          ...(item.installs ? { installs: item.installs } : {}),
          ...(item.url ? { url: item.url } : {}),
        });
        if (dedupPackages.length >= 6) break;
      }
      optionsBySkillRef[ref] = dedupPackages;
      candidatesBySkillRef[ref] = dedupCandidates;
    } catch (error) {
      if (error && typeof error === 'object' && 'stdout' in error) {
        const stdout = String((error as { stdout?: unknown }).stdout ?? '');
        const parsed = parseSkillsSearchOutput(stdout);
        const dedupCandidates = parsed
          .map((item) => ({
            package: item.package.trim(),
            installs: item.installs,
            url: item.url,
          }))
          .filter((item) => isSkillPackage(item.package))
          .filter((item, idx, arr) => arr.findIndex((target) => target.package === item.package) === idx)
          .slice(0, 6)
          .map((item) => ({
            package: item.package,
            ...(item.installs ? { installs: item.installs } : {}),
            ...(item.url ? { url: item.url } : {}),
          }));
        optionsBySkillRef[ref] = dedupCandidates.map((item) => item.package);
        candidatesBySkillRef[ref] = dedupCandidates;
      } else {
        optionsBySkillRef[ref] = [];
        candidatesBySkillRef[ref] = [];
      }
    }
  }

  return {
    optionsBySkillRef,
    candidatesBySkillRef,
  };
}

async function buildTaskSkillDependencyError(
  skillRefs: string[],
  ownerUserId: string | null | undefined,
): Promise<{
  error: string;
  details: {
    invalidSkillRefs: string[];
    missingSkillRefs: string[];
    availableSkillRefs: string[];
    skillInstallOptions: Record<string, string[]>;
    skillInstallCandidates: Record<string, SkillInstallCandidate[]>;
  };
} | null> {
  const dependencyCheck = checkWorkflowSkillDependencies(skillRefs, {
    scope: 'user',
    ownerUserId,
  });
  if (
    dependencyCheck.invalidSkillRefs.length === 0
    && dependencyCheck.missingSkillRefs.length === 0
  ) {
    return null;
  }

  const installResolution = await resolveSkillInstallOptions(dependencyCheck.missingSkillRefs);
  return {
    error: 'Task skill dependencies are not satisfied',
    details: {
      invalidSkillRefs: dependencyCheck.invalidSkillRefs,
      missingSkillRefs: dependencyCheck.missingSkillRefs,
      availableSkillRefs: dependencyCheck.availableSkillRefs,
      skillInstallOptions: installResolution.optionsBySkillRef,
      skillInstallCandidates: installResolution.candidatesBySkillRef,
    },
  };
}

// --- Routes ---

tasksRoutes.get('/', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const tasks = getAllTasks().filter((task) => {
    const group = getRegisteredGroup(task.chat_jid);
    // Conservative: if group can't be resolved, only admin can see (may be orphaned task)
    if (!group) return authUser.role === 'admin';
    if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) return false;
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) return false;
    return true;
  });
  return c.json({ tasks });
});

tasksRoutes.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const validation = TaskCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const {
    group_folder,
    chat_jid,
    prompt,
    schedule_type,
    schedule_value,
    context_mode,
    operation_permission_mode,
    agent_runtime_override,
    execution_environment,
    execution_type,
    script_command,
    skill_refs,
  } = validation.data;
  const group = getRegisteredGroup(chat_jid);
  if (!group) return c.json({ error: 'Group not found' }, 404);
  if (group.folder !== group_folder) {
    return c.json(
      { error: 'group_folder does not match chat_jid group folder' },
      400,
    );
  }
  const authUser = c.get('user') as AuthUser;
  if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
    return c.json({ error: 'Group not found' }, 404);
  }
  if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) {
    return c.json(
      { error: 'Insufficient permissions for host execution mode' },
      403,
    );
  }

  const execType = execution_type || 'agent';
  if (execType === 'script' && authUser.role !== 'admin') {
    return c.json(
      { error: 'Only admin can create script tasks' },
      403,
    );
  }
  const normalizedSkillRefs = normalizeTaskSkillRefs(skill_refs);
  const dependencyError = await buildTaskSkillDependencyError(
    normalizedSkillRefs,
    authUser.id,
  );
  if (dependencyError) {
    return c.json(dependencyError, 400);
  }

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  let nextRun: string;
  if (schedule_type === 'cron') {
    nextRun = CronExpressionParser.parse(schedule_value, { tz: TIMEZONE }).next().toISOString() ?? new Date().toISOString();
  } else if (schedule_type === 'interval') {
    nextRun = new Date(Date.now() + parseInt(schedule_value, 10)).toISOString();
  } else {
    // once — use the target time from schedule_value
    nextRun = new Date(schedule_value).toISOString();
  }

  createTask({
    id: taskId,
    group_folder,
    chat_jid,
    prompt: prompt || '',
    schedule_type,
    schedule_value,
    context_mode: context_mode || 'isolated',
    operation_permission_mode: operation_permission_mode || 'default',
    agent_runtime_override: agent_runtime_override ?? null,
    execution_environment: execution_environment || 'local',
    execution_type: execType,
    script_command: script_command ?? null,
    skill_refs: normalizedSkillRefs,
    next_run: nextRun,
    status: 'active',
    created_at: now,
    created_by: authUser.id,
  });

  return c.json({ success: true, taskId });
});

tasksRoutes.patch('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  const group = getRegisteredGroup(existing.chat_jid);
  if (!group) {
    if (authUser.role !== 'admin') return c.json({ error: 'Task not found' }, 404);
  } else {
    if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) {
      return c.json(
        { error: 'Insufficient permissions for host execution mode' },
        403,
      );
    }
  }
  const body = await c.req.json().catch(() => ({}));

  const validation = TaskPatchSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const scriptAdminOnly = isScriptTaskAdminOnlyMutation(
    existing.execution_type,
    validation.data,
  );
  if (scriptAdminOnly && authUser.role !== 'admin') {
    return c.json(
      { error: 'Only admin can create or modify script tasks' },
      403,
    );
  }
  const normalizedSkillRefs = validation.data.skill_refs !== undefined
    ? normalizeTaskSkillRefs(validation.data.skill_refs)
    : undefined;
  if (normalizedSkillRefs !== undefined) {
    const dependencyError = await buildTaskSkillDependencyError(
      normalizedSkillRefs,
      existing.created_by ?? authUser.id,
    );
    if (dependencyError) {
      return c.json(dependencyError, 400);
    }
  }

  updateTask(
    id,
    normalizedSkillRefs !== undefined
      ? { ...validation.data, skill_refs: normalizedSkillRefs }
      : validation.data,
  );

  return c.json({ success: true });
});

tasksRoutes.delete('/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  const group = getRegisteredGroup(existing.chat_jid);
  if (!group) {
    if (authUser.role !== 'admin') return c.json({ error: 'Task not found' }, 404);
  } else {
    if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) {
      return c.json(
        { error: 'Insufficient permissions for host execution mode' },
        403,
      );
    }
  }
  deleteTask(id);
  return c.json({ success: true });
});

tasksRoutes.post('/:id/run-now', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  const group = getRegisteredGroup(existing.chat_jid);
  if (!group) {
    if (authUser.role !== 'admin') return c.json({ error: 'Task not found' }, 404);
  } else {
    if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) {
      return c.json(
        { error: 'Insufficient permissions for host execution mode' },
        403,
      );
    }
  }

  try {
    const triggered = triggerTaskRunNow(id);
    if (!triggered.accepted) {
      return c.json({ error: triggered.error }, 409);
    }
    return c.json({
      success: true,
      mode: triggered.mode,
      queued: triggered.queued,
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to trigger task run',
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

tasksRoutes.get('/:id/logs', authMiddleware, (c) => {
  const id = c.req.param('id');
  const existing = getTaskById(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  const authUser = c.get('user') as AuthUser;
  const group = getRegisteredGroup(existing.chat_jid);
  if (!group) {
    if (authUser.role !== 'admin') return c.json({ error: 'Task not found' }, 404);
  } else {
    if (!canAccessGroup({ id: authUser.id, role: authUser.role }, group)) {
      return c.json({ error: 'Task not found' }, 404);
    }
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(authUser)) {
      return c.json(
        { error: 'Insufficient permissions for host execution mode' },
        403,
      );
    }
  }
  const limitRaw = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.min(Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : 20, 200);
  const logs = getTaskRunLogs(id, limit);
  return c.json({ logs });
});

export default tasksRoutes;
