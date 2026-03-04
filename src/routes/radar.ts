import crypto from 'node:crypto';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth.js';
import {
  createRadarUserCustomFeed,
  deleteRadarUserCustomFeed,
  getRadarSourceTemplateById,
  getRadarUserCustomFeedById,
  getRadarUserSourceOverride,
  listRadarSourceTemplates,
  listRadarUserCustomFeeds,
  listRadarUserSourceOverrides,
  updateRadarUserCustomFeed,
  updateRadarUserSourceOverride,
} from '../db.js';
import {
  RadarCustomFeedCreateSchema,
  RadarCustomFeedUpdateSchema,
  RadarTemplateOverrideUpdateSchema,
} from '../schemas.js';
import { resolveRadarSubscriptions } from '../radar-subscriptions.js';
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

export default radarRoutes;
