import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, CircleOff, Columns3, ExternalLink, RefreshCw, Sparkles, Rss } from 'lucide-react';

import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { RadarSubscriptionDialog } from '@/components/workbench/RadarSubscriptionDialog';
import { api } from '../api/client';
import { localeForDateTime, useI18n } from '../i18n';
import {
  buildWorkbenchColumns,
  type WorkbenchColumns,
} from '../lib/workbench';
import type { DecisionItem } from '../stores/decision-items';
import type { TodoItem } from '../stores/todos';

interface WorkbenchColumnProps {
  title: string;
  count: number;
  children: ReactNode;
}

interface RadarResolvedSourceMeta {
  id: string;
  name: string;
  tags: string[];
}

interface RadarSubscriptionPayload {
  resolved: RadarResolvedSourceMeta[];
}

interface TrackingDecisionCard {
  item: DecisionItem;
  sourceName: string | null;
  tags: string[];
}

interface RadarDecisionEvidence {
  source_name?: string;
  source_url?: string;
  item_url?: string;
  item_published_at?: string;
  ai_summary?: string;
  content_language?: string;
}

function parseRadarSourceRef(sourceId: string): string | null {
  if (!sourceId.startsWith('radar:')) return null;
  const raw = sourceId.slice('radar:'.length).trim();
  return raw || null;
}

function normalizeTags(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
  }
  return tags;
}

function parseDecisionEvidence(raw: string | null): RadarDecisionEvidence | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as RadarDecisionEvidence;
  } catch {
    return null;
  }
}

function WorkbenchColumn({ title, count, children }: WorkbenchColumnProps) {
  return (
    <section className="flex min-h-[500px] flex-col rounded-xl border border-border/70 bg-card/95 p-3">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">{children}</div>
    </section>
  );
}

type WorkbenchTabKey = keyof WorkbenchColumns;

export function WorkbenchPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkbenchTabKey>('tracking');
  const [radarDialogOpen, setRadarDialogOpen] = useState(false);
  const [decisionItems, setDecisionItems] = useState<DecisionItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [trackingTagFilter, setTrackingTagFilter] = useState<string>('all');
  const [radarSourceMetaMap, setRadarSourceMetaMap] = useState<Record<string, RadarResolvedSourceMeta>>({});
  const [expandedDecisionDetails, setExpandedDecisionDetails] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [decisionRes, todoRes] = await Promise.all([
        api.get<{ items: DecisionItem[] }>('/api/decision-items?status=pending&limit=200'),
        api.get<{ todos: TodoItem[] }>('/api/todos?limit=200'),
      ]);
      setDecisionItems(decisionRes.items);
      setTodos(todoRes.todos);

      const nextRadarMetaMap: Record<string, RadarResolvedSourceMeta> = {};
      try {
        const radarRes = await api.get<RadarSubscriptionPayload>('/api/radar/subscriptions');
        const resolvedSources = Array.isArray(radarRes.resolved) ? radarRes.resolved : [];
        for (const source of resolvedSources) {
          nextRadarMetaMap[source.id] = {
            id: source.id,
            name: source.name,
            tags: normalizeTags(source.tags),
          };
        }
      } catch {
        // Do not block board rendering when radar subscriptions fail to load.
      }
      setRadarSourceMetaMap(nextRadarMetaMap);
      setError(null);
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        const msg = String((err as { message?: unknown }).message ?? '').trim();
        setError(msg || t('workbench.errors.loadFailed'));
      } else {
        setError(t('workbench.errors.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const columns = useMemo<WorkbenchColumns>(
    () => buildWorkbenchColumns(decisionItems, todos),
    [decisionItems, todos],
  );

  const totalCount = useMemo(
    () =>
      columns.triage.length
      + columns.queued.length
      + columns.inProgress.length
      + columns.done.length
      + columns.tracking.length,
    [columns],
  );

  const trackingCards = useMemo<TrackingDecisionCard[]>(
    () =>
      columns.tracking.map((item) => {
        const sourceRef = parseRadarSourceRef(item.source_id);
        if (!sourceRef) {
          return {
            item,
            sourceName: null,
            tags: [],
          };
        }
        const sourceMeta = radarSourceMetaMap[sourceRef];
        return {
          item,
          sourceName: sourceMeta?.name ?? null,
          tags: sourceMeta?.tags ?? [],
        };
      }),
    [columns.tracking, radarSourceMetaMap],
  );

  const trackingTagOptions = useMemo(() => {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const card of trackingCards) {
      for (const tag of card.tags) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags.sort((a, b) => a.localeCompare(b));
  }, [trackingCards]);

  useEffect(() => {
    if (trackingTagFilter === 'all') return;
    const exists = trackingTagOptions.some(
      (tag) => tag.toLowerCase() === trackingTagFilter.toLowerCase(),
    );
    if (!exists) {
      setTrackingTagFilter('all');
    }
  }, [trackingTagFilter, trackingTagOptions]);

  const filteredTrackingCards = useMemo(() => {
    if (trackingTagFilter === 'all') return trackingCards;
    return trackingCards.filter((card) =>
      card.tags.some((tag) => tag.toLowerCase() === trackingTagFilter.toLowerCase()),
    );
  }, [trackingCards, trackingTagFilter]);

  const formatDate = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '-';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return timestamp;
    return parsed.toLocaleString(localeForDateTime(locale), {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDecisionAction = async (
    itemId: string,
    action: 'accept' | 'ignore',
  ) => {
    setActingId(itemId);
    try {
      if (action === 'accept') {
        await api.post(`/api/decision-items/${itemId}/accept`, {});
      } else {
        await api.post(`/api/decision-items/${itemId}/ignore`, {});
      }
      await loadData();
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        const msg = String((err as { message?: unknown }).message ?? '').trim();
        setError(msg || t('workbench.errors.actionFailed'));
      } else {
        setError(t('workbench.errors.actionFailed'));
      }
    } finally {
      setActingId(null);
    }
  };

  const tabConfigs: Array<{
    key: WorkbenchTabKey;
    title: string;
    count: number;
  }> = [
    { key: 'tracking', title: t('workbench.columns.tracking'), count: columns.tracking.length },
    { key: 'triage', title: t('workbench.columns.triage'), count: columns.triage.length },
    { key: 'queued', title: t('workbench.columns.queued'), count: columns.queued.length },
    { key: 'inProgress', title: t('workbench.columns.inProgress'), count: columns.inProgress.length },
    { key: 'done', title: t('workbench.columns.done'), count: columns.done.length },
  ];

  const renderDecisionCard = (item: DecisionItem, withTrackingHint = false) => {
    const pending = actingId === item.id;
    const sourceRef = parseRadarSourceRef(item.source_id);
    const sourceMeta = sourceRef ? radarSourceMetaMap[sourceRef] : null;
    const sourceTags = sourceMeta?.tags ?? [];
    const evidence = parseDecisionEvidence(item.evidence);
    const sourceName = evidence?.source_name || sourceMeta?.name || item.source_type;
    const sourceUrl = evidence?.source_url || null;
    const itemUrl = evidence?.item_url || null;
    const itemPublishedAt = evidence?.item_published_at || null;
    const aiSummary = evidence?.ai_summary || null;
    const contentLanguage = evidence?.content_language || null;
    const detailExpanded = expandedDecisionDetails[item.id] === true;
    return (
      <article key={item.id} className="rounded-lg border border-border bg-background p-3">
        {withTrackingHint && (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-brand-700">
            <Sparkles size={12} />
            <span>{t('workbench.card.trackingHint')}</span>
          </div>
        )}
        <h4 className="mb-1 text-sm font-medium text-foreground">{item.title}</h4>
        {(aiSummary || item.summary) && (
          <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
            {aiSummary || item.summary}
          </p>
        )}
        {sourceTags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {sourceTags.map((tag) => (
              <span
                key={`${item.id}:${tag}`}
                className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <div className="mb-2 text-[11px] text-muted-foreground">
          {t('workbench.card.source')}: {sourceName}
        </div>
        {itemPublishedAt && (
          <div className="mb-2 text-[11px] text-muted-foreground">
            {t('workbench.card.publishedAt')}: {formatDate(itemPublishedAt)}
          </div>
        )}
        {contentLanguage && (
          <div className="mb-2 text-[11px] text-muted-foreground">
            {t('workbench.card.language')}: {contentLanguage}
          </div>
        )}
        <div className="mb-3 text-[11px] text-muted-foreground">
          {t('workbench.card.updatedAt')}: {formatDate(item.created_at)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {itemUrl && (
            <a href={itemUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink size={14} />
                {t('workbench.actions.openSource')}
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setExpandedDecisionDetails((prev) => ({
                ...prev,
                [item.id]: !detailExpanded,
              }));
            }}
          >
            {detailExpanded
              ? t('workbench.actions.hideDetails')
              : t('workbench.actions.viewDetails')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleDecisionAction(item.id, 'accept')}
            disabled={pending}
          >
            <Check size={14} />
            {t('workbench.actions.accept')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleDecisionAction(item.id, 'ignore')}
            disabled={pending}
          >
            <CircleOff size={14} />
            {t('workbench.actions.ignore')}
          </Button>
        </div>
        {detailExpanded && (
          <div className="mt-3 space-y-1 rounded-md border border-border/70 bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
            <div>
              {t('workbench.card.title')}: {item.title}
            </div>
            <div>
              {t('workbench.card.source')}: {sourceName}
            </div>
            {itemPublishedAt && (
              <div>
                {t('workbench.card.publishedAt')}: {formatDate(itemPublishedAt)}
              </div>
            )}
            {(aiSummary || item.summary) && (
              <div>
                {t('workbench.card.aiSummary')}: {aiSummary || item.summary}
              </div>
            )}
            {sourceUrl && (
              <div className="truncate">
                {t('workbench.card.sourceUrl')}: {sourceUrl}
              </div>
            )}
            {itemUrl && (
              <div className="truncate">
                {t('workbench.card.itemUrl')}: {itemUrl}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  const renderTodoCard = (todo: TodoItem) => (
    <article key={todo.id} className="rounded-lg border border-border bg-background p-3">
      <h4 className="mb-1 text-sm font-medium text-foreground">{todo.title}</h4>
      {todo.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{todo.description}</p>
      )}
      <div className="mt-2 text-[11px] text-muted-foreground">
        {t('workbench.card.updatedAt')}: {formatDate(todo.last_seen_at)}
      </div>
    </article>
  );

  const renderTabContent = (tabKey: WorkbenchTabKey) => {
    if (tabKey === 'triage') {
      if (columns.triage.length === 0) {
        return (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {t('workbench.columns.empty')}
          </p>
        );
      }
      return columns.triage.map((item) => renderDecisionCard(item));
    }
    if (tabKey === 'tracking') {
      if (trackingCards.length === 0) {
        return (
          <div className="space-y-2 px-2 py-1">
            <p className="text-xs text-muted-foreground">{t('workbench.columns.empty')}</p>
            <Button size="sm" variant="outline" onClick={() => setRadarDialogOpen(true)}>
              <Rss size={14} />
              {t('workbench.tracking.addSources')}
            </Button>
          </div>
        );
      }

      return (
        <div className="space-y-3">
          {trackingTagOptions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">{t('workbench.tracking.tagsLabel')}</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    trackingTagFilter === 'all'
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/70',
                  )}
                  onClick={() => setTrackingTagFilter('all')}
                >
                  {t('workbench.tracking.allTags')}
                </button>
                {trackingTagOptions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      trackingTagFilter.toLowerCase() === tag.toLowerCase()
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/70',
                    )}
                    onClick={() => setTrackingTagFilter(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredTrackingCards.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              {t('workbench.tracking.emptyFiltered')}
            </p>
          ) : (
            filteredTrackingCards.map((card) => renderDecisionCard(card.item, true))
          )}
        </div>
      );
    }
    if (tabKey === 'queued') {
      if (columns.queued.length === 0) {
        return (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {t('workbench.columns.empty')}
          </p>
        );
      }
      return columns.queued.map((todo) => renderTodoCard(todo));
    }
    if (tabKey === 'inProgress') {
      if (columns.inProgress.length === 0) {
        return (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {t('workbench.columns.empty')}
          </p>
        );
      }
      return columns.inProgress.map((todo) => renderTodoCard(todo));
    }
    if (columns.done.length === 0) {
      return (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {t('workbench.columns.empty')}
        </p>
      );
    }
    return columns.done.map((todo) => renderTodoCard(todo));
  };

  return (
    <div className="min-h-full app-canvas p-4 lg:p-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
        <div className="rounded-xl border border-border/80 bg-card px-5 py-4">
          <PageHeader
            title={t('workbench.page.title')}
            subtitle={t('workbench.page.subtitle', { total: totalCount })}
            className="mb-4"
            actions={(
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setRadarDialogOpen(true)}>
                  <Rss size={16} />
                  {t('workbench.page.manageRadar')}
                </Button>
                <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  {t('workbench.page.refresh')}
                </Button>
              </div>
            )}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <SkeletonCardList count={5} />
        ) : totalCount === 0 ? (
          <EmptyState
            icon={Columns3}
            title={t('workbench.page.emptyTitle')}
            description={t('workbench.page.emptyDescription')}
          />
        ) : (
          <div className="rounded-xl border border-border/80 bg-card px-3 py-3">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as WorkbenchTabKey)}
            >
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/70 p-1">
                {tabConfigs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="flex-none px-3">
                    <span>{tab.title}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {tabConfigs.map((tab) => (
                <TabsContent key={tab.key} value={tab.key} className="mt-3">
                  <WorkbenchColumn title={tab.title} count={tab.count}>
                    {renderTabContent(tab.key)}
                  </WorkbenchColumn>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </div>
      <RadarSubscriptionDialog open={radarDialogOpen} onOpenChange={setRadarDialogOpen} />
    </div>
  );
}
