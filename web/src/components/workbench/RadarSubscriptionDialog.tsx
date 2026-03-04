import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type RadarCadence = 'daily' | 'weekly' | 'both';

interface RadarSourceTemplate {
  id: string;
  name: string;
  type: string;
  url: string;
  default_enabled: boolean;
  default_cadence: RadarCadence;
  tags: string[];
}

interface RadarUserSourceOverride {
  template_id: string;
  enabled_override: boolean | null;
  cadence_override: RadarCadence | null;
}

interface RadarUserCustomFeed {
  id: string;
  name: string;
  rss_url: string;
  enabled: boolean;
  cadence: RadarCadence;
  tags: string[];
}

interface SubscriptionPayload {
  templates: RadarSourceTemplate[];
  overrides: RadarUserSourceOverride[];
  customFeeds: RadarUserCustomFeed[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function cadenceItems(t: (key: string) => string): Array<{ value: RadarCadence; label: string }> {
  return [
    { value: 'daily', label: t('workbench.radar.cadence.daily') },
    { value: 'weekly', label: t('workbench.radar.cadence.weekly') },
    { value: 'both', label: t('workbench.radar.cadence.both') },
  ];
}

function parseTagInput(raw: string): string[] {
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(value);
  }
  return tags;
}

function formatTagInput(tags: string[]): string {
  return tags.join(', ');
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value.toLowerCase() === b[index]?.toLowerCase());
}

export function RadarSubscriptionDialog({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const cadenceOptions = useMemo(() => cadenceItems(t), [t]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RadarSourceTemplate[]>([]);
  const [overrides, setOverrides] = useState<RadarUserSourceOverride[]>([]);
  const [customFeeds, setCustomFeeds] = useState<RadarUserCustomFeed[]>([]);
  const [newFeedName, setNewFeedName] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedCadence, setNewFeedCadence] = useState<RadarCadence>('both');
  const [newFeedTags, setNewFeedTags] = useState('');
  const [feedTagDrafts, setFeedTagDrafts] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SubscriptionPayload>('/api/radar/subscriptions');
      setTemplates(res.templates);
      setOverrides(res.overrides);
      setCustomFeeds(res.customFeeds);
      setFeedTagDrafts(
        Object.fromEntries(
          res.customFeeds.map((feed) => [feed.id, formatTagInput(feed.tags)]),
        ),
      );
      setError(null);
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError(String((err as { message?: unknown }).message ?? '').trim() || t('workbench.radar.errors.loadFailed'));
      } else {
        setError(t('workbench.radar.errors.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadData();
  }, [open, loadData]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, RadarUserSourceOverride>();
    for (const item of overrides) {
      map.set(item.template_id, item);
    }
    return map;
  }, [overrides]);

  const updateTemplate = useCallback(
    async (templateId: string, patch: Record<string, unknown>) => {
      setSavingKey(`tpl:${templateId}`);
      try {
        const res = await api.put<{
          override: RadarUserSourceOverride;
        }>(`/api/radar/subscriptions/templates/${encodeURIComponent(templateId)}`, patch);
        setOverrides((prev) => {
          const idx = prev.findIndex((item) => item.template_id === templateId);
          if (idx < 0) return [...prev, res.override];
          const next = [...prev];
          next[idx] = res.override;
          return next;
        });
        setError(null);
      } catch (err) {
        if (err && typeof err === 'object' && 'message' in err) {
          setError(String((err as { message?: unknown }).message ?? '').trim() || t('workbench.radar.errors.saveFailed'));
        } else {
          setError(t('workbench.radar.errors.saveFailed'));
        }
      } finally {
        setSavingKey(null);
      }
    },
    [t],
  );

  const addFeed = useCallback(async () => {
    if (!newFeedName.trim() || !newFeedUrl.trim()) {
      setError(t('workbench.radar.errors.feedRequired'));
      return;
    }
    setSavingKey('feed:new');
    try {
      const res = await api.post<{ feed: RadarUserCustomFeed }>('/api/radar/subscriptions/feeds', {
        name: newFeedName.trim(),
        rss_url: newFeedUrl.trim(),
        cadence: newFeedCadence,
        tags: parseTagInput(newFeedTags),
      });
      setCustomFeeds((prev) => [res.feed, ...prev]);
      setFeedTagDrafts((prev) => ({
        ...prev,
        [res.feed.id]: formatTagInput(res.feed.tags),
      }));
      setNewFeedName('');
      setNewFeedUrl('');
      setNewFeedCadence('both');
      setNewFeedTags('');
      setError(null);
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError(String((err as { message?: unknown }).message ?? '').trim() || t('workbench.radar.errors.saveFailed'));
      } else {
        setError(t('workbench.radar.errors.saveFailed'));
      }
    } finally {
      setSavingKey(null);
    }
  }, [newFeedName, newFeedUrl, newFeedCadence, t]);

  const patchFeed = useCallback(
    async (feedId: string, patch: Record<string, unknown>) => {
      setSavingKey(`feed:${feedId}`);
      try {
        const res = await api.patch<{ feed: RadarUserCustomFeed }>(
          `/api/radar/subscriptions/feeds/${encodeURIComponent(feedId)}`,
          patch,
        );
        setCustomFeeds((prev) => prev.map((item) => (item.id === feedId ? res.feed : item)));
        setFeedTagDrafts((prev) => ({
          ...prev,
          [feedId]: formatTagInput(res.feed.tags),
        }));
        setError(null);
      } catch (err) {
        if (err && typeof err === 'object' && 'message' in err) {
          setError(String((err as { message?: unknown }).message ?? '').trim() || t('workbench.radar.errors.saveFailed'));
        } else {
          setError(t('workbench.radar.errors.saveFailed'));
        }
      } finally {
        setSavingKey(null);
      }
    },
    [t],
  );

  const deleteFeed = useCallback(
    async (feedId: string) => {
      setSavingKey(`feed:${feedId}`);
      try {
        await api.delete(`/api/radar/subscriptions/feeds/${encodeURIComponent(feedId)}`);
        setCustomFeeds((prev) => prev.filter((item) => item.id !== feedId));
        setFeedTagDrafts((prev) => {
          const next = { ...prev };
          delete next[feedId];
          return next;
        });
        setError(null);
      } catch (err) {
        if (err && typeof err === 'object' && 'message' in err) {
          setError(String((err as { message?: unknown }).message ?? '').trim() || t('workbench.radar.errors.saveFailed'));
        } else {
          setError(t('workbench.radar.errors.saveFailed'));
        }
      } finally {
        setSavingKey(null);
      }
    },
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workbench.radar.title')}</DialogTitle>
          <DialogDescription>{t('workbench.radar.description')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6 text-sm text-muted-foreground">{t('workbench.radar.loading')}</div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{t('workbench.radar.systemSources')}</h3>
              <div className="space-y-2">
                {templates.map((template) => {
                  const override = overrideMap.get(template.id);
                  const effectiveEnabled = override?.enabled_override ?? template.default_enabled;
                  const effectiveCadence = override?.cadence_override ?? template.default_cadence;
                  const pending = savingKey === `tpl:${template.id}`;
                  return (
                    <article key={template.id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">{template.name}</div>
                          <div className="text-xs text-muted-foreground">{template.url}</div>
                          {template.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {template.tags.map((tag) => (
                                <span
                                  key={`${template.id}:${tag}`}
                                  className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {pending && <Loader2 size={14} className="mt-1 animate-spin text-muted-foreground" />}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={effectiveEnabled}
                            disabled={pending}
                            onChange={() => {
                              void updateTemplate(template.id, {
                                enabled_override: !effectiveEnabled,
                              });
                            }}
                          />
                          <span>{t('workbench.radar.enabled')}</span>
                        </label>
                        <Select
                          value={effectiveCadence}
                          onValueChange={(value: RadarCadence) => {
                            void updateTemplate(template.id, { cadence_override: value });
                          }}
                          disabled={pending}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {cadenceOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{t('workbench.radar.customFeeds')}</h3>

              <div className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr,2fr,140px,1fr,auto]">
                <Input
                  placeholder={t('workbench.radar.feedNamePlaceholder')}
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                />
                <Input
                  placeholder={t('workbench.radar.feedUrlPlaceholder')}
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                />
                <Select value={newFeedCadence} onValueChange={(value: RadarCadence) => setNewFeedCadence(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cadenceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder={t('workbench.radar.feedTagsPlaceholder')}
                  value={newFeedTags}
                  onChange={(e) => setNewFeedTags(e.target.value)}
                />
                <Button onClick={() => void addFeed()} disabled={savingKey === 'feed:new'}>
                  <Plus size={14} />
                  {t('workbench.radar.addFeed')}
                </Button>
              </div>

              <div className="space-y-2">
                {customFeeds.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    {t('workbench.radar.emptyFeeds')}
                  </div>
                ) : (
                  customFeeds.map((feed) => {
                    const pending = savingKey === `feed:${feed.id}`;
                    return (
                      <article key={feed.id} className="rounded-lg border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground">{feed.name}</div>
                            <div className="text-xs text-muted-foreground">{feed.rss_url}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {pending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => void deleteFeed(feed.id)}
                              disabled={pending}
                              aria-label={t('workbench.radar.deleteFeed')}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <label className="flex items-center gap-2 text-xs text-foreground">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={feed.enabled}
                              disabled={pending}
                              onChange={() => {
                                void patchFeed(feed.id, { enabled: !feed.enabled });
                              }}
                            />
                            <span>{t('workbench.radar.enabled')}</span>
                          </label>
                          <Select
                            value={feed.cadence}
                            onValueChange={(value: RadarCadence) => {
                              void patchFeed(feed.id, { cadence: value });
                            }}
                            disabled={pending}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {cadenceOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          placeholder={t('workbench.radar.feedTagsPlaceholder')}
                          value={feedTagDrafts[feed.id] ?? formatTagInput(feed.tags)}
                          disabled={pending}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFeedTagDrafts((prev) => ({
                              ...prev,
                              [feed.id]: value,
                            }));
                          }}
                          onBlur={() => {
                            const draft = feedTagDrafts[feed.id] ?? formatTagInput(feed.tags);
                            const nextTags = parseTagInput(draft);
                            if (sameTags(nextTags, feed.tags)) return;
                            void patchFeed(feed.id, { tags: nextTags });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              (event.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                        />
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
