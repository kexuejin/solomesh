import { useState, useCallback } from 'react';
import { Folder, FolderPlus, ChevronRight, ArrowLeft, Loader2, FolderCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';

interface DirectoryEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

interface BrowseResponse {
  currentPath: string | null;
  parentPath: string | null;
  directories: DirectoryEntry[];
  hasAllowlist: boolean;
}

interface DirectoryBrowserProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}

export function DirectoryBrowser({ value, onChange, placeholder }: DirectoryBrowserProps) {
  const { t } = useI18n();
  const [browsing, setBrowsing] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const fetchDirectories = useCallback(async (targetPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = targetPath
        ? `/api/browse/directories?path=${encodeURIComponent(targetPath)}`
        : '/api/browse/directories';
      const data = await api.get<BrowseResponse>(url);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setDirectories(data.directories);
    } catch (err: any) {
      setError(
        err?.message
          || (err instanceof Error ? err.message : t('shared.directoryBrowser.errors.loadDirectoriesFailed')),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleToggleBrowse = () => {
    if (browsing) {
      setBrowsing(false);
      return;
    }
    setBrowsing(true);
    setCreating(false);
    setNewFolderName('');
    if (value && value.startsWith('/')) {
      fetchDirectories(value);
    } else {
      fetchDirectories();
    }
  };

  const handleNavigate = (dirPath: string) => {
    fetchDirectories(dirPath);
    setCreating(false);
    setNewFolderName('');
  };

  const handleGoUp = () => {
    if (parentPath) {
      fetchDirectories(parentPath);
    } else {
      fetchDirectories();
    }
    setCreating(false);
    setNewFolderName('');
  };

  const handleSelect = (dirPath: string) => {
    onChange(dirPath);
    setBrowsing(false);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !currentPath) return;

    setCreateLoading(true);
    try {
      const created = await api.post<DirectoryEntry>('/api/browse/directories', { parentPath: currentPath, name });
      onChange(created.path);
      setBrowsing(false);
      setCreating(false);
      setNewFolderName('');
    } catch (err: any) {
      setError(
        err?.message
          || (err instanceof Error ? err.message : t('shared.directoryBrowser.errors.createFolderFailed')),
      );
    } finally {
      setCreateLoading(false);
    }
  };

  // Build breadcrumbs from currentPath
  const breadcrumbs = currentPath
    ? currentPath
        .split('/')
        .filter(Boolean)
        .map((part, i, arr) => ({
          name: part,
          path: '/' + arr.slice(0, i + 1).join('/'),
        }))
    : [];

  return (
    <div>
      <label className="block text-sm font-medium text-foreground/80 mb-1">
        {t('shared.directoryBrowser.label')}
      </label>
      <div className="flex gap-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || t('shared.directoryBrowser.defaultPlaceholder')}
          className="flex-1 text-sm"
        />
        <button
          type="button"
          onClick={handleToggleBrowse}
          className="px-3 py-2 text-sm font-medium text-primary bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors cursor-pointer whitespace-nowrap"
        >
          {browsing ? t('shared.directoryBrowser.collapse') : t('shared.directoryBrowser.browse')}
        </button>
      </div>

      {browsing && (
        <div className="mt-2 border border-border rounded-lg overflow-hidden bg-card">
          {/* Breadcrumbs + select current dir */}
          {currentPath && (
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
              <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto min-w-0">
                <button
                  onClick={() => fetchDirectories()}
                  className="hover:text-primary transition-colors cursor-pointer flex-shrink-0"
                >
                  <Folder className="w-3.5 h-3.5" />
                </button>
                {breadcrumbs.map((bc, i) => (
                  <span key={bc.path} className="flex items-center gap-1 flex-shrink-0">
                    <ChevronRight className="w-3 h-3 text-border" />
                    <button
                      onClick={() =>
                        i === breadcrumbs.length - 1
                          ? undefined
                          : handleNavigate(bc.path)
                      }
                      className={`hover:text-primary transition-colors ${
                        i === breadcrumbs.length - 1
                          ? 'text-foreground/80 font-medium'
                          : 'cursor-pointer'
                      }`}
                      disabled={i === breadcrumbs.length - 1}
                    >
                      {bc.name}
                    </button>
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleSelect(currentPath)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-primary rounded hover:bg-primary/90 transition-colors cursor-pointer flex-shrink-0 ml-2"
              >
                <FolderCheck className="w-3.5 h-3.5" />
                {t('shared.directoryBrowser.selectCurrent')}
              </button>
            </div>
          )}

          {/* Directory list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-muted-foreground/80 animate-spin" />
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-sm text-red-600 text-center">{error}</div>
            ) : (
              <>
                {/* Go up */}
                {(parentPath !== null || currentPath !== null) && (
                  <button
                    onClick={handleGoUp}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer border-b border-border/70"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t('shared.directoryBrowser.goUp')}
                  </button>
                )}

                {directories.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground/80 text-center">
                    {t('shared.directoryBrowser.noSubdirectories')}
                  </div>
                )}

                {directories.map((dir) => (
                  <div
                    key={dir.path}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <button
                      onClick={() => handleNavigate(dir.path)}
                      className="flex items-center gap-2 text-sm text-foreground/80 cursor-pointer flex-1 min-w-0"
                    >
                      <Folder className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="truncate">{dir.name}</span>
                      {dir.hasChildren && (
                        <ChevronRight className="w-3.5 h-3.5 text-border flex-shrink-0" />
                      )}
                    </button>
                    <button
                      onClick={() => handleSelect(dir.path)}
                      className="px-2 py-1 text-xs font-medium text-primary bg-brand-50 hover:bg-brand-100 rounded transition-colors cursor-pointer flex-shrink-0 ml-2"
                    >
                      {t('shared.directoryBrowser.select')}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* New folder section */}
          {currentPath && (
            <div className="border-t border-border px-3 py-2">
              {creating ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder();
                      if (e.key === 'Escape') {
                        setCreating(false);
                        setNewFolderName('');
                      }
                    }}
                    placeholder={t('shared.directoryBrowser.newFolderPlaceholder')}
                    className="flex-1 px-2 py-1.5 text-sm h-auto"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || createLoading}
                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {createLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      t('shared.directoryBrowser.create')
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setCreating(false);
                      setNewFolderName('');
                    }}
                    className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground/80 transition-colors cursor-pointer"
                  >
                    {t('shared.directoryBrowser.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4" />
                  {t('shared.directoryBrowser.newFolder')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
