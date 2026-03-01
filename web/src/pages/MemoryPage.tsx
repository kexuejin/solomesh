import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Loader2, RefreshCw, Save } from 'lucide-react';
import { api } from '../api/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { localeForDateTime, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';

interface MemorySource {
  path: string;
  label: string;
  scope: 'user-global' | 'main' | 'flow' | 'session';
  kind: 'primary' | 'note' | 'session';
  writable: boolean;
  exists: boolean;
  updatedAt: string | null;
  size: number;
  ownerName?: string;
}

interface MemoryFile {
  path: string;
  content: string;
  updatedAt: string | null;
  size: number;
  writable: boolean;
}

interface MemorySearchHit {
  path: string;
  hits: number;
  snippet: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function scopeLabel(
  scope: MemorySource['scope'],
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  switch (scope) {
    case 'user-global':
      return t('memory.scope.userGlobal');
    case 'main':
      return t('memory.scope.main');
    case 'flow':
      return t('memory.scope.flow');
    case 'session':
      return t('memory.scope.session');
    default:
      return t('memory.scope.other');
  }
}

export function MemoryPage() {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [fileMeta, setFileMeta] = useState<MemoryFile | null>(null);
  const [keyword, setKeyword] = useState('');
  const [searchHits, setSearchHits] = useState<Record<string, MemorySearchHit>>({});

  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchingContent, setSearchingContent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isMobile = useMediaQuery('(max-width: 1023px)');
  const [showContent, setShowContent] = useState(false);

  const dirty = useMemo(() => content !== initialContent, [content, initialContent]);

  const filteredSources = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return sources;
    return sources.filter((s) =>
      `${s.label} ${s.path}`.toLowerCase().includes(text) || Boolean(searchHits[s.path]),
    );
  }, [sources, keyword, searchHits]);

  const groupedSources = useMemo(() => {
    const groups: Record<MemorySource['scope'], MemorySource[]> = {
      'user-global': [],
      main: [],
      flow: [],
      session: [],
    };
    for (const source of filteredSources) {
      groups[source.scope].push(source);
    }
    return groups;
  }, [filteredSources]);

  const loadFile = useCallback(async (path: string) => {
    setLoadingFile(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.get<MemoryFile>(
        `/api/memory/file?${new URLSearchParams({ path })}`,
      );
      setSelectedPath(path);
      setContent(data.content);
      setInitialContent(data.content);
      setFileMeta(data);
    } catch (err) {
      setError(getErrorMessage(err, t('memory.errors.loadFileFailed')));
    } finally {
      setLoadingFile(false);
    }
  }, [t]);

  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    setError(null);
    try {
      const data = await api.get<{ sources: MemorySource[] }>('/api/memory/sources');
      setSources(data.sources);

      const available = new Set(data.sources.map((s) => s.path));
      let nextSelected = selectedPath && available.has(selectedPath) ? selectedPath : null;

      if (!nextSelected) {
        // Default: first user-global primary memory file, then main, then first available
        nextSelected =
          data.sources.find((s) => s.scope === 'user-global' && s.kind === 'primary')?.path ||
          data.sources.find((s) => s.scope === 'main' && s.kind === 'primary')?.path ||
          data.sources[0]?.path ||
          null;
      }

      if (nextSelected) {
        await loadFile(nextSelected);
      } else {
        setSelectedPath(null);
        setContent('');
        setInitialContent('');
        setFileMeta(null);
      }
    } catch (err) {
      setError(getErrorMessage(err, t('memory.errors.loadSourcesFailed')));
    } finally {
      setLoadingSources(false);
    }
  }, [loadFile, selectedPath, t]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      setSearchHits({});
      setSearchingContent(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchingContent(true);
      try {
        const data = await api.get<{ hits: MemorySearchHit[] }>(
          `/api/memory/search?${new URLSearchParams({ q, limit: '120' })}`,
        );
        const next: Record<string, MemorySearchHit> = {};
        for (const hit of data.hits) {
          next[hit.path] = hit;
        }
        setSearchHits(next);
      } catch {
        setSearchHits({});
      } finally {
        setSearchingContent(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const handleSelectSource = async (path: string) => {
    if (path === selectedPath && isMobile) {
      // Mobile: re-tap selected item to show content panel
      setShowContent(true);
      return;
    }
    if (path === selectedPath) return;
    if (dirty && !confirm(t('memory.confirm.switchLoseChanges'))) {
      return;
    }
    await loadFile(path);
    if (isMobile) setShowContent(true);
  };

  const handleSave = async () => {
    if (!selectedPath || !fileMeta?.writable) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.put<MemoryFile>('/api/memory/file', {
        path: selectedPath,
        content,
      });
      setContent(data.content);
      setInitialContent(data.content);
      setFileMeta(data);
      setNotice(t('memory.notice.saved'));
      await loadSources();
    } catch (err) {
      setError(getErrorMessage(err, t('memory.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleReloadFile = async () => {
    if (!selectedPath) return;
    if (dirty && !confirm(t('memory.confirm.reloadOverwrite'))) {
      return;
    }
    await loadFile(selectedPath);
  };

  const updatedText = fileMeta?.updatedAt
    ? new Date(fileMeta.updatedAt).toLocaleString(localeForDateTime(locale))
    : t('memory.notRecorded');

  return (
    <div className="min-h-full app-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="surface-card p-5 md:p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-xl border border-brand-200 bg-brand-100 p-2">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t('memory.title')}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('memory.subtitle')}
              </p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('memory.loadedSources', { count: sources.length })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {(!isMobile || !showContent) && (
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
            <div className="mb-3">
              <Input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('memory.searchPlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {keyword.trim()
                  ? searchingContent
                    ? t('memory.searching')
                    : t('memory.searchHits', { count: Object.keys(searchHits).length })
                  : t('memory.searchHint')}
              </div>
            </div>

            <div className="space-y-4 max-h-[calc(100dvh-280px)] lg:max-h-[560px] overflow-auto pr-1">
              {(['user-global', 'main', 'flow', 'session'] as const).map((scope) => {
                const items = groupedSources[scope];
                if (items.length === 0) return null;
                return (
                  <div key={scope}>
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      {scopeLabel(scope, t)} ({items.length})
                    </div>
                    <div className="space-y-1">
                      {items.map((source) => {
                        const active = source.path === selectedPath;
                        const hit = searchHits[source.path];
                        return (
                          <button
                            key={source.path}
                            onClick={() => handleSelectSource(source.path)}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition-all ${
                              active
                                ? 'border-primary bg-brand-50/80 shadow-[0_8px_20px_rgba(15,107,255,0.14)]'
                                : 'border-border/70 bg-muted/10 hover:bg-muted/30 hover:border-brand-200'
                            }`}
                          >
                            <div className="text-sm font-medium text-foreground truncate">
                              {source.label}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                              {source.path}
                            </div>
                            <div className="text-[11px] mt-1 text-muted-foreground">
                              {source.writable ? t('memory.writable') : t('memory.readonly')} · {source.exists ? `${source.size} B` : t('memory.fileMissing')}
                            </div>
                            {hit && (
                              <div className="text-[11px] mt-1 text-primary truncate">
                                {t('memory.hitLine', { hits: hit.hits, snippet: hit.snippet })}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {!loadingSources && filteredSources.length === 0 && (
                <div className="text-sm text-muted-foreground">{t('memory.noMatchedSources')}</div>
              )}
            </div>
          </div>
          )}

          {(!isMobile || showContent) && (
          <div className="surface-card p-4 lg:p-6">
            {selectedPath ? (
              <>
                {isMobile && (
                  <button
                    onClick={() => setShowContent(false)}
                    className="mb-3 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-sm text-primary hover:bg-brand-50 hover:no-underline"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t('memory.backToList')}
                  </button>
                )}
                <div className="mb-3 rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5">
                  <div className="text-sm font-semibold text-foreground break-all">{selectedPath}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('memory.fileMetaLine', {
                      updatedAt: updatedText,
                      bytes: new TextEncoder().encode(content).length,
                      writable: fileMeta?.writable ? t('memory.writable') : t('memory.readonly'),
                    })}
                  </div>
                </div>

                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[calc(100dvh-380px)] lg:min-h-[460px] resize-y rounded-xl border-border/75 bg-card/95 p-4 font-mono text-sm leading-6 disabled:bg-muted/40"
                  placeholder={loadingFile ? t('memory.loadingContent') : t('memory.emptyContent')}
                  disabled={loadingFile || saving || !fileMeta?.writable}
                />

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <Button
                    onClick={handleSave}
                    disabled={loadingFile || saving || !fileMeta?.writable || !dirty}
                    className="h-10 rounded-xl"
                  >
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    <Save className="w-4 h-4" />
                    {t('memory.save')}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleReloadFile}
                    disabled={loadingFile || saving}
                    className="h-10 rounded-xl"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('memory.reloadCurrent')}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={loadSources}
                    disabled={loadingSources || loadingFile || saving}
                    className="h-10 rounded-xl"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('memory.refreshSources')}
                  </Button>

                  {dirty && <span className="text-sm text-amber-600">{t('memory.unsavedChanges')}</span>}
                  {notice && <span className="text-sm text-green-600">{notice}</span>}
                  {error && <span className="text-sm text-red-600">{error}</span>}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">{t('memory.noSources')}</div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
