import crypto from 'node:crypto';

import { TIMEZONE } from './config.js';
import {
  getDecisionItemById,
  getGroupsByOwner,
  getRadarItemByDedupeKey,
  getRadarItemById,
  getRadarUserCustomFeedById,
  getRadarUserItemState,
  getRadarUserSettings,
  getRouterState,
  getUserHomeGroup,
  insertRadarDeliveryLog,
  insertRadarItem,
  listRadarSourceTemplates,
  listRadarUserCustomFeeds,
  listRadarUserItemStates,
  listRadarUserSourceOverrides,
  listUsers,
  setRouterState,
  updateDecisionItemPendingMerge,
  updateRadarItemMerge,
  updateRadarUserCustomFeed,
  upsertRadarUserItemState,
} from './db.js';
import { ingestDecisionItem } from './decision-core.js';
import { parseImChannelFromJid } from './im-channel.js';
import { logger } from './logger.js';
import { generateRadarAiSummary } from './radar-ai.js';
import { canonicalizeRadarUrl, fetchRadarFeedEntries, type RadarFeedEntry } from './radar-feed.js';
import { resolveRadarSubscriptions, type RadarResolvedSubscriptionSource } from './radar-subscriptions.js';
import type {
  RadarDeliveryChannel,
  RadarDigestType,
  RadarItem,
  RadarSourceType,
  RadarUserSettings,
  UserPublic,
} from './types.js';

const RADAR_FETCH_INTERVAL_MS = 30 * 60 * 1000;
const RADAR_DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const RADAR_LOOP_INTERVAL_MS = 60 * 1000;
const RADAR_FAILURE_THRESHOLD = 3;
const RADAR_DAILY_DIGEST_HOUR = 9;
const RADAR_WEEKLY_DIGEST_HOUR = 9;
const RADAR_AI_ENRICH_MAX_CONCURRENCY = 2;

const RADAR_TEMPLATE_FAILURES_KEY = 'radar_template_failure_state';
const RADAR_DAILY_DIGEST_KEY_PREFIX = 'radar_daily_digest_last:';
const RADAR_WEEKLY_DIGEST_KEY_PREFIX = 'radar_weekly_digest_last:';

export interface RadarAutomationDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
}

interface TemplateFailureState {
  count: number;
  last_error_at: string;
  last_error_message: string;
}

type TemplateFailureStateMap = Record<string, TemplateFailureState>;

let radarLoopStarted = false;
let radarLoopRunning = false;
let lastRadarFetchAt = 0;
let lastRadarDigestCheckAt = 0;
let radarAiRunning = 0;
const radarAiQueue: Array<() => Promise<void>> = [];
const radarAiPendingDecisionIds = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function buildTemplateFailureStateKey(
  userId: string,
  templateSourceId: string,
): string {
  return `${userId}::${templateSourceId}`;
}

function readTemplateFailureStateMap(): TemplateFailureStateMap {
  const raw = getRouterState(RADAR_TEMPLATE_FAILURES_KEY);
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const next: TemplateFailureStateMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const obj = value as Record<string, unknown>;
      const countRaw = Number(obj.count ?? 0);
      next[key] = {
        count: Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : 0,
        last_error_at:
          typeof obj.last_error_at === 'string' ? obj.last_error_at : nowIso(),
        last_error_message:
          typeof obj.last_error_message === 'string' ? obj.last_error_message : '',
      };
    }
    return next;
  } catch {
    return {};
  }
}

function writeTemplateFailureStateMap(state: TemplateFailureStateMap): void {
  setRouterState(RADAR_TEMPLATE_FAILURES_KEY, JSON.stringify(state));
}

function toLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toLocalHour(date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return Number.parseInt(formatted, 10);
}

function toLocalWeekday(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  }).format(date);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function buildRadarItemScore(
  sourceType: RadarSourceType,
  publishedAt: string | null,
): number {
  let score = 0;
  if (sourceType === 'github_trending' || sourceType === 'producthunt') {
    score += 2;
  } else if (sourceType === 'hn' || sourceType === 'reddit') {
    score += 1;
  }

  if (!publishedAt) return score;
  const now = Date.now();
  const ts = new Date(publishedAt).getTime();
  if (Number.isNaN(ts)) return score;
  const delta = now - ts;
  if (delta <= 24 * 60 * 60 * 1000) score += 3;
  else if (delta <= 7 * 24 * 60 * 60 * 1000) score += 1;

  return score;
}

function sanitizeSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return truncate(normalized, 1200);
}

function detectContentLanguage(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';
  const hasChinese = /[\u4e00-\u9fff]/.test(trimmed);
  const hasLatin = /[A-Za-z]/.test(trimmed);
  if (hasChinese && hasLatin) return 'mixed';
  if (hasChinese) return 'zh';
  if (hasLatin) return 'en';
  return 'unknown';
}

function buildFallbackAiSummary(title: string, summary: string): string {
  const normalizedTitle = title.trim();
  const normalizedSummary = sanitizeSummary(summary);
  if (!normalizedSummary) return truncate(normalizedTitle, 240);

  // Lightweight summarization fallback: compress to one concise paragraph.
  const compact = normalizedSummary
    .split(/[.!?。！？]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 2)
    .join('；');

  if (!compact) return truncate(normalizedTitle, 240);
  return truncate(`${normalizedTitle}：${compact}`, 300);
}

function parseEvidenceObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function serializeEvidenceObject(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function drainRadarAiQueue(): void {
  while (
    radarAiRunning < RADAR_AI_ENRICH_MAX_CONCURRENCY
    && radarAiQueue.length > 0
  ) {
    const next = radarAiQueue.shift();
    if (!next) break;
    radarAiRunning += 1;
    void next()
      .catch((err) => {
        logger.debug({ err }, 'Radar AI enrich job failed');
      })
      .finally(() => {
        radarAiRunning = Math.max(0, radarAiRunning - 1);
        drainRadarAiQueue();
      });
  }
}

function enqueueRadarAiEnrich(job: () => Promise<void>): void {
  radarAiQueue.push(job);
  drainRadarAiQueue();
}

async function enrichDecisionItemWithAiSummary(
  userId: string,
  decisionItemId: string,
  source: RadarResolvedSubscriptionSource,
  item: RadarItem,
  settings: RadarUserSettings,
): Promise<void> {
  if (!settings.ai_summary_enabled) return;
  if (radarAiPendingDecisionIds.has(decisionItemId)) return;
  radarAiPendingDecisionIds.add(decisionItemId);

  enqueueRadarAiEnrich(async () => {
    try {
      const decision = getDecisionItemById(decisionItemId);
      if (!decision || decision.status !== 'pending') return;

      const evidence = parseEvidenceObject(decision.evidence) ?? {};
      const existingAiSummary = typeof evidence.ai_summary === 'string'
        ? evidence.ai_summary.trim()
        : '';
      if (existingAiSummary) return;

      const sourceLanguage = detectContentLanguage(`${item.title}\n${item.summary}`);
      const translateToChinese = settings.auto_translate_zh
        && sourceLanguage === 'en';
      const aiSummary = await generateRadarAiSummary(
        {
          title: item.title,
          summary: item.summary,
          url: item.url,
        },
        { translateToChinese },
      );
      const fallbackSummary = buildFallbackAiSummary(item.title, item.summary);
      const summary = (aiSummary || fallbackSummary).trim();
      if (!summary) return;

      const nextEvidence: Record<string, unknown> = {
        ...evidence,
        source_id: source.id,
        source_name: source.name,
        source_url: source.url,
        item_url: item.url,
        item_published_at: item.published_at,
        content_language: sourceLanguage,
        ai_summary: summary,
        ai_summary_generated_at: nowIso(),
        ai_summary_translated: translateToChinese,
      };

      updateDecisionItemPendingMerge(decision.id, {
        title: decision.title,
        summary: decision.summary,
        priority: decision.priority,
        source_run_id: decision.source_run_id,
        evidence: serializeEvidenceObject(nextEvidence),
        suggested_todo_title: decision.suggested_todo_title,
        suggested_todo_description: truncate(`${summary}\n\n${item.url}`, 3500),
        suggested_todo_priority: decision.suggested_todo_priority,
        updated_at: nowIso(),
      });
    } catch (err) {
      logger.debug(
        { err, decisionItemId, userId },
        'Failed to enrich radar decision with AI summary',
      );
    } finally {
      radarAiPendingDecisionIds.delete(decisionItemId);
    }
  });
}

function buildDecisionSummary(entry: RadarFeedEntry): string {
  const summary = sanitizeSummary(entry.summary);
  if (!summary) return entry.url;
  return truncate(`${summary}\n\n${entry.url}`, 4000);
}

function getPrimaryImDestination(userId: string): string | null {
  const groups = getGroupsByOwner(userId);
  const imJid = groups
    .map((group) => group.jid)
    .find((jid) => parseImChannelFromJid(jid) !== null);
  return imJid ?? null;
}

async function sendRadarNotification(
  deps: RadarAutomationDeps,
  userId: string,
  digestType: RadarDigestType,
  text: string,
): Promise<void> {
  const homeGroup = getUserHomeGroup(userId);
  if (!homeGroup) return;

  const destinations: Array<{ jid: string; channel: RadarDeliveryChannel }> = [
    { jid: homeGroup.jid, channel: 'workbench' },
  ];

  const primaryIm = getPrimaryImDestination(userId);
  if (primaryIm) {
    const channel = parseImChannelFromJid(primaryIm);
    if (channel === 'feishu' || channel === 'telegram') {
      destinations.push({ jid: primaryIm, channel });
    }
  }

  for (const destination of destinations) {
    await deps.sendMessage(destination.jid, text);
    insertRadarDeliveryLog({
      id: crypto.randomUUID(),
      user_id: userId,
      digest_type: digestType,
      channel: destination.channel,
      status: 'ok',
      error: null,
      created_at: nowIso(),
    });
  }
}

function ensureUserItemState(
  userId: string,
  source: RadarResolvedSubscriptionSource,
  item: RadarItem,
  runAtIso: string,
  settings: RadarUserSettings,
): void {
  const existingState = getRadarUserItemState(userId, item.id);
  if (existingState) return;

  const title = truncate(item.title, 200);
  const summary = truncate(item.summary, 3500);
  const contentLanguage = detectContentLanguage(`${item.title}\n${item.summary}`);
  const decisionResult = ingestDecisionItem(
    {
      title: `[Radar] ${title}`,
      summary: buildDecisionSummary({
        title: item.title,
        url: item.url,
        summary,
        publishedAt: item.published_at,
        raw: {},
      }),
      source_type: 'automation',
      source_id: `radar:${source.id}`,
      source_run_id: runAtIso,
      evidence: {
        radar_item_id: item.id,
        source_id: source.id,
        source_name: source.name,
        source_url: source.url,
        item_url: item.url,
        item_published_at: item.published_at,
        content_language: contentLanguage,
      },
      suggested_todo: {
        title,
        description: summary || item.url,
        priority: 'medium',
      },
    },
    userId,
  );

  upsertRadarUserItemState({
    user_id: userId,
    item_id: item.id,
    state: 'tracking',
    todo_id: null,
    decision_item_id: decisionResult.decision_item_id,
    acted_at: runAtIso,
  });

  void enrichDecisionItemWithAiSummary(
    userId,
    decisionResult.decision_item_id,
    source,
    item,
    settings,
  );
}

function upsertRadarEntry(
  source: RadarResolvedSubscriptionSource,
  entry: RadarFeedEntry,
): RadarItem | null {
  const canonicalUrl = canonicalizeRadarUrl(entry.url);
  if (!canonicalUrl) return null;

  const dedupeKey = canonicalUrl;
  const current = getRadarItemByDedupeKey(dedupeKey);
  const score = buildRadarItemScore(source.source_type, entry.publishedAt);
  const summary = sanitizeSummary(entry.summary);

  if (!current) {
    const item: RadarItem = {
      id: crypto.randomUUID(),
      source_type: source.source_type,
      source_ref: source.id,
      title: truncate(entry.title.trim() || canonicalUrl, 500),
      url: canonicalUrl,
      summary,
      published_at: entry.publishedAt,
      score,
      dedupe_key: dedupeKey,
      raw_meta: JSON.stringify(entry.raw),
      created_at: nowIso(),
    };
    insertRadarItem(item);
    return item;
  }

  updateRadarItemMerge(current.id, {
    source_type: source.source_type,
    source_ref: source.id,
    title: truncate(entry.title.trim() || current.title, 500),
    url: canonicalUrl,
    summary: summary || current.summary,
    published_at: entry.publishedAt ?? current.published_at,
    score: Math.max(current.score, score),
    raw_meta: JSON.stringify(entry.raw),
  });
  return getRadarItemById(current.id) ?? current;
}

async function notifySourceFailure(
  deps: RadarAutomationDeps,
  user: UserPublic,
  source: RadarResolvedSubscriptionSource,
  errorMessage: string,
): Promise<void> {
  ingestDecisionItem(
    {
      title: `[Radar Alert] ${source.name}`,
      summary: truncate(`Source failed ${RADAR_FAILURE_THRESHOLD}+ times.\n${source.url}\n${errorMessage}`, 3800),
      source_type: 'automation',
      source_id: `radar:alert:${source.id}`,
      source_run_id: nowIso(),
      evidence: {
        source_id: source.id,
        source_name: source.name,
        source_url: source.url,
        failure_threshold: RADAR_FAILURE_THRESHOLD,
        error: errorMessage,
      },
      suggested_todo: {
        title: `Fix radar source: ${truncate(source.name, 120)}`,
        description: truncate(`${source.url}\n${errorMessage}`, 1000),
        priority: 'high',
      },
    },
    user.id,
  );

  await sendRadarNotification(
    deps,
    user.id,
    'failure_alert',
    `[Radar] Source failed ${RADAR_FAILURE_THRESHOLD}+ times\n${source.name}\n${source.url}\n${truncate(errorMessage, 300)}`,
  );
}

function getActiveUsers(): UserPublic[] {
  let page = 1;
  const users: UserPublic[] = [];
  while (true) {
    const result = listUsers({ status: 'active', page, pageSize: 200 });
    users.push(...result.users);
    if (users.length >= result.total) break;
    page += 1;
  }
  return users;
}

async function collectForUser(
  deps: RadarAutomationDeps,
  user: UserPublic,
  runAtIso: string,
  templateFailureMap: TemplateFailureStateMap,
): Promise<void> {
  const templates = listRadarSourceTemplates();
  const overrides = listRadarUserSourceOverrides(user.id);
  const settings = getRadarUserSettings(user.id);
  const customFeeds = listRadarUserCustomFeeds(user.id);
  const sources = resolveRadarSubscriptions(templates, overrides, customFeeds)
    .filter((source) => source.enabled);

  for (const source of sources) {
    try {
      const entries = await fetchRadarFeedEntries(source.url);
      const cappedEntries = entries.slice(0, 20);
      for (const entry of cappedEntries) {
        const item = upsertRadarEntry(source, entry);
        if (!item) continue;
        ensureUserItemState(user.id, source, item, runAtIso, settings);
      }

      if (source.origin === 'custom') {
        const feedId = source.id.replace(/^feed:/, '');
        const feed = getRadarUserCustomFeedById(user.id, feedId);
        if (feed && feed.consecutive_failures > 0) {
          updateRadarUserCustomFeed(user.id, feedId, {
            consecutive_failures: 0,
            last_success_at: runAtIso,
            last_error_at: null,
            last_error_message: null,
            updated_at: runAtIso,
          });
        }
      } else {
        const stateKey = buildTemplateFailureStateKey(user.id, source.id);
        if (templateFailureMap[stateKey]) {
          delete templateFailureMap[stateKey];
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { userId: user.id, sourceId: source.id, err: errorMessage },
        'Radar source fetch failed',
      );

      if (source.origin === 'custom') {
        const feedId = source.id.replace(/^feed:/, '');
        const feed = getRadarUserCustomFeedById(user.id, feedId);
        const previousFailures = feed?.consecutive_failures ?? 0;
        const nextFailures = previousFailures + 1;

        if (feed) {
          updateRadarUserCustomFeed(user.id, feedId, {
            consecutive_failures: nextFailures,
            last_error_at: runAtIso,
            last_error_message: truncate(errorMessage, 1000),
            updated_at: runAtIso,
          });
        }

        if (previousFailures < RADAR_FAILURE_THRESHOLD && nextFailures >= RADAR_FAILURE_THRESHOLD) {
          await notifySourceFailure(deps, user, source, errorMessage);
        }
      } else {
        const stateKey = buildTemplateFailureStateKey(user.id, source.id);
        const previousFailures = templateFailureMap[stateKey]?.count ?? 0;
        const nextFailures = previousFailures + 1;
        templateFailureMap[stateKey] = {
          count: nextFailures,
          last_error_at: runAtIso,
          last_error_message: truncate(errorMessage, 1000),
        };
        if (previousFailures < RADAR_FAILURE_THRESHOLD && nextFailures >= RADAR_FAILURE_THRESHOLD) {
          await notifySourceFailure(deps, user, source, errorMessage);
        }
      }
    }
  }
}

function buildDigestMessage(
  digestType: Exclude<RadarDigestType, 'failure_alert'>,
  items: RadarItem[],
  dateLabel: string,
): string {
  const title = digestType === 'daily' ? '[Radar Daily Digest]' : '[Radar Weekly Digest]';
  const lines = items.slice(0, digestType === 'daily' ? 5 : 10).map((item, index) => {
    const published = item.published_at ? item.published_at.slice(0, 16).replace('T', ' ') : 'n/a';
    return `${index + 1}. ${truncate(item.title, 120)}\n   ${item.url}\n   published: ${published}`;
  });
  return `${title} ${dateLabel}\n\n${lines.join('\n\n')}`;
}

async function maybeSendDigestForUser(
  deps: RadarAutomationDeps,
  user: UserPublic,
  digestType: Exclude<RadarDigestType, 'failure_alert'>,
  now: Date,
): Promise<void> {
  const localDate = toLocalDateString(now);
  const keyPrefix =
    digestType === 'daily'
      ? RADAR_DAILY_DIGEST_KEY_PREFIX
      : RADAR_WEEKLY_DIGEST_KEY_PREFIX;
  const stateKey = `${keyPrefix}${user.id}`;
  const lastSent = getRouterState(stateKey);
  if (lastSent === localDate) return;

  const lookbackMs = digestType === 'daily'
    ? 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(now.getTime() - lookbackMs).toISOString();
  const states = listRadarUserItemStates(user.id, {
    state: 'tracking',
    acted_after: sinceIso,
    limit: digestType === 'daily' ? 20 : 60,
  });

  if (states.length === 0) {
    setRouterState(stateKey, localDate);
    return;
  }

  const items: RadarItem[] = [];
  for (const state of states) {
    const item = getRadarItemById(state.item_id);
    if (!item) continue;
    items.push(item);
  }
  if (items.length === 0) {
    setRouterState(stateKey, localDate);
    return;
  }

  await sendRadarNotification(
    deps,
    user.id,
    digestType,
    buildDigestMessage(digestType, items, localDate),
  );
  setRouterState(stateKey, localDate);
}

async function runRadarFetch(deps: RadarAutomationDeps): Promise<void> {
  const users = getActiveUsers();
  const runAtIso = nowIso();
  const templateFailureMap = readTemplateFailureStateMap();

  for (const user of users) {
    await collectForUser(deps, user, runAtIso, templateFailureMap);
  }

  writeTemplateFailureStateMap(templateFailureMap);
}

async function runRadarDigestsIfNeeded(deps: RadarAutomationDeps): Promise<void> {
  const now = new Date();
  const localHour = toLocalHour(now);
  const localWeekday = toLocalWeekday(now);

  const users = getActiveUsers();

  if (localHour === RADAR_DAILY_DIGEST_HOUR) {
    for (const user of users) {
      await maybeSendDigestForUser(deps, user, 'daily', now);
    }
  }

  if (localHour === RADAR_WEEKLY_DIGEST_HOUR && localWeekday === 'Mon') {
    for (const user of users) {
      await maybeSendDigestForUser(deps, user, 'weekly', now);
    }
  }
}

async function radarTick(deps: RadarAutomationDeps): Promise<void> {
  if (radarLoopRunning) return;
  radarLoopRunning = true;

  try {
    const now = Date.now();
    if (now - lastRadarFetchAt >= RADAR_FETCH_INTERVAL_MS) {
      await runRadarFetch(deps);
      lastRadarFetchAt = now;
    }

    if (now - lastRadarDigestCheckAt >= RADAR_DIGEST_CHECK_INTERVAL_MS) {
      await runRadarDigestsIfNeeded(deps);
      lastRadarDigestCheckAt = now;
    }
  } catch (err) {
    logger.error({ err }, 'Radar automation tick failed');
  } finally {
    radarLoopRunning = false;
  }
}

export function startRadarAutomationLoop(deps: RadarAutomationDeps): void {
  if (radarLoopStarted) {
    logger.debug('Radar automation loop already running, skipping duplicate start');
    return;
  }
  radarLoopStarted = true;

  logger.info('Radar automation loop started');
  void radarTick(deps);
  setInterval(() => {
    void radarTick(deps);
  }, RADAR_LOOP_INTERVAL_MS);
}
