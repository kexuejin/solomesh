import { useEffect, useMemo, useState } from 'react';
import { Check, CircleOff, Lightbulb, RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
import { localeForDateTime, useI18n } from '../i18n';
import {
  type DecisionItem,
  type DecisionItemScopeLevel,
  type DecisionItemStatus,
  useDecisionItemsStore,
} from '../stores/decision-items';

type StatusFilter = 'all' | DecisionItemStatus;
type ScopeFilter = 'all' | DecisionItemScopeLevel;

const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'accepted', 'ignored'];
const SCOPE_FILTERS: ScopeFilter[] = ['all', 'global', 'workspace'];

function parseEvidenceText(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export function DecisionCenterPage() {
  const { t, locale } = useI18n();
  const { items, loading, error, loadItems, acceptItem, ignoreItem } = useDecisionItemsStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    void loadItems({
      status: statusFilter === 'all' ? undefined : statusFilter,
      scope_level: scopeFilter === 'all' ? undefined : scopeFilter,
      scope_id:
        scopeFilter === 'workspace' && workspaceFilter !== 'all'
          ? workspaceFilter
          : undefined,
      source_id: sourceFilter === 'all' ? undefined : sourceFilter,
      limit: 100,
    });
  }, [loadItems, scopeFilter, sourceFilter, statusFilter, workspaceFilter]);

  const counts = useMemo(() => {
    const pending = items.filter((item) => item.status === 'pending').length;
    const accepted = items.filter((item) => item.status === 'accepted').length;
    const ignored = items.filter((item) => item.status === 'ignored').length;
    return {
      total: items.length,
      pending,
      accepted,
      ignored,
    };
  }, [items]);

  const sourceOptions = useMemo(() => {
    const sourceSet = new Set(items.map((item) => item.source_id));
    return [...sourceSet].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const workspaceOptions = useMemo(() => {
    const workspaceSet = new Set(
      items
        .filter((item) => item.scope_level === 'workspace')
        .map((item) => item.scope_id)
        .filter((item): item is string => Boolean(item)),
    );
    return [...workspaceSet].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const groupedBySource = useMemo(() => {
    const groups = new Map<string, DecisionItem[]>();
    for (const item of items) {
      const key = `${item.source_type}:${item.source_id}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, value]) => {
      const first = value[0];
      return {
        key,
        sourceType: first.source_type,
        sourceId: first.source_id,
        items: value,
      };
    });
  }, [items]);

  const formatDate = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '-';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return timestamp;
    return parsed.toLocaleString(localeForDateTime(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleRefresh = async () => {
    await loadItems({
      status: statusFilter === 'all' ? undefined : statusFilter,
      scope_level: scopeFilter === 'all' ? undefined : scopeFilter,
      scope_id:
        scopeFilter === 'workspace' && workspaceFilter !== 'all'
          ? workspaceFilter
          : undefined,
      source_id: sourceFilter === 'all' ? undefined : sourceFilter,
      limit: 100,
    });
  };

  const handleAccept = async (itemId: string) => {
    setActingId(itemId);
    try {
      await acceptItem(itemId);
    } finally {
      setActingId(null);
    }
  };

  const handleIgnore = async (itemId: string) => {
    setActingId(itemId);
    try {
      await ignoreItem(itemId);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="min-h-full app-canvas p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-xl border border-border/80 bg-card px-5 py-4">
          <PageHeader
            title={t('decisionCenter.page.title')}
            subtitle={t('decisionCenter.page.subtitle', {
              total: counts.total,
              pending: counts.pending,
              accepted: counts.accepted,
              ignored: counts.ignored,
            })}
            className="mb-4"
            actions={
              <Button variant="outline" onClick={() => void handleRefresh()} disabled={loading}>
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                {t('decisionCenter.page.refresh')}
              </Button>
            }
          />

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{t('decisionCenter.page.total')}</div>
              <div className="text-base font-semibold text-foreground">{counts.total}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <div className="text-[11px] text-blue-700">{t('decisionCenter.page.pending')}</div>
              <div className="text-base font-semibold text-blue-700">{counts.pending}</div>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <div className="text-[11px] text-green-700">{t('decisionCenter.page.accepted')}</div>
              <div className="text-base font-semibold text-green-700">{counts.accepted}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-700">{t('decisionCenter.page.ignored')}</div>
              <div className="text-base font-semibold text-amber-700">{counts.ignored}</div>
            </div>
          </div>
        </div>

        <section className="surface-card-soft rounded-xl border border-border/70 bg-card/90 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-border bg-card text-foreground hover:bg-muted/35'
                  }`}
                >
                  {t(`decisionCenter.filters.status.${status}`)}
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              {SCOPE_FILTERS.map((scope) => {
                const active = scopeFilter === scope;
                return (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => {
                      setScopeFilter(scope);
                      if (scope !== 'workspace') {
                        setWorkspaceFilter('all');
                      }
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-border bg-card text-foreground hover:bg-muted/35'
                    }`}
                  >
                    {t(`decisionCenter.filters.scope.${scope}`)}
                  </button>
                );
              })}
            </div>

            {scopeFilter === 'workspace' && (
              <select
                value={workspaceFilter}
                onChange={(event) => setWorkspaceFilter(event.target.value)}
                className="min-w-56 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              >
                <option value="all">{t('decisionCenter.filters.workspaceAll')}</option>
                {workspaceOptions.map((workspaceId) => (
                  <option key={workspaceId} value={workspaceId}>
                    {workspaceId}
                  </option>
                ))}
              </select>
            )}

            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="min-w-56 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              <option value="all">{t('decisionCenter.filters.sourceAll')}</option>
              {sourceOptions.map((sourceId) => (
                <option key={sourceId} value={sourceId}>
                  {sourceId}
                </option>
              ))}
            </select>
          </div>
        </section>

        {error && (
          <div className="surface-card-soft flex items-center justify-between rounded-xl border border-red-200 bg-red-50/85 p-3">
            <span className="text-sm text-red-700">{error}</span>
            <button
              onClick={() => useDecisionItemsStore.setState({ error: null })}
              className="rounded p-1 text-red-400 hover:text-red-600"
              aria-label={t('decisionCenter.page.dismissError')}
              type="button"
            >
              ×
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <SkeletonCardList count={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title={t('decisionCenter.page.emptyTitle')}
            description={t('decisionCenter.page.emptyDescription')}
          />
        ) : (
          <div className="space-y-5">
            {groupedBySource.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    {t(`decisionCenter.sourceType.${group.sourceType}`)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t(`decisionCenter.filters.scope.${group.items[0]?.scope_level ?? 'global'}`)}
                    {group.items[0]?.scope_id ? ` · ${group.items[0].scope_id}` : ''}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{group.sourceId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('decisionCenter.page.groupCount', { count: group.items.length })}
                  </div>
                </div>

                <div className="space-y-3">
                  {group.items.map((item) => {
                    const evidenceText = parseEvidenceText(item.evidence);
                    return (
                      <article key={item.id} className="rounded-xl border border-border/70 bg-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">{item.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {t('decisionCenter.item.createdAt', { value: formatDate(item.created_at) })}
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              item.status === 'pending'
                                ? 'bg-blue-100 text-blue-700'
                                : item.status === 'accepted'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {t(`decisionCenter.filters.status.${item.status}`)}
                          </span>
                        </div>

                        {item.summary && (
                          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{item.summary}</p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{t('decisionCenter.item.priority', { value: item.priority ?? '-' })}</span>
                          {item.accepted_todo_id && (
                            <span>{t('decisionCenter.item.todoId', { value: item.accepted_todo_id })}</span>
                          )}
                        </div>

                        {(item.suggested_todo_title || item.suggested_todo_description) && (
                          <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                            <div className="text-xs font-medium text-brand-700">{t('decisionCenter.item.suggestedTodo')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{item.suggested_todo_title ?? '-'}</div>
                            {item.suggested_todo_description && (
                              <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                                {item.suggested_todo_description}
                              </div>
                            )}
                          </div>
                        )}

                        {evidenceText && (
                          <details className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              {t('decisionCenter.item.evidence')}
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
                              {evidenceText}
                            </pre>
                          </details>
                        )}

                        {item.status === 'pending' && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void handleAccept(item.id)}
                              disabled={actingId === item.id}
                            >
                              <Check size={16} />
                              {t('decisionCenter.actions.accept')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleIgnore(item.id)}
                              disabled={actingId === item.id}
                            >
                              <CircleOff size={16} />
                              {t('decisionCenter.actions.ignore')}
                            </Button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
