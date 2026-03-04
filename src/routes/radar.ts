import crypto from 'node:crypto';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth.js';
import {
  createRadarUserCustomFeed,
  deleteRadarUserCustomFeed,
  getRadarItemById,
  getRadarSourceTemplateById,
  getRadarUserCustomFeedById,
  getRadarUserItemState,
  getRadarUserSourceOverride,
  listRadarDeliveryLogs,
  listRadarSourceTemplates,
  listRadarUserItemStates,
  listRadarUserCustomFeeds,
  listRadarUserSourceOverrides,
  updateRadarUserCustomFeed,
  upsertRadarUserItemState,
  updateRadarUserSourceOverride,
} from '../db.js';
import {
  RadarCustomFeedCreateSchema,
  RadarCustomFeedUpdateSchema,
  RadarItemActionSchema,
  RadarTemplateOverrideUpdateSchema,
} from '../schemas.js';
import { resolveRadarSubscriptions } from '../radar-subscriptions.js';
import { ingestTodo } from '../todo-core.js';
import type { AuthUser, RadarUserCustomFeed, RadarUserSourceOverride } from '../types.js';
import type { Variables } from '../web-context.js';

const radarRoutes = new Hono<{ Variables: Variables }>();

function normalizeList(values: string[] | undefined): string[] {
  if (!values) return [];
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

radarRoutes.get('/subscriptions', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const templates = listRadarSourceTemplates();
  const overrides = listRadarUserSourceOverrides(authUser.id);
  const customFeeds = listRadarUserCustomFeeds(authUser.id);
  const resolved = resolveRadarSubscriptions(templates, overrides, customFeeds);

  return c.json({
    templates,
    overrides,
    customFeeds,
    resolved,
  });
});

radarRoutes.put('/subscriptions/templates/:id', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RadarTemplateOverrideUpdateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const templateId = c.req.param('id');
  const template = getRadarSourceTemplateById(templateId);
  if (!template || !template.active) {
    return c.json({ error: 'Radar source template not found' }, 404);
  }

  const now = new Date().toISOString();
  const existing = getRadarUserSourceOverride(authUser.id, templateId);
  const next: RadarUserSourceOverride = {
    user_id: authUser.id,
    template_id: templateId,
    enabled_override:
      validation.data.enabled_override !== undefined
        ? validation.data.enabled_override
        : (existing?.enabled_override ?? null),
    cadence_override:
      validation.data.cadence_override !== undefined
        ? validation.data.cadence_override
        : (existing?.cadence_override ?? null),
    include_keywords:
      validation.data.include_keywords !== undefined
        ? normalizeList(validation.data.include_keywords)
        : (existing?.include_keywords ?? []),
    exclude_keywords:
      validation.data.exclude_keywords !== undefined
        ? normalizeList(validation.data.exclude_keywords)
        : (existing?.exclude_keywords ?? []),
    updated_at: now,
  };

  updateRadarUserSourceOverride(next);

  return c.json({
    override: next,
    template,
  });
});

radarRoutes.post('/subscriptions/feeds', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RadarCustomFeedCreateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const now = new Date().toISOString();
  const feed: RadarUserCustomFeed = {
    id: crypto.randomUUID(),
    user_id: authUser.id,
    name: validation.data.name,
    rss_url: validation.data.rss_url,
    enabled: validation.data.enabled ?? true,
    cadence: validation.data.cadence ?? 'both',
    tags: normalizeList(validation.data.tags),
    include_keywords: normalizeList(validation.data.include_keywords),
    exclude_keywords: normalizeList(validation.data.exclude_keywords),
    consecutive_failures: 0,
    last_success_at: null,
    last_error_at: null,
    last_error_message: null,
    created_at: now,
    updated_at: now,
  };

  createRadarUserCustomFeed(feed);
  return c.json({ feed }, 201);
});

radarRoutes.patch('/subscriptions/feeds/:id', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RadarCustomFeedUpdateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const feedId = c.req.param('id');
  const existing = getRadarUserCustomFeedById(authUser.id, feedId);
  if (!existing) {
    return c.json({ error: 'Radar custom feed not found' }, 404);
  }

  const nextPatch = {
    name: validation.data.name,
    rss_url: validation.data.rss_url,
    enabled: validation.data.enabled,
    cadence: validation.data.cadence,
    tags:
      validation.data.tags !== undefined
        ? normalizeList(validation.data.tags)
        : undefined,
    include_keywords:
      validation.data.include_keywords !== undefined
        ? normalizeList(validation.data.include_keywords)
        : undefined,
    exclude_keywords:
      validation.data.exclude_keywords !== undefined
        ? normalizeList(validation.data.exclude_keywords)
        : undefined,
    updated_at: new Date().toISOString(),
  };

  const updated = updateRadarUserCustomFeed(authUser.id, feedId, nextPatch);
  if (!updated) {
    return c.json({ error: 'Radar custom feed not found' }, 404);
  }

  const feed = getRadarUserCustomFeedById(authUser.id, feedId);
  if (!feed) {
    return c.json({ error: 'Radar custom feed not found' }, 404);
  }

  return c.json({ feed });
});

radarRoutes.delete('/subscriptions/feeds/:id', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const feedId = c.req.param('id');
  const deleted = deleteRadarUserCustomFeed(authUser.id, feedId);
  if (!deleted) {
    return c.json({ error: 'Radar custom feed not found' }, 404);
  }
  return c.json({ ok: true });
});

radarRoutes.get('/items', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const state = (c.req.query('state') || 'tracking').trim();
  const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, 200))
    : 50;

  const states = listRadarUserItemStates(authUser.id, {
    state:
      state === 'tracking' || state === 'ignored' || state === 'promoted'
        ? state
        : undefined,
    limit,
  });

  const items = states
    .map((entry) => {
      const item = getRadarItemById(entry.item_id);
      if (!item) return null;
      return {
        item,
        state: entry,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return c.json({
    items,
    nextCursor: null,
  });
});

radarRoutes.post('/items/:id/actions', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RadarItemActionSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const itemId = c.req.param('id');
  const item = getRadarItemById(itemId);
  if (!item) {
    return c.json({ error: 'Radar item not found' }, 404);
  }

  const currentState = getRadarUserItemState(authUser.id, itemId);
  if (!currentState) {
    return c.json({ error: 'Radar item not found' }, 404);
  }

  const now = new Date().toISOString();

  if (validation.data.action === 'ignore') {
    upsertRadarUserItemState({
      ...currentState,
      state: 'ignored',
      acted_at: now,
    });
    return c.json({ ok: true, state: 'ignored' });
  }

  if (validation.data.action === 'keep_tracking') {
    upsertRadarUserItemState({
      ...currentState,
      state: 'tracking',
      acted_at: now,
    });
    return c.json({ ok: true, state: 'tracking' });
  }

  const todo = ingestTodo(
    {
      title: validation.data.todo?.title ?? item.title,
      description:
        validation.data.todo?.description
        ?? (item.summary ? `${item.summary}\n\n${item.url}` : item.url),
      priority: validation.data.todo?.priority ?? 'medium',
      source_type: 'automation',
      source_id: `radar:${item.source_ref}`,
      source_run_id: now,
      trigger_mode: 'automation',
      evidence: {
        radar_item_id: item.id,
        radar_url: item.url,
      },
    },
    authUser.id,
  );

  upsertRadarUserItemState({
    ...currentState,
    state: 'promoted',
    todo_id: todo.todo_id,
    acted_at: now,
  });

  return c.json({
    ok: true,
    state: 'promoted',
    todo,
  });
});

radarRoutes.get('/digests/history', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const limitRaw = Number.parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, 200))
    : 50;

  const digestType = c.req.query('digest_type');
  const logs = listRadarDeliveryLogs(authUser.id, {
    digest_type:
      digestType === 'daily'
      || digestType === 'weekly'
      || digestType === 'failure_alert'
        ? digestType
        : undefined,
    limit,
  });

  return c.json({ logs });
});

export default radarRoutes;
