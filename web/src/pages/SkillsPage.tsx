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

export function SkillsPage() {
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
        `同步完成：新增 ${added}，更新 ${updated}，删除 ${deleted}，跳过 ${skipped}（共 ${result.total} 个宿主机技能）`
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
            title="技能管理"
            subtitle={`用户级 ${manualUserSkills.length + syncedUserSkills.length}${syncedUserSkills.length > 0 ? `（含同步 ${syncedUserSkills.length}）` : ''} · 项目级 ${projectSkills.length} · 启用 ${enabledCount}`}
            actions={
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                {isAdmin && (
                  <Button variant="outline" onClick={handleSync} disabled={syncing} className="h-10 rounded-xl">
                    <Download size={18} className={syncing ? 'animate-pulse' : ''} />
                    {syncing ? '同步中...' : '同步宿主机技能'}
                  </Button>
                )}
                <Button variant="outline" onClick={loadSkills} disabled={loading} className="h-10 rounded-xl">
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  刷新
                </Button>
                <Button onClick={() => setShowInstallDialog(true)} className="h-10 rounded-xl">
                  <Plus size={18} />
                  安装技能
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
          {/* 左侧列表 */}
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4 md:p-5">
            <div className="mb-4">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="搜索技能名称或描述"
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
                  title={searchQuery ? '没有找到匹配的技能' : '暂无技能'}
                />
              ) : (
                <>
                  {manualUserSkills.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        用户级技能 ({manualUserSkills.length})
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
                        宿主机同步 ({syncedUserSkills.length})
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
                        项目级技能 ({projectSkills.length})
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

          {/* 右侧详情（桌面端） */}
          <div className="hidden lg:block min-w-0">
            <SkillDetail skillId={selectedId} onDeleted={() => setSelectedId(null)} />
          </div>
        </div>

        {/* 移动端详情 */}
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
