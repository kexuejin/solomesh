import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { useAuthStore } from '../stores/auth';
import { UserListTab } from '../components/users/UserListTab';
import { InviteCodesTab } from '../components/users/InviteCodesTab';
import { AuditLogTab } from '../components/users/AuditLogTab';
import { useI18n } from '../i18n';

type Tab = 'users' | 'invites' | 'audit';

export function UsersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('users');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentUser = useAuthStore((s) => s.user);

  const canManageUsers =
    currentUser?.role === 'admin' || !!currentUser?.permissions.includes('manage_users');
  const canManageInvites =
    currentUser?.role === 'admin' || !!currentUser?.permissions.includes('manage_invites');
  const canViewAudit =
    currentUser?.role === 'admin' || !!currentUser?.permissions.includes('view_audit_log');

  const tabs = useMemo(() => {
    const list: Array<{ key: Tab; label: string; visible: boolean }> = [
      { key: 'users', label: t('users.page.tabs.users'), visible: canManageUsers },
      { key: 'invites', label: t('users.page.tabs.invites'), visible: canManageInvites },
      { key: 'audit', label: t('users.page.tabs.audit'), visible: canViewAudit },
    ];
    return list.filter((item) => item.visible);
  }, [canManageInvites, canManageUsers, canViewAudit, t]);

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((item) => item.key === tab)) {
      setTab(tabs[0].key);
    }
  }, [tab, tabs]);

  if (tabs.length === 0) {
    return (
      <div className="min-h-full app-canvas p-4 lg:p-8">
        <div className="mx-auto max-w-3xl surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-8 text-sm text-muted-foreground">
          {t('users.page.noPermission')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full app-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title={t('users.page.title')}
          subtitle={t('users.page.subtitle')}
        />

        {(notice || error) && (
          <div className="space-y-2">
            {notice && (
              <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
                {notice}
              </div>
            )}
            {error && (
              <div className="surface-card-soft rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                tab === item.key
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'users' && canManageUsers && (
          <UserListTab currentUser={currentUser} setNotice={setNotice} setError={setError} />
        )}
        {tab === 'invites' && canManageInvites && (
          <InviteCodesTab currentUser={currentUser} setNotice={setNotice} setError={setError} />
        )}
        {tab === 'audit' && canViewAudit && <AuditLogTab setError={setError} />}
      </div>
    </div>
  );
}
