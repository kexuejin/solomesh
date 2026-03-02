import { Hono } from 'hono';

import {
  canAccessGroup,
  hasHostExecutionPermission,
  isHostExecutionGroup,
  type Variables,
} from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { TodoIngestSchema, TodoMetricsQuerySchema, TodoQuerySchema } from '../schemas.js';
import {
  getAllRegisteredGroups,
  getAllTasks,
  getDecisionItemById,
  getTodoIngestMetrics,
  getTodoById,
  getRegisteredGroup,
  listTodoSourceEvents,
  listTodos,
} from '../db.js';
import { ingestTodo } from '../todo-core.js';
import type { AuthUser, DecisionItem, Todo, TodoSourceEvent } from '../types.js';

const todosRoutes = new Hono<{ Variables: Variables }>();

function resolveAccessibleWorkspaceFolders(user: AuthUser): Set<string> {
  const registeredGroups = getAllRegisteredGroups();
  const folders = new Set<string>();
  for (const [jid, group] of Object.entries(registeredGroups)) {
    const groupWithJid = { ...group, jid };
    if (!canAccessGroup({ id: user.id, role: user.role }, groupWithJid)) {
      continue;
    }
    if (isHostExecutionGroup(groupWithJid) && !hasHostExecutionPermission(user)) {
      continue;
    }
    folders.add(group.folder);
  }
  return folders;
}

function resolveAccessibleTaskIds(user: AuthUser): Set<string> {
  const taskIds = new Set<string>();
  const tasks = getAllTasks();
  for (const task of tasks) {
    const group = getRegisteredGroup(task.chat_jid);
    // Keep behavior aligned with tasks route: only admin can see orphan tasks.
    if (!group) {
      if (user.role === 'admin') taskIds.add(task.id);
      continue;
    }
    if (!canAccessGroup({ id: user.id, role: user.role }, group)) {
      continue;
    }
    if (isHostExecutionGroup(group) && !hasHostExecutionPermission(user)) {
      continue;
    }
    taskIds.add(task.id);
  }
  return taskIds;
}

function canAccessDecisionItem(
  user: AuthUser,
  item: Pick<DecisionItem, 'scope_level' | 'scope_id' | 'created_by'>,
  accessibleFolders: Set<string>,
): boolean {
  if (item.scope_level === 'workspace') {
    return typeof item.scope_id === 'string' && accessibleFolders.has(item.scope_id);
  }
  if (user.role === 'admin') return true;
  return item.created_by === user.id;
}

function extractDecisionItemIdFromEventEvidence(evidence: string | null): string | null {
  if (!evidence) return null;
  try {
    const parsed = JSON.parse(evidence) as {
      evidence?: {
        decision_item_id?: string;
      };
    };
    const decisionId = parsed?.evidence?.decision_item_id;
    return typeof decisionId === 'string' && decisionId.trim().length > 0
      ? decisionId
      : null;
  } catch {
    return null;
  }
}

function canAccessTodoBySourceEvents(
  user: AuthUser,
  todo: Pick<Todo, 'created_by'>,
  events: TodoSourceEvent[],
  accessibleTaskIds: Set<string>,
  accessibleFolders: Set<string>,
  decisionScopeCache: Map<
    string,
    Pick<DecisionItem, 'scope_level' | 'scope_id' | 'created_by'> | null
  >,
): boolean {
  if (user.role === 'admin') return true;
  if (todo.created_by === user.id) return true;

  for (const event of events) {
    if (event.source_type === 'manual' && event.source_id === `user:${user.id}`) {
      return true;
    }
    if (event.source_type === 'automation' && accessibleTaskIds.has(event.source_id)) {
      return true;
    }

    const decisionItemId = extractDecisionItemIdFromEventEvidence(event.evidence);
    if (!decisionItemId) continue;

    let decisionScope = decisionScopeCache.get(decisionItemId);
    if (decisionScope === undefined) {
      const item = getDecisionItemById(decisionItemId);
      decisionScope = item
        ? {
            scope_level: item.scope_level,
            scope_id: item.scope_id,
            created_by: item.created_by,
          }
        : null;
      decisionScopeCache.set(decisionItemId, decisionScope);
    }

    if (decisionScope && canAccessDecisionItem(user, decisionScope, accessibleFolders)) {
      return true;
    }
  }

  return false;
}

todosRoutes.post('/ingest', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = TodoIngestSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const result = ingestTodo(validation.data, authUser.id);
  return c.json(result);
});

todosRoutes.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const authUser = c.get('user') as AuthUser;

  const payload = {
    ...body,
    source_type: body.source_type ?? 'manual',
    source_id: body.source_id ?? `user:${authUser.id}`,
    trigger_mode: body.trigger_mode ?? 'manual',
  };

  const validation = TodoIngestSchema.safeParse(payload);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const result = ingestTodo(validation.data, authUser.id);
  return c.json(result);
});

todosRoutes.get('/', authMiddleware, (c) => {
  const validation = TodoQuerySchema.safeParse(c.req.query());
  if (!validation.success) {
    return c.json(
      { error: 'Invalid query', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const queriedTodos = listTodos(validation.data);
  const last = queriedTodos[queriedTodos.length - 1];

  // Admin keeps full visibility. Non-admin is constrained to own/accessible source events.
  const todos =
    authUser.role === 'admin'
      ? queriedTodos
      : (() => {
          const accessibleFolders = resolveAccessibleWorkspaceFolders(authUser);
          const accessibleTaskIds = resolveAccessibleTaskIds(authUser);
          const decisionScopeCache = new Map<
            string,
            Pick<DecisionItem, 'scope_level' | 'scope_id' | 'created_by'> | null
          >();
          return queriedTodos.filter((todo) =>
            canAccessTodoBySourceEvents(
              authUser,
              todo,
              listTodoSourceEvents(todo.id),
              accessibleTaskIds,
              accessibleFolders,
              decisionScopeCache,
            ),
          );
        })();

  return c.json({
    todos,
    nextCursor: last ? `${last.last_seen_at}|${last.id}` : null,
  });
});

todosRoutes.get('/metrics', authMiddleware, (c) => {
  const validation = TodoMetricsQuerySchema.safeParse(c.req.query());
  if (!validation.success) {
    return c.json(
      { error: 'Invalid query', details: validation.error.format() },
      400,
    );
  }

  const metrics = getTodoIngestMetrics(validation.data);
  return c.json({ metrics });
});

todosRoutes.get('/:id/events', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const todoId = c.req.param('id');
  const todo = getTodoById(todoId);
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  const events = listTodoSourceEvents(todoId);
  if (authUser.role !== 'admin') {
    const accessibleFolders = resolveAccessibleWorkspaceFolders(authUser);
    const accessibleTaskIds = resolveAccessibleTaskIds(authUser);
    const decisionScopeCache = new Map<
      string,
      Pick<DecisionItem, 'scope_level' | 'scope_id' | 'created_by'> | null
    >();
    if (
      !canAccessTodoBySourceEvents(
        authUser,
        todo,
        events,
        accessibleTaskIds,
        accessibleFolders,
        decisionScopeCache,
      )
    ) {
      // Keep response non-leaking and aligned with other resource routes.
      return c.json({ error: 'Todo not found' }, 404);
    }
  }

  return c.json({ events });
});

export default todosRoutes;
