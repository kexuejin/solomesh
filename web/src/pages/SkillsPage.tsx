import { useEffect, useState, useMemo } from 'react';
import { Plus, RefreshCw, Puzzle, Download } from 'lucide-react';
import { SearchInput } from '@/components/common';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useSkillsStore } from '../stores/skills';
import { useAuthStore } from '../stores/auth';
import { SkillCard } from '../components/skills/SkillCard';
import { SkillDetail } from '../components/skills/SkillDetail';
import { InstallSkillDialog } from '../components/skills/InstallSkillDialog';
import { useI18n } from '../i18n';

export function SkillsPage() {
  const { t } = useI18n();
  const {
    skills,
    loading,
    error,
    installing,
    syncing,
    loadSkills,
    installSkill,
    syncHostSkills,
  } = useSkillsStore();

  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  const manualUserSkills = filtered.filter((s) => s.source === 'user' && !s.syncedFromHost);
  const syncedUserSkills = filtered.filter((s) => s.source === 'user' && s.syncedFromHost);
  const projectSkills = filtered.filter((s) => s.source === 'project');

  const enabledCount = skills.filter((s) => s.enabled).length;

  const handleInstall = async (pkg: string) => {
    await installSkill(pkg);
  };

  const handleSync = async () => {
    setSyncMessage(null);
    try {
      const result = await syncHostSkills();
      const { added, updated, deleted, skipped } = result.stats;
      setSyncMessage(
        t('skills.page.syncDone', {
          added,
          updated,
          deleted,
          skipped,
          total: result.total,
        })
      );
      setTimeout(() => setSyncMessage(null), 5000);
    } catch {
      // error handled by store
    }
  };

  return (
    <div className="min-h-full app-canvas">
      <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-4 lg:px-6">
        {/* Header */}
        <div className="surface-card p-4 md:p-5">
          <PageHeader
            title={t('skills.page.title')}
            subtitle={
              syncedUserSkills.length > 0
                ? t('skills.page.subtitleWithSynced', {
                    userCount: manualUserSkills.length + syncedUserSkills.length,
                    syncedCount: syncedUserSkills.length,
                    projectCount: projectSkills.length,
                    enabledCount,
                  })
                : t('skills.page.subtitle', {
                    userCount: manualUserSkills.length + syncedUserSkills.length,
                    projectCount: projectSkills.length,
                    enabledCount,
                  })
            }
            actions={
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                {isAdmin && (
                  <Button variant="outline" onClick={handleSync} disabled={syncing} className="h-10 rounded-xl">
                    <Download size={18} className={syncing ? 'animate-pulse' : ''} />
                    {syncing ? t('skills.page.syncing') : t('skills.page.syncHost')}
                  </Button>
                )}
                <Button variant="outline" onClick={loadSkills} disabled={loading} className="h-10 rounded-xl">
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  {t('skills.page.refresh')}
                </Button>
                <Button onClick={() => setShowInstallDialog(true)} className="h-10 rounded-xl">
                  <Plus size={18} />
                  {t('skills.page.install')}
                </Button>
              </div>
            }
          />
        </div>

        {/* Sync message toast */}
        {syncMessage && (
          <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            {syncMessage}
          </div>
        )}

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
          {/* Left list */}
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4 md:p-5">
            <div className="mb-4">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('skills.page.searchPlaceholder')}
              />
            </div>

            <div className="space-y-6">
              {loading && skills.length === 0 ? (
                <SkeletonCardList count={3} />
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50/75 px-4 py-6 text-center">
                  <p className="text-red-600">{error}</p>
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Puzzle}
                  title={searchQuery ? t('skills.page.emptySearch') : t('skills.page.empty')}
                />
              ) : (
                <>
                  {manualUserSkills.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        {t('skills.page.userSkills', { count: manualUserSkills.length })}
                      </h2>
                      <div className="space-y-2">
                        {manualUserSkills.map((skill) => (
                          <SkillCard
                            key={skill.id}
                            skill={skill}
                            selected={selectedId === skill.id}
                            onSelect={() => setSelectedId(skill.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {syncedUserSkills.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        {t('skills.page.syncedSkills', { count: syncedUserSkills.length })}
                      </h2>
                      <div className="space-y-2">
                        {syncedUserSkills.map((skill) => (
                          <SkillCard
                            key={skill.id}
                            skill={skill}
                            selected={selectedId === skill.id}
                            onSelect={() => setSelectedId(skill.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {projectSkills.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        {t('skills.page.projectSkills', { count: projectSkills.length })}
                      </h2>
                      <div className="space-y-2">
                        {projectSkills.map((skill) => (
                          <SkillCard
                            key={skill.id}
                            skill={skill}
                            selected={selectedId === skill.id}
                            onSelect={() => setSelectedId(skill.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right detail panel (desktop) */}
          <div className="hidden lg:block min-w-0">
            <SkillDetail skillId={selectedId} onDeleted={() => setSelectedId(null)} />
          </div>
        </div>

        {/* Mobile detail panel */}
        {selectedId && (
          <div className="lg:hidden">
            <SkillDetail skillId={selectedId} onDeleted={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      <InstallSkillDialog
        open={showInstallDialog}
        onClose={() => setShowInstallDialog(false)}
        onInstall={handleInstall}
        installing={installing}
      />
    </div>
  );
}
