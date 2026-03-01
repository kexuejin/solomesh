import { useEffect } from 'react';
import { Users } from 'lucide-react';
import { useGroupsStore } from '../stores/groups';
import { GroupCard } from '../components/groups/GroupCard';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardGrid } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { useI18n } from '../i18n';

export function GroupsPage() {
  const { t } = useI18n();
  const { groups, loading, loadGroups } = useGroupsStore();

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const groupsArray = Object.entries(groups).map(([jid, info]) => ({
    jid,
    ...info,
  }));

  return (
    <div className="min-h-full app-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="surface-card p-5">
          <PageHeader
            title={t('groups.page.title')}
            subtitle={t('groups.page.subtitle', { count: groupsArray.length })}
          />
        </div>

        {loading && (
          <SkeletonCardGrid />
        )}

        {!loading && groupsArray.length === 0 && (
          <EmptyState
            icon={Users}
            title={t('groups.page.emptyTitle')}
            description={t('groups.page.emptyDescription')}
          />
        )}

        {!loading && groupsArray.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groupsArray.map((group) => (
              <GroupCard key={group.jid} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
