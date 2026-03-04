import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRadarSubscriptions,
  type RadarResolvedSubscriptionSource,
} from '../src/radar-subscriptions';
import type {
  RadarSourceTemplate,
  RadarUserCustomFeed,
  RadarUserSourceOverride,
} from '../src/types';

function pick(source: RadarResolvedSubscriptionSource) {
  return {
    id: source.id,
    origin: source.origin,
    enabled: source.enabled,
    cadence: source.cadence,
    include: source.include_keywords,
    exclude: source.exclude_keywords,
    name: source.name,
  };
}

test('resolve radar subscriptions merges system defaults, user overrides, and custom feeds', () => {
  const templates: RadarSourceTemplate[] = [
    {
      id: 'tpl-gh',
      name: 'GitHub Trending',
      type: 'github_trending',
      url: 'https://github.com/trending',
      default_enabled: true,
      default_cadence: 'both',
      tags: ['agent'],
      active: true,
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
    },
    {
      id: 'tpl-hn',
      name: 'HN Show',
      type: 'hn',
      url: 'https://news.ycombinator.com/show',
      default_enabled: true,
      default_cadence: 'daily',
      tags: ['launch'],
      active: true,
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
    },
  ];

  const overrides: RadarUserSourceOverride[] = [
    {
      user_id: 'u1',
      template_id: 'tpl-gh',
      enabled_override: false,
      cadence_override: 'weekly',
      include_keywords: ['agent'],
      exclude_keywords: ['audio'],
      updated_at: '2026-03-04T01:00:00.000Z',
    },
  ];

  const customFeeds: RadarUserCustomFeed[] = [
    {
      id: 'feed-1',
      user_id: 'u1',
      name: 'My AI Feed',
      rss_url: 'https://example.com/feed.xml',
      enabled: true,
      cadence: 'daily',
      tags: ['custom'],
      include_keywords: ['copilot'],
      exclude_keywords: [],
      consecutive_failures: 0,
      last_success_at: null,
      last_error_at: null,
      last_error_message: null,
      created_at: '2026-03-04T02:00:00.000Z',
      updated_at: '2026-03-04T02:00:00.000Z',
    },
  ];

  const resolved = resolveRadarSubscriptions(templates, overrides, customFeeds);

  assert.equal(resolved.length, 3);
  assert.deepEqual(pick(resolved[0]), {
    id: 'tpl:tpl-gh',
    origin: 'template',
    enabled: false,
    cadence: 'weekly',
    include: ['agent'],
    exclude: ['audio'],
    name: 'GitHub Trending',
  });
  assert.deepEqual(pick(resolved[1]), {
    id: 'tpl:tpl-hn',
    origin: 'template',
    enabled: true,
    cadence: 'daily',
    include: [],
    exclude: [],
    name: 'HN Show',
  });
  assert.deepEqual(pick(resolved[2]), {
    id: 'feed:feed-1',
    origin: 'custom',
    enabled: true,
    cadence: 'daily',
    include: ['copilot'],
    exclude: [],
    name: 'My AI Feed',
  });
});
