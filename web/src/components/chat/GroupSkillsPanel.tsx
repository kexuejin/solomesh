import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Save, Search, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { api } from '../../api/client';
import { useChatStore } from '../../stores/chat';
import { useI18n } from '../../i18n';

interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'project';
  enabled: boolean;
  syncedFromHost?: boolean;
}

interface GroupSkillsPanelProps {
  groupJid: string;
  onClose?: () => void;
}

type SourceFilter = 'all' | 'user' | 'project';

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function GroupSkillsPanel({ groupJid }: GroupSkillsPanelProps) {
  const { locale, t } = useI18n();
  const group = useChatStore((s) => s.groups[groupJid]);
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null); // null = all selected
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  // Load available skills.
  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get<{ skills: Skill[] }>('/api/skills')
      .then((data) => {
        setAllSkills(data.skills);
      })
      .catch((err) => {
        setError(getErrorMessage(err, t('chat.skills.errors.loadFailed')));
      })
      .finally(() => setLoading(false));
  }, [t]);

  // Initialize selected IDs from group settings.
  useEffect(() => {
    if (!group) return;
    const ss = group.selected_skills;
    if (ss === null || ss === undefined) {
      setSelectedIds(null); // all selected
    } else {
      setSelectedIds(new Set(ss));
    }
    setDirty(false);
    setSaveSuccess(false);
  }, [group?.selected_skills]);

  const allSelected = selectedIds === null;
  const selectedCount = allSelected ? allSkills.length : (selectedIds?.size ?? 0);

  const visibleSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return allSkills
      .filter((skill) => {
        if (sourceFilter !== 'all' && skill.source !== sourceFilter) return false;
        if (!keyword) return true;
        return (
          skill.name.toLowerCase().includes(keyword) ||
          skill.description.toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === 'user' ? -1 : 1;
        return a.name.localeCompare(b.name, locale === 'zh-CN' ? 'zh-CN' : 'en');
      });
  }, [allSkills, locale, query, sourceFilter]);

  const isSelected = useCallback((id: string) => {
    return allSelected || !!selectedIds?.has(id);
  }, [allSelected, selectedIds]);

  const toggleSkill = (id: string) => {
    setDirty(true);
    setSaveSuccess(false);
    if (allSelected) {
      // Switch from "all selected" to explicit selection.
      const newSet = new Set(allSkills.map((s) => s.id));
      newSet.delete(id);
      setSelectedIds(newSet);
      return;
    }

    const newSet = new Set(selectedIds ?? []);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    // Use null to represent all selected.
    if (newSet.size === allSkills.length) {
      setSelectedIds(null);
    } else {
      setSelectedIds(newSet);
    }
  };

  const selectAll = () => {
    if (!allSelected) {
      setSelectedIds(null);
      setDirty(true);
      setSaveSuccess(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = allSelected ? null : Array.from(selectedIds ?? []);
      await api.patch(`/api/groups/${encodeURIComponent(groupJid)}`, { selected_skills: payload });
      // Keep chat store selection in sync.
      useChatStore.setState((s) => {
        const g = s.groups[groupJid];
        if (!g) return s;
        return {
          ...s,
          groups: { ...s.groups, [groupJid]: { ...g, selected_skills: payload } },
        };
      });
      setDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(getErrorMessage(err, t('chat.skills.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-sidebar-border bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t('chat.skills.title')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {allSelected
                ? t('chat.skills.inheritAll', { count: allSkills.length })
                : t('chat.skills.explicitSelection', {
                  selected: selectedCount,
                  total: allSkills.length,
                })}
            </p>
          </div>
          <Button
            size="sm"
            variant={saveSuccess ? 'outline' : 'default'}
            disabled={!dirty || saving}
            onClick={handleSave}
            className="h-8 text-xs"
          >
            {saving
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              : <Save className="mr-1 h-3.5 w-3.5" />}
            {saveSuccess ? t('chat.skills.saved') : t('chat.skills.save')}
          </Button>
        </div>

        <div className="inline-flex rounded-[10px] border border-sidebar-border bg-background p-1">
          <button
            className={cn(
              'h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer',
              sourceFilter === 'all'
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setSourceFilter('all')}
          >
            {t('chat.skills.filters.all')}
          </button>
          <button
            className={cn(
              'h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer',
              sourceFilter === 'user'
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setSourceFilter('user')}
          >
            {t('chat.skills.filters.user')}
          </button>
          <button
            className={cn(
              'h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer',
              sourceFilter === 'project'
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setSourceFilter('project')}
          >
            {t('chat.skills.filters.project')}
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.skills.searchPlaceholder')}
            className="h-9 rounded-[10px] border-border/80 bg-card pl-9"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('chat.skills.visibleCount', { count: visibleSkills.length })}</span>
          {!allSelected && (
            <button
              onClick={selectAll}
              className="rounded-md px-1.5 py-0.5 text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              {t('chat.skills.restoreDefault')}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {visibleSkills.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={query ? t('chat.skills.emptySearchTitle') : t('chat.skills.emptyTitle')}
            description={query ? t('chat.skills.emptySearchDescription') : t('chat.skills.emptyDescription')}
            className="py-14"
            action={query ? (
              <Button size="xs" variant="outline" onClick={() => setQuery('')}>
                {t('chat.skills.clearSearch')}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="space-y-2">
            {visibleSkills.map((skill) => {
              const checked = isSelected(skill.id);
              const sourceLabel = skill.source === 'project'
                ? t('chat.skills.source.project')
                : (skill.syncedFromHost ? t('chat.skills.source.synced') : t('chat.skills.source.user'));
              return (
                <label
                  key={skill.id}
                  className={cn(
                    'group flex cursor-pointer items-start gap-3 px-3 py-3 transition',
                    checked
                      ? 'rounded-r-lg border-l-4 border-brand-500 bg-brand-50/55'
                      : 'rounded-lg hover:bg-muted/70',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSkill(skill.id)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 rounded-full border px-2 text-[10px]',
                          skill.source === 'project'
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                        )}
                      >
                        {sourceLabel}
                      </Badge>
                    </div>
                    {skill.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {skill.description}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-sidebar-border bg-background px-4 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          {t('chat.skills.footerHint')}
        </p>
      </div>
    </div>
  );
}
