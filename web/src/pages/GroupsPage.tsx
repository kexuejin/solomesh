import { useEffect } from 'react';
import { Users } from 'lucide-react';
import { useGroupsStore } from '../stores/groups';
import { GroupCard } from '../components/groups/GroupCard';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardGrid } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';

export function GroupsPage() {
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
            title="群组管理"
            subtitle={`${groupsArray.length} 个已注册群组`}
          />
        </div>

        {loading && (
          <SkeletonCardGrid />
        )}

        {!loading && groupsArray.length === 0 && (
          <EmptyState
            icon={Users}
            title="暂无群组"
            description="当前没有已注册的群组"
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
