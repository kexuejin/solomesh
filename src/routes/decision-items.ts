import { Hono } from 'hono';

import {
  canAccessGroup,
  hasHostExecutionPermission,
  isHostExecutionGroup,
  type Variables,
} from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { DecisionItemCreateSchema, DecisionItemQuerySchema } from '../schemas.js';
import {
  getAllRegisteredGroups,
  getDecisionItemById,
  listDecisionItems,
} from '../db.js';
import {
  acceptDecisionItem,
  ignoreDecisionItem,
  ingestDecisionItem,
} from '../decision-core.js';
import type { AuthUser, DecisionItem } from '../types.js';

const decisionItemsRoutes = new Hono<{ Variables: Variables }>();

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

decisionItemsRoutes.get('/', authMiddleware, (c) => {
  const validation = DecisionItemQuerySchema.safeParse(c.req.query());
  if (!validation.success) {
    return c.json(
      { error: 'Invalid query', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const accessibleFolders = resolveAccessibleWorkspaceFolders(authUser);
  const items = listDecisionItems(validation.data).filter((item) =>
    canAccessDecisionItem(authUser, item, accessibleFolders),
  );
  const last = items[items.length - 1];
  return c.json({
    items,
    nextCursor: last ? `${last.created_at}|${last.id}` : null,
  });
});

decisionItemsRoutes.post('/ingest', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = DecisionItemCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const result = ingestDecisionItem(validation.data, authUser.id);
  return c.json(result);
});

decisionItemsRoutes.post('/:id/accept', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const item = getDecisionItemById(id);
  if (!item) return c.json({ error: 'Decision item not found' }, 404);
  const accessibleFolders = resolveAccessibleWorkspaceFolders(authUser);
  if (!canAccessDecisionItem(authUser, item, accessibleFolders)) {
    return c.json({ error: 'Decision item not found' }, 404);
  }
  const result = acceptDecisionItem(id, authUser.id);
  if (!result.ok) {
    if (result.error === 'not_found') {
      return c.json({ error: 'Decision item not found' }, 404);
    }
    return c.json(
      {
        error: `Decision item already decided: ${result.currentStatus ?? 'unknown'}`,
      },
      409,
    );
  }
  return c.json(result);
});

decisionItemsRoutes.post('/:id/ignore', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const item = getDecisionItemById(id);
  if (!item) return c.json({ error: 'Decision item not found' }, 404);
  const accessibleFolders = resolveAccessibleWorkspaceFolders(authUser);
  if (!canAccessDecisionItem(authUser, item, accessibleFolders)) {
    return c.json({ error: 'Decision item not found' }, 404);
  }
  const result = ignoreDecisionItem(id, authUser.id);
  if (!result.ok) {
    if (result.error === 'not_found') {
      return c.json({ error: 'Decision item not found' }, 404);
    }
    return c.json(
      {
        error: `Decision item already decided: ${result.currentStatus ?? 'unknown'}`,
      },
      409,
    );
  }
  return c.json(result);
});

export default decisionItemsRoutes;
