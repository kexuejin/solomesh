import { useState } from 'react';
import { Loader2, Search, ExternalLink, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSkillsStore, type SearchResult } from '@/stores/skills';

interface InstallSkillDialogProps {
  open: boolean;
  onClose: () => void;
  onInstall: (pkg: string) => Promise<void>;
  installing: boolean;
}

type Tab = 'search' | 'manual';

function SearchResultItem({
  result,
  isInstalling,
  installingPkg,
  onInstall,
}: {
  result: SearchResult;
  isInstalling: boolean;
  installingPkg: string | null;
  onInstall: (result: SearchResult) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { searchDetails, searchDetailLoading, fetchSearchDetail } = useSkillsStore();

  const detail = result.url ? searchDetails[result.url] : undefined;
  const loading = result.url ? searchDetailLoading[result.url] : false;

  const handleToggle = () => {
    if (!expanded && result.url && !(result.url in searchDetails)) {
      fetchSearchDetail(result.url);
    }
    setExpanded(!expanded);
  };

  return (
    <div className="surface-card-soft overflow-hidden border border-border/70 bg-muted/20 transition-colors hover:bg-muted/35">
      <div className="flex items-center justify-between px-3 py-2.5">
        <button
          type="button"
          className="min-w-0 flex-1 text-left flex items-center gap-2"
          onClick={handleToggle}
        >
          {expanded
            ? <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
            : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground truncate">
              {result.package}
            </span>
            {result.installs && (
              <span className="block text-xs text-muted-foreground">
                安装量: {result.installs}
              </span>
            )}
          </span>
        </button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onInstall(result)}
          disabled={isInstalling}
          className="ml-3 shrink-0"
        >
          {installingPkg === result.package ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          <span className="ml-1">安装</span>
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border/70 bg-card/60 px-3 pb-3 pt-2.5">
          {loading && (
            <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
              <Loader2 className="size-3 animate-spin" />
              加载详情...
            </div>
          )}

          {!loading && detail && (
            <div className="space-y-2 pt-2">
              {detail.description && (
                <p className="text-xs text-foreground/80 leading-relaxed">{detail.description}</p>
              )}

              {(detail.installs || detail.age) && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {detail.installs && <span>每周安装: {detail.installs}</span>}
                  {detail.age && <span>{detail.age}</span>}
                </div>
              )}

              {detail.features.length > 0 && (
                <ul className="space-y-0.5">
                  {detail.features.map((f, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                      <span className="text-primary/60 shrink-0">-</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!loading && detail === null && (
            <p className="text-xs text-muted-foreground py-2">无法加载详情</p>
          )}

          {/* detail === undefined means not yet fetched (shouldn't happen since we fetch on expand) */}

          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-2"
            >
              在 skills.sh 查看
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function InstallSkillDialog({
  open,
  onClose,
  onInstall,
  installing,
}: InstallSkillDialogProps) {
  const [tab, setTab] = useState<Tab>('search');
  const [pkg, setPkg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [installingPkg, setInstallingPkg] = useState<string | null>(null);

  const { searching, searchResults, searchSkills } = useSkillsStore();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setError(null);
    await searchSkills(trimmed);
  };

  const handleInstallFromSearch = async (result: SearchResult) => {
    try {
      setError(null);
      setInstallingPkg(result.package);
      await onInstall(result.package);
      setInstallingPkg(null);
      onClose();
    } catch (err) {
      setInstallingPkg(null);
      setError(err instanceof Error ? err.message : '安装失败');
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pkg.trim();
    if (!trimmed) {
      setError('请输入技能包名称');
      return;
    }

    try {
      setError(null);
      await onInstall(trimmed);
      setPkg('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    }
  };

  const handleClose = () => {
    if (!installing) {
      setPkg('');
      setSearchQuery('');
      setError(null);
      setInstallingPkg(null);
      onClose();
    }
  };

  const isInstalling = installing || !!installingPkg;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            技能
          </div>
        </div>
        <DialogHeader className="px-5 pt-4 text-left">
          <DialogTitle>安装技能</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="px-5">
          <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
            <button
              type="button"
              className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                tab === 'search'
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => { setTab('search'); setError(null); }}
              disabled={isInstalling}
            >
              <Search className="mr-1.5 inline-block size-3.5 -mt-0.5" />
              搜索市场
            </button>
            <button
              type="button"
              className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                tab === 'manual'
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => { setTab('manual'); setError(null); }}
              disabled={isInstalling}
            >
              手动安装
            </button>
          </div>
        </div>

        {/* Search Tab */}
        {tab === 'search' && (
          <div className="min-h-0 flex flex-1 flex-col overflow-hidden px-5 pb-5 pt-3">
            <form onSubmit={handleSearch} className="flex gap-2 shrink-0">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索关键词..."
                disabled={searching || isInstalling}
                className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={searching || isInstalling || !searchQuery.trim()}
                className="h-10 rounded-xl"
              >
                {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              </Button>
            </form>

            {/* Results */}
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {searching && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin mr-2" />
                  搜索中...
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery.trim() && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  未找到相关技能
                </div>
              )}

              {!searching && searchResults.map((result) => (
                <SearchResultItem
                  key={result.package}
                  result={result}
                  isInstalling={isInstalling}
                  installingPkg={installingPkg}
                  onInstall={handleInstallFromSearch}
                />
              ))}
            </div>

            {!searching && searchResults.length === 0 && !searchQuery.trim() && (
              <p className="text-xs text-muted-foreground text-center py-4">
                在 skills.sh 市场中搜索可用的技能包
              </p>
            )}

            {error && (
              <div className="surface-card-soft mt-3 shrink-0 rounded-xl border border-red-200 bg-red-50/80 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Manual Tab */}
        {tab === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-4 px-5 pb-5 pt-3">
            <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
              <label htmlFor="skill-pkg" className="block text-sm font-medium text-foreground/80">
                技能包名称
              </label>
              <Input
                id="skill-pkg"
                type="text"
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                placeholder="owner/repo 或 owner/repo@skill"
                disabled={isInstalling}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                支持格式：owner/repo 或 owner/repo@skill
              </p>
            </div>

            {error && (
              <div className="surface-card-soft rounded-xl border border-red-200 bg-red-50/80 p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isInstalling}
                className="h-10 rounded-xl"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={isInstalling || !pkg.trim()}
                className="h-10 rounded-xl"
              >
                {isInstalling && <Loader2 className="size-4 animate-spin" />}
                安装
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
