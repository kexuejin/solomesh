import { useEffect, useMemo, useState } from 'react';
import { ListChecks, RefreshCw, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { localeForDateTime, useI18n } from '../i18n';
import {
  type TodoIngestAction,
  type TodoItem,
  type TodoPriority,
  type TodoSourceType,
  type TodoStatus,
  type TodoTriggerMode,
  useTodosStore,
} from '../stores/todos';

type StatusFilter = 'all' | TodoStatus;
type PriorityFilter = 'all' | TodoPriority;
type SourceTypeFilter = 'all' | TodoSourceType;
type TriggerModeFilter = 'all' | TodoTriggerMode;

const STATUS_FILTERS: StatusFilter[] = ['all', 'open', 'in_progress', 'done', 'archived'];
const PRIORITY_FILTERS: PriorityFilter[] = ['all', 'critical', 'high', 'medium', 'low'];
const SOURCE_TYPE_FILTERS: SourceTypeFilter[] = ['all', 'automation', 'workflow', 'plugin', 'manual'];
const TRIGGER_MODE_FILTERS: TriggerModeFilter[] = ['all', 'automation', 'manual'];

function todoStatusClass(status: TodoStatus): string {
  if (status === 'open') return 'bg-blue-100 text-blue-700';
  if (status === 'in_progress') return 'bg-amber-100 text-amber-700';
  if (status === 'done') return 'bg-green-100 text-green-700';
  return 'bg-slate-200 text-slate-700';
}

function todoPriorityClass(priority: TodoPriority): string {
  if (priority === 'critical') return 'bg-red-100 text-red-700';
  if (priority === 'high') return 'bg-orange-100 text-orange-700';
  if (priority === 'medium') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
}

function todoEventActionClass(action: TodoIngestAction): string {
  if (action === 'created') return 'bg-green-100 text-green-700';
  if (action === 'merged') return 'bg-blue-100 text-blue-700';
  return 'bg-slate-200 text-slate-700';
}

function parseEvidenceText(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function compareTodos(a: TodoItem, b: TodoItem): number {
  return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
}

export function TodosPage() {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const focusTodoId = searchParams.get('todoId')?.trim() || null;

  const {
    todos,
    nextCursor,
    loading,
    listError,
    eventsByTodo,
    eventsLoadingByTodo,
    eventsErrorByTodo,
    loadTodos,
    loadTodoEvents,
  } = useTodosStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>('all');
  const [triggerModeFilter, setTriggerModeFilter] = useState<TriggerModeFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>(focusTodoId ?? '');
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(focusTodoId);

  const queryFilters = useMemo(
    () => ({
      status: statusFilter === 'all' ? undefined : statusFilter,
      priority: priorityFilter === 'all' ? undefined : priorityFilter,
      source_type: sourceTypeFilter === 'all' ? undefined : sourceTypeFilter,
      trigger_mode: triggerModeFilter === 'all' ? undefined : triggerModeFilter,
      limit: 100,
    }),
    [priorityFilter, sourceTypeFilter, statusFilter, triggerModeFilter],
  );

  useEffect(() => {
    void loadTodos(queryFilters);
  }, [loadTodos, queryFilters]);

  useEffect(() => {
    if (!focusTodoId) return;
    setExpandedTodoId(focusTodoId);
    void loadTodoEvents(focusTodoId);
  }, [focusTodoId, loadTodoEvents]);

  useEffect(() => {
    if (!focusTodoId) return;
    if (loading) return;
    if (todos.some((todo) => todo.id === focusTodoId)) return;
    if (!nextCursor) return;
    void loadTodos(
      {
        ...queryFilters,
        cursor: nextCursor,
      },
      { append: true },
    );
  }, [focusTodoId, loading, loadTodos, nextCursor, queryFilters, todos]);

  const counts = useMemo(() => {
    const open = todos.filter((todo) => todo.status === 'open').length;
    const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
    const done = todos.filter((todo) => todo.status === 'done').length;
    return {
      total: todos.length,
      open,
      inProgress,
      done,
    };
  }, [todos]);

  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  const hasSearchQuery = trimmedSearchQuery.length > 0;

  const filteredTodos = useMemo(() => {
    const sorted = [...todos].sort(compareTodos);
    if (!hasSearchQuery) return sorted;
    return sorted.filter((todo) => {
      const haystack = [
        todo.id,
        todo.title,
        todo.description ?? '',
        todo.dedupe_key,
      ]
        .join('\n')
        .toLowerCase();
      return haystack.includes(trimmedSearchQuery);
    });
  }, [hasSearchQuery, todos, trimmedSearchQuery]);

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
    await loadTodos(queryFilters);
  };

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    await loadTodos(
      {
        ...queryFilters,
        cursor: nextCursor,
      },
      { append: true },
    );
  };

  const handleToggleEvents = async (todoId: string) => {
    setExpandedTodoId((prev) => (prev === todoId ? null : todoId));
    if (!eventsByTodo[todoId]) {
      await loadTodoEvents(todoId);
    }
  };

  return (
    <div className="min-h-full app-canvas p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-xl border border-border/80 bg-card px-5 py-4">
          <PageHeader
            title={t('todos.page.title')}
            subtitle={t('todos.page.subtitle', {
              total: counts.total,
              open: counts.open,
              inProgress: counts.inProgress,
              done: counts.done,
            })}
            className="mb-4"
            actions={
              <Button variant="outline" onClick={() => void handleRefresh()} disabled={loading}>
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                {t('todos.page.refresh')}
              </Button>
            }
          />

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{t('todos.page.total')}</div>
              <div className="text-base font-semibold text-foreground">{counts.total}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <div className="text-[11px] text-blue-700">{t('todos.filters.status.open')}</div>
              <div className="text-base font-semibold text-blue-700">{counts.open}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-700">{t('todos.filters.status.in_progress')}</div>
              <div className="text-base font-semibold text-amber-700">{counts.inProgress}</div>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <div className="text-[11px] text-green-700">{t('todos.filters.status.done')}</div>
              <div className="text-base font-semibold text-green-700">{counts.done}</div>
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
                  {t(`todos.filters.status.${status}`)}
                </button>
              );
            })}

            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              {PRIORITY_FILTERS.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`todos.filters.priority.${priority}`)}
                </option>
              ))}
            </select>

            <select
              value={sourceTypeFilter}
              onChange={(event) => setSourceTypeFilter(event.target.value as SourceTypeFilter)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              {SOURCE_TYPE_FILTERS.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {t(`todos.filters.sourceType.${sourceType}`)}
                </option>
              ))}
            </select>

            <select
              value={triggerModeFilter}
              onChange={(event) => setTriggerModeFilter(event.target.value as TriggerModeFilter)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              {TRIGGER_MODE_FILTERS.map((triggerMode) => (
                <option key={triggerMode} value={triggerMode}>
                  {t(`todos.filters.triggerMode.${triggerMode}`)}
                </option>
              ))}
            </select>

            <div className="flex min-w-[260px] flex-1 items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('todos.filters.searchPlaceholder')}
                className="h-9"
              />
              {searchQuery.trim().length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                >
                  {t('todos.filters.clearSearch')}
                </Button>
              )}
            </div>
          </div>
        </section>

        {listError && (
          <div className="surface-card-soft flex items-center justify-between rounded-xl border border-red-200 bg-red-50/85 p-3">
            <span className="text-sm text-red-700">{listError}</span>
            <button
              onClick={() => useTodosStore.setState({ listError: null })}
              className="rounded p-1 text-red-400 hover:text-red-600"
              aria-label={t('todos.page.dismissError')}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {loading && todos.length === 0 ? (
          <SkeletonCardList count={4} />
        ) : filteredTodos.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={hasSearchQuery ? t('todos.page.searchEmptyTitle') : t('todos.page.emptyTitle')}
            description={hasSearchQuery
              ? t('todos.page.searchEmptyDescription', { query: searchQuery.trim() })
              : t('todos.page.emptyDescription')}
          />
        ) : (
          <div className="space-y-4">
            {filteredTodos.map((todo) => {
              const focused = Boolean(focusTodoId) && todo.id === focusTodoId;
              const events = eventsByTodo[todo.id] ?? [];
              const eventsLoading = eventsLoadingByTodo[todo.id] === true;
              const eventsError = eventsErrorByTodo[todo.id];
              const expanded = expandedTodoId === todo.id;
              return (
                <section
                  key={todo.id}
                  className={`rounded-xl border bg-card px-4 py-4 ${
                    focused ? 'border-brand-300 ring-1 ring-brand-200' : 'border-border/70'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-foreground">{todo.title}</div>
                      {todo.description && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{todo.description}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${todoStatusClass(todo.status)}`}
                      >
                        {t(`todos.filters.status.${todo.status}`)}
                      </span>
                      {todo.priority && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${todoPriorityClass(todo.priority)}`}
                        >
                          {t(`todos.filters.priority.${todo.priority}`)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                    <div>{t('todos.item.id', { value: todo.id })}</div>
                    <div>{t('todos.item.occurrence', { count: todo.occurrence_count })}</div>
                    <div>{t('todos.item.firstSeenAt', { value: formatDate(todo.first_seen_at) })}</div>
                    <div>{t('todos.item.lastSeenAt', { value: formatDate(todo.last_seen_at) })}</div>
                    <div className="md:col-span-2">{t('todos.item.dedupeKey', { value: todo.dedupe_key })}</div>
                  </div>

                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleToggleEvents(todo.id)}
                      disabled={eventsLoading}
                    >
                      {eventsLoading
                        ? t('todos.actions.loadingEvents')
                        : expanded
                          ? t('todos.actions.hideEvents')
                          : t('todos.actions.viewEvents')}
                    </Button>
                  </div>

                  {expanded && (
                    <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                      {eventsError && (
                        <div className="rounded-md border border-red-200 bg-red-50/85 px-3 py-2 text-xs text-red-700">
                          {eventsError}
                        </div>
                      )}
                      {eventsLoading ? (
                        <div className="text-xs text-muted-foreground">{t('todos.events.loading')}</div>
                      ) : events.length === 0 ? (
                        <div className="text-xs text-muted-foreground">{t('todos.events.empty')}</div>
                      ) : (
                        events.map((event) => {
                          const evidenceText = parseEvidenceText(event.evidence);
                          return (
                            <div key={`${event.id ?? event.created_at}-${event.action}`} className="rounded-md border border-border/60 bg-card px-3 py-2">
                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${todoEventActionClass(event.action)}`}
                                >
                                  {t(`todos.events.action.${event.action}`)}
                                </span>
                                <span className="text-muted-foreground">
                                  {t(`todos.filters.sourceType.${event.source_type}`)} · {event.source_id}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t('todos.events.createdAt', { value: formatDate(event.created_at) })}
                                {event.trigger_mode
                                  ? ` · ${t(`todos.filters.triggerMode.${event.trigger_mode}`)}`
                                  : ''}
                              </div>
                              {event.source_run_id && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {t('todos.events.sourceRunId', { value: event.source_run_id })}
                                </div>
                              )}
                              {evidenceText && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-muted-foreground">
                                    {t('todos.events.evidence')}
                                  </summary>
                                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
                                    {evidenceText}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            {nextCursor && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => void handleLoadMore()} disabled={loading}>
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  {t('todos.page.loadMore')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
