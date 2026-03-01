import { useEffect, useMemo, useState } from 'react';
import { Copy, Key, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Permission, UserPublic } from '../../stores/auth';
import { useUsersStore, type PermissionTemplateKey } from '../../stores/users';
import { getErrorMessage, getPermissionLabel, type TabNotification } from './utils';
import { localeForDateTime, useI18n } from '../../i18n';

interface InviteCodesTabProps extends TabNotification {
  currentUser: UserPublic | null;
}

export function InviteCodesTab({ currentUser, setNotice, setError }: InviteCodesTabProps) {
  const { t, locale } = useI18n();
  const {
    invites,
    loading,
    permissions,
    templates,
    fetchPermissionMeta,
    fetchInvites,
    createInvite,
    deleteInvite,
  } = useUsersStore();

  const [showCreate, setShowCreate] = useState(false);
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteTemplate, setInviteTemplate] = useState<PermissionTemplateKey | ''>('member_basic');
  const [invitePermissions, setInvitePermissions] = useState<Permission[]>([]);
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteExpiresHours, setInviteExpiresHours] = useState(0);
  const [creating, setCreating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const isAdmin = currentUser?.role === 'admin';
  const ownPermissions = currentUser?.permissions || [];
  const assignablePermissions = useMemo(() => {
    if (isAdmin) return permissions;
    const ownSet = new Set(ownPermissions);
    return permissions.filter((perm) => ownSet.has(perm));
  }, [isAdmin, ownPermissions, permissions]);
  const availableTemplates = useMemo(
    () =>
      templates.filter((item) => {
        if (item.role === 'admin' && !isAdmin) return false;
        if (isAdmin) return true;
        return item.permissions.every((perm) => ownPermissions.includes(perm));
      }),
    [isAdmin, ownPermissions, templates],
  );

  useEffect(() => {
    void fetchPermissionMeta();
    void fetchInvites();
  }, [fetchInvites, fetchPermissionMeta]);

  useEffect(() => {
    if (!inviteTemplate) return;
    const allowed = availableTemplates.some((item) => item.key === inviteTemplate);
    if (!allowed) setInviteTemplate('');
  }, [availableTemplates, inviteTemplate]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const roleForCreate: 'member' | 'admin' = isAdmin ? inviteRole : 'member';
      const permissionsForCreate = isAdmin
        ? invitePermissions
        : invitePermissions.filter((perm) => ownPermissions.includes(perm));
      const templateForCreate = inviteTemplate
        ? availableTemplates.find((item) => item.key === inviteTemplate)?.key
        : undefined;
      const payload = {
        role: roleForCreate,
        permission_template: templateForCreate,
        permissions: permissionsForCreate,
        max_uses: inviteMaxUses,
        expires_in_hours: inviteExpiresHours > 0 ? inviteExpiresHours : undefined,
      };
      const code = await createInvite(payload);
      setGeneratedCode(code);
      setNotice(t('users.invites.notice.created'));
      await fetchInvites();
    } catch (err) {
      setError(getErrorMessage(err, t('users.invites.errors.createFailed')));
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => setNotice(t('users.invites.notice.copied')));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          className="h-10 rounded-xl px-4"
          onClick={() => {
            setShowCreate((v) => !v);
            setGeneratedCode(null);
          }}
        >
          <Key className="w-4 h-4" />
          {t('users.invites.create')}
        </Button>
        <Button
          variant="outline"
          className="h-10 rounded-xl border-border/75 px-4"
          onClick={() => fetchInvites()}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('users.invites.refresh')}
        </Button>
      </div>

      {showCreate && (
        <div className="space-y-4 rounded-xl border border-border/70 bg-card/95 p-5 md:p-6">
          <h3 className="text-sm font-medium text-foreground">{t('users.invites.createTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              value={inviteTemplate}
              onValueChange={(value) => {
                const v = value === 'none' ? '' : value as PermissionTemplateKey;
                setInviteTemplate(v as PermissionTemplateKey | '');
                if (!v) return;
                const template = availableTemplates.find((item) => item.key === v);
                if (!template) return;
                setInviteRole(template.role);
                setInvitePermissions(template.permissions);
              }}
            >
              <SelectTrigger className="h-10 rounded-xl border-border/75 bg-card/95 text-sm">
                <SelectValue placeholder={t('users.invites.noTemplate')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('users.invites.noTemplate')}</SelectItem>
                {availableTemplates.map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as 'member' | 'admin')}>
              <SelectTrigger className="h-10 rounded-xl border-border/75 bg-card/95 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t('users.userList.filter.roleMember')}</SelectItem>
                {isAdmin && <SelectItem value="admin">{t('users.userList.filter.roleAdmin')}</SelectItem>}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={inviteMaxUses}
              onChange={(e) => setInviteMaxUses(parseInt(e.target.value, 10) || 0)}
              min={0}
              max={1000}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
              placeholder={t('users.invites.maxUses')}
            />
            <Input
              type="number"
              value={inviteExpiresHours}
              onChange={(e) => setInviteExpiresHours(parseInt(e.target.value, 10) || 0)}
              min={0}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm md:col-span-3"
              placeholder={t('users.invites.expiresHours')}
            />
          </div>

          {assignablePermissions.length > 0 && (
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/70 bg-muted/25 p-3 md:grid-cols-2">
              {assignablePermissions.map((perm) => (
                <label
                  key={perm}
                  className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-card/90 px-2.5 py-2 text-xs text-foreground/85"
                >
                  <input
                    type="checkbox"
                    checked={invitePermissions.includes(perm)}
                    onChange={() => {
                      if (invitePermissions.includes(perm)) {
                        setInvitePermissions(invitePermissions.filter((item) => item !== perm));
                      } else {
                        setInvitePermissions([...invitePermissions, perm]);
                      }
                    }}
                  />
                  {getPermissionLabel(t, perm) || perm}
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button className="h-10 rounded-xl px-4" onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('users.invites.generate')}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-border/75 px-4"
              onClick={() => setShowCreate(false)}
            >
              {t('users.invites.cancel')}
            </Button>
          </div>

          {generatedCode && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5">
              <div className="mb-1 text-xs text-emerald-700">{t('users.invites.generatedHint')}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded-lg border border-emerald-200/85 bg-card px-2.5 py-1.5 font-mono text-sm text-foreground/90">
                  {generatedCode}
                </code>
                <button
                  onClick={() => copyToClipboard(generatedCode)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200/80 text-emerald-700 transition-colors hover:bg-emerald-100 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/70">
        {invites.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('users.invites.empty')}</div>
        ) : (
          invites.map((invite) => {
            const isExpired = invite.expires_at && new Date(invite.expires_at).getTime() < Date.now();
            const isUsedUp = invite.max_uses > 0 && invite.used_count >= invite.max_uses;
            return (
              <div key={invite.code} className="flex items-center justify-between gap-3 px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono text-foreground/80">{invite.code.slice(0, 12)}...</code>
                    <button
                      onClick={() => copyToClipboard(invite.code)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted/60 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <span className="rounded-lg border border-border/70 bg-muted/60 px-1.5 py-0.5 text-xs text-foreground/85">
                      {invite.role}
                    </span>
                    {invite.permission_template && (
                      <span className="rounded-lg border border-brand-200/70 bg-brand-50/80 px-1.5 py-0.5 text-xs text-primary">
                        {invite.permission_template}
                      </span>
                    )}
                    {isExpired && (
                      <span className="rounded-lg border border-red-200/80 bg-red-50 px-1.5 py-0.5 text-xs text-red-600">
                        {t('users.invites.expired')}
                      </span>
                    )}
                    {isUsedUp && (
                      <span className="rounded-lg border border-orange-200/80 bg-orange-50 px-1.5 py-0.5 text-xs text-orange-600">
                        {t('users.invites.usedUp')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('users.invites.creator', { value: invite.creator_username })} · {t('users.invites.usage', {
                      used: invite.used_count,
                      max: invite.max_uses || '∞',
                    })}
                    {invite.expires_at &&
                      ` · ${t('users.invites.expiresAt', {
                        value: new Date(invite.expires_at).toLocaleString(localeForDateTime(locale)),
                      })}`}
                  </div>
                  {invite.permissions.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">{t('users.invites.permissions', {
                      value: invite.permissions.join(', '),
                    })}</div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(t('users.invites.confirmDelete'))) return;
                    try {
                      await deleteInvite(invite.code);
                      setNotice(t('users.invites.notice.deleted'));
                      await fetchInvites();
                    } catch (err) {
                      setError(getErrorMessage(err, t('users.invites.errors.deleteFailed')));
                    }
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                  title={t('users.invites.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
