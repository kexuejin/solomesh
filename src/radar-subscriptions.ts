import type {
  RadarResolvedSubscriptionSource,
  RadarSourceTemplate,
  RadarUserCustomFeed,
  RadarUserSourceOverride,
} from './types.js';

function toMapByTemplateId(
  overrides: RadarUserSourceOverride[],
): Map<string, RadarUserSourceOverride> {
  const map = new Map<string, RadarUserSourceOverride>();
  for (const item of overrides) {
    map.set(item.template_id, item);
  }
  return map;
}

export function resolveRadarSubscriptions(
  templates: RadarSourceTemplate[],
  overrides: RadarUserSourceOverride[],
  customFeeds: RadarUserCustomFeed[],
): RadarResolvedSubscriptionSource[] {
  const overrideMap = toMapByTemplateId(overrides);
  const resolved: RadarResolvedSubscriptionSource[] = [];

  for (const template of templates) {
    if (!template.active) continue;
    const override = overrideMap.get(template.id);
    resolved.push({
      id: `tpl:${template.id}`,
      origin: 'template',
      template_id: template.id,
      source_type: template.type,
      name: template.name,
      url: template.url,
      enabled: override?.enabled_override ?? template.default_enabled,
      cadence: override?.cadence_override ?? template.default_cadence,
      tags: template.tags,
      include_keywords: override?.include_keywords ?? [],
      exclude_keywords: override?.exclude_keywords ?? [],
    });
  }

  for (const feed of customFeeds) {
    resolved.push({
      id: `feed:${feed.id}`,
      origin: 'custom',
      template_id: null,
      source_type: 'rss',
      name: feed.name,
      url: feed.rss_url,
      enabled: feed.enabled,
      cadence: feed.cadence,
      tags: feed.tags,
      include_keywords: feed.include_keywords,
      exclude_keywords: feed.exclude_keywords,
    });
  }

  return resolved;
}
