import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, CircleOff, Columns3, RefreshCw, Sparkles, Rss } from 'lucide-react';

import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
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

function WorkbenchColumn({ title, count, children }: WorkbenchColumnProps) {
  return (
    <section className="flex min-h-[480px] w-[280px] flex-shrink-0 flex-col rounded-xl border border-border/70 bg-card/95 p-3">
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

export function WorkbenchPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [radarDialogOpen, setRadarDialogOpen] = useState(false);
  const [decisionItems, setDecisionItems] = useState<DecisionItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [decisionRes, todoRes] = await Promise.all([
        api.get<{ items: DecisionItem[] }>('/api/decision-items?status=pending&limit=200'),
        api.get<{ todos: TodoItem[] }>('/api/todos?limit=200'),
      ]);
      setDecisionItems(decisionRes.items);
      setTodos(todoRes.todos);
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
          <div className="flex gap-3 overflow-x-auto pb-2">
            <WorkbenchColumn
              title={t('workbench.columns.triage')}
              count={columns.triage.length}
            >
              {columns.triage.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t('workbench.columns.empty')}
                </p>
              )}
              {columns.triage.map((item) => {
                const pending = actingId === item.id;
                return (
                  <article key={item.id} className="rounded-lg border border-border bg-background p-3">
                    <h4 className="mb-1 text-sm font-medium text-foreground">{item.title}</h4>
                    {item.summary && (
                      <p className="mb-2 line-clamp-3 text-xs text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      {t('workbench.card.source')}: {item.source_type}
                    </div>
                    <div className="mb-3 text-[11px] text-muted-foreground">
                      {t('workbench.card.updatedAt')}: {formatDate(item.created_at)}
                    </div>
                    <div className="flex items-center gap-2">
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
                  </article>
                );
              })}
            </WorkbenchColumn>

            <WorkbenchColumn
              title={t('workbench.columns.queued')}
              count={columns.queued.length}
            >
              {columns.queued.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t('workbench.columns.empty')}
                </p>
              )}
              {columns.queued.map((todo) => (
                <article key={todo.id} className="rounded-lg border border-border bg-background p-3">
                  <h4 className="mb-1 text-sm font-medium text-foreground">{todo.title}</h4>
                  {todo.description && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">{todo.description}</p>
                  )}
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t('workbench.card.updatedAt')}: {formatDate(todo.last_seen_at)}
                  </div>
                </article>
              ))}
            </WorkbenchColumn>

            <WorkbenchColumn
              title={t('workbench.columns.inProgress')}
              count={columns.inProgress.length}
            >
              {columns.inProgress.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t('workbench.columns.empty')}
                </p>
              )}
              {columns.inProgress.map((todo) => (
                <article key={todo.id} className="rounded-lg border border-border bg-background p-3">
                  <h4 className="mb-1 text-sm font-medium text-foreground">{todo.title}</h4>
                  {todo.description && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">{todo.description}</p>
                  )}
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t('workbench.card.updatedAt')}: {formatDate(todo.last_seen_at)}
                  </div>
                </article>
              ))}
            </WorkbenchColumn>

            <WorkbenchColumn title={t('workbench.columns.done')} count={columns.done.length}>
              {columns.done.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t('workbench.columns.empty')}
                </p>
              )}
              {columns.done.map((todo) => (
                <article key={todo.id} className="rounded-lg border border-border bg-background p-3">
                  <h4 className="mb-1 text-sm font-medium text-foreground">{todo.title}</h4>
                  {todo.description && (
                    <p className="line-clamp-3 text-xs text-muted-foreground">{todo.description}</p>
                  )}
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t('workbench.card.updatedAt')}: {formatDate(todo.last_seen_at)}
                  </div>
                </article>
              ))}
            </WorkbenchColumn>

            <WorkbenchColumn
              title={t('workbench.columns.tracking')}
              count={columns.tracking.length}
            >
              {columns.tracking.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {t('workbench.columns.empty')}
                </p>
              )}
              {columns.tracking.map((item) => {
                const pending = actingId === item.id;
                return (
                  <article key={item.id} className="rounded-lg border border-border bg-background p-3">
                    <div className="mb-1 flex items-center gap-1 text-[11px] text-brand-700">
                      <Sparkles size={12} />
                      <span>{t('workbench.card.trackingHint')}</span>
                    </div>
                    <h4 className="mb-1 text-sm font-medium text-foreground">{item.title}</h4>
                    {item.summary && (
                      <p className="mb-2 line-clamp-3 text-xs text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      {t('workbench.card.source')}: {item.source_type}
                    </div>
                    <div className="mb-3 text-[11px] text-muted-foreground">
                      {t('workbench.card.updatedAt')}: {formatDate(item.created_at)}
                    </div>
                    <div className="flex items-center gap-2">
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
                  </article>
                );
              })}
            </WorkbenchColumn>
          </div>
        )}
      </div>
      <RadarSubscriptionDialog open={radarDialogOpen} onOpenChange={setRadarDialogOpen} />
    </div>
  );
}
