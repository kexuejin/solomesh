import { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  UserPlus,
} from 'lucide-react';
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
import { useUsersStore, type UserQuery } from '../../stores/users';
import { getErrorMessage, samePermissions, getPermissionLabel, type TabNotification } from './utils';
import { localeForDateTime, useI18n } from '../../i18n';

interface UserListTabProps extends TabNotification {
  currentUser: UserPublic | null;
}

export function UserListTab({ currentUser, setNotice, setError }: UserListTabProps) {
  const { t, locale } = useI18n();
  const {
    users,
    totalUsers,
    page,
    pageSize,
    loading,
    permissions,
    templates,
    fetchPermissionMeta,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    restoreUser,
    revokeUserSessions,
  } = useUsersStore();

  const [query, setQuery] = useState<UserQuery>({ q: '', role: 'all', status: 'all', page: 1, pageSize: 20 });
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [newMustChange, setNewMustChange] = useState(true);
  const [newNotes, setNewNotes] = useState('');
  const [newPermissions, setNewPermissions] = useState<Permission[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<'admin' | 'member'>('member');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPermissions, setEditPermissions] = useState<Permission[]>([]);
  const [editDisableReason, setEditDisableReason] = useState('');
  const [changingPasswordId, setChangingPasswordId] = useState<string | null>(null);
  const [changePasswordValue, setChangePasswordValue] = useState('');
  const [changingPasswordLoading, setChangingPasswordLoading] = useState(false);
  const isAdmin = currentUser?.role === 'admin';
  const ownPermissions = currentUser?.permissions || [];
  const canOperateTargetUser = (user: UserPublic) => isAdmin || user.role !== 'admin';
  const assignablePermissions = useMemo(() => {
    if (isAdmin) return permissions;
    const ownSet = new Set(ownPermissions);
    return permissions.filter((perm) => ownSet.has(perm));
  }, [isAdmin, ownPermissions, permissions]);

  useEffect(() => {
    void fetchPermissionMeta();
  }, [fetchPermissionMeta]);

  useEffect(() => {
    void fetchUsers(query);
  }, [fetchUsers, query]);

  const applyQuery = (next: Partial<UserQuery>) => {
    setQuery((prev) => ({ ...prev, ...next }));
  };

  const togglePermission = (
    list: Permission[],
    setList: (value: Permission[]) => void,
    permission: Permission,
  ) => {
    if (list.includes(permission)) {
      setList(list.filter((item) => item !== permission));
    } else {
      setList([...list, permission]);
    }
  };

  const handleChangePassword = async (user: UserPublic) => {
    if (!changePasswordValue.trim()) {
      setError(t('users.userList.errors.newPasswordRequired'));
      return;
    }
    setChangingPasswordLoading(true);
    setError(null);
    try {
      await updateUser(user.id, { password: changePasswordValue });
      setNotice(t('users.userList.notice.passwordReset', { user: user.display_name || user.username }));
      setChangingPasswordId(null);
      setChangePasswordValue('');
      void fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.passwordUpdateFailed')));
    } finally {
      setChangingPasswordLoading(false);
    }
  };

  const startEdit = (user: UserPublic) => {
    if (!canOperateTargetUser(user)) {
      setError(t('users.userList.errors.cannotEditAdmin'));
      return;
    }
    setChangingPasswordId(null);
    setChangePasswordValue('');
    setEditingId(user.id);
    setEditRole(user.role);
    setEditDisplayName(user.display_name || '');
    setEditPassword('');
    setEditNotes(user.notes || '');
    setEditPermissions(user.permissions || []);
    setEditDisableReason(user.disable_reason || '');
  };

  const submitEdit = async (user: UserPublic) => {
    setError(null);
    try {
      const payload: Parameters<typeof updateUser>[1] = {};
      if (isAdmin && editRole !== user.role) {
        payload.role = editRole;
      }
      if (editDisplayName !== (user.display_name || '')) {
        payload.display_name = editDisplayName;
      }
      if (editPassword.trim()) {
        payload.password = editPassword;
      }
      const nextNotes = editNotes.trim();
      const currentNotes = user.notes || '';
      if (nextNotes !== currentNotes) {
        payload.notes = nextNotes || null;
      }
      if (!samePermissions(editPermissions, user.permissions || [])) {
        payload.permissions = isAdmin
          ? editPermissions
          : editPermissions.filter((perm) => ownPermissions.includes(perm));
      }
      const nextDisableReason = editDisableReason.trim();
      const currentDisableReason = user.disable_reason || '';
      if (nextDisableReason !== currentDisableReason) {
        payload.disable_reason = nextDisableReason || null;
      }
      if (Object.keys(payload).length === 0) {
        setNotice(t('users.userList.notice.noChanges'));
        setEditingId(null);
        return;
      }

      await updateUser(user.id, payload);
      setNotice(t('users.userList.notice.userUpdated', { user: user.username }));
      setEditingId(null);
      await fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.updateUserFailed')));
    }
  };

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword) {
      setError(t('users.userList.errors.usernamePasswordRequired'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const roleForCreate: 'admin' | 'member' = isAdmin ? newRole : 'member';
      const permissionsForCreate = isAdmin
        ? newPermissions
        : newPermissions.filter((perm) => ownPermissions.includes(perm));
      await createUser({
        username: newUsername.trim(),
        password: newPassword,
        display_name: newDisplayName.trim() || undefined,
        role: roleForCreate,
        permissions: permissionsForCreate,
        must_change_password: newMustChange,
        notes: newNotes.trim() || undefined,
      });
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('member');
      setNewMustChange(true);
      setNewNotes('');
      setNewPermissions([]);
      setShowCreate(false);
      setNotice(t('users.userList.notice.userCreated'));
      await fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.createUserFailed')));
    } finally {
      setCreating(false);
    }
  };

  const changeStatus = async (user: UserPublic, status: 'active' | 'disabled' | 'deleted') => {
    try {
      await updateUser(user.id, {
        status,
        disable_reason: status === 'disabled' ? user.disable_reason || 'disabled_by_admin' : null,
      });
      setNotice(t('users.userList.notice.userStatusUpdated', { user: user.username }));
      await fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.updateStatusFailed')));
    }
  };

  const handleDelete = async (user: UserPublic) => {
    if (!confirm(t('users.userList.confirm.deleteUser', { user: user.username }))) return;
    try {
      await deleteUser(user.id);
      setNotice(t('users.userList.notice.userDeleted', { user: user.username }));
      await fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.deleteFailed')));
    }
  };

  const handleRestore = async (user: UserPublic) => {
    try {
      await restoreUser(user.id);
      setNotice(t('users.userList.notice.userRestoredDisabled', { user: user.username }));
      await fetchUsers(query);
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.restoreFailed')));
    }
  };

  const handleRevokeAll = async (user: UserPublic) => {
    if (!confirm(t('users.userList.confirm.revokeAll', { user: user.username }))) return;
    try {
      await revokeUserSessions(user.id);
      setNotice(t('users.userList.notice.sessionsRevoked', { user: user.username }));
    } catch (err) {
      setError(getErrorMessage(err, t('users.userList.errors.actionFailed')));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          type="text"
          value={query.q || ''}
          onChange={(e) => applyQuery({ q: e.target.value, page: 1 })}
          placeholder={t('users.userList.searchPlaceholder')}
          className="h-10 w-full rounded-xl border-border/75 bg-card/95 sm:w-64"
        />
        <Select value={query.role || 'all'} onValueChange={(value) => applyQuery({ role: value as UserQuery['role'], page: 1 })}>
          <SelectTrigger className="h-10 w-auto rounded-xl border-border/75 bg-card/95 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('users.userList.filter.roleAll')}</SelectItem>
            <SelectItem value="admin">{t('users.userList.filter.roleAdmin')}</SelectItem>
            <SelectItem value="member">{t('users.userList.filter.roleMember')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={query.status || 'all'} onValueChange={(value) => applyQuery({ status: value as UserQuery['status'], page: 1 })}>
          <SelectTrigger className="h-10 w-auto rounded-xl border-border/75 bg-card/95 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('users.userList.filter.statusAll')}</SelectItem>
            <SelectItem value="active">{t('users.userList.filter.statusActive')}</SelectItem>
            <SelectItem value="disabled">{t('users.userList.filter.statusDisabled')}</SelectItem>
            <SelectItem value="deleted">{t('users.userList.filter.statusDeleted')}</SelectItem>
          </SelectContent>
        </Select>
        <Button className="h-10 rounded-xl px-4" onClick={() => setShowCreate((v) => !v)}>
          <UserPlus className="w-4 h-4" />
          {t('users.userList.createUser')}
        </Button>
        <Button
          variant="outline"
          className="h-10 rounded-xl border-border/75 px-4"
          onClick={() => fetchUsers(query)}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('users.userList.refresh')}
        </Button>
      </div>

      {showCreate && (
        <div className="space-y-4 rounded-xl border border-border/70 bg-card/95 p-5 md:p-6">
          <h3 className="text-sm font-medium text-foreground">{t('users.userList.createTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder={t('users.userList.username')}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
            />
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('users.userList.passwordPlaceholder')}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
            />
            <Input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder={t('users.userList.displayNameOptional')}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
            />
            <Select value={newRole} onValueChange={(value) => setNewRole(value as 'admin' | 'member')}>
              <SelectTrigger className="h-10 rounded-xl border-border/75 bg-card/95 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t('users.userList.filter.roleMember')}</SelectItem>
                {isAdmin && <SelectItem value="admin">{t('users.userList.filter.roleAdmin')}</SelectItem>}
              </SelectContent>
            </Select>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={newMustChange}
                onChange={(e) => setNewMustChange(e.target.checked)}
              />
              {t('users.userList.mustChangePassword')}
            </label>
            <Input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder={t('users.userList.notesOptional')}
              className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
            />
          </div>

          {templates.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">{t('users.userList.quickTemplates')}</div>
              <div className="flex flex-wrap gap-2">
                {templates
                  .filter((item) => isAdmin || item.role !== 'admin')
                  .map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setNewRole(item.role);
                      setNewPermissions(item.permissions);
                    }}
                    className="rounded-lg border border-border/75 bg-card/90 px-2.5 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted/55 cursor-pointer"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {assignablePermissions.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
              <div className="text-xs text-muted-foreground mb-1">{t('users.userList.permissionDetail')}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {assignablePermissions.map((perm) => (
                  <label
                    key={perm}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-card/90 px-2.5 py-2 text-xs text-foreground/85"
                  >
                    <input
                      type="checkbox"
                      checked={newPermissions.includes(perm)}
                      onChange={() => togglePermission(newPermissions, setNewPermissions, perm)}
                    />
                    {getPermissionLabel(t, perm) || perm}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button className="h-10 rounded-xl px-4" onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('users.userList.create')}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-border/75 px-4"
              onClick={() => setShowCreate(false)}
            >
              {t('users.userList.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/70">
        {users.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('users.userList.empty')}</div>
        ) : (
          users.map((user) => (
            <div key={user.id} className="px-5 py-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{user.display_name || user.username}</span>
                    <span className="text-xs text-muted-foreground">@{user.username}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      user.role === 'admin'
                        ? 'border border-brand-200/80 bg-brand-50/80 text-primary'
                        : 'border border-border/70 bg-muted/60 text-foreground/85'
                    }`}>
                      {user.role}
                    </span>
                    {user.status !== 'active' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        user.status === 'deleted'
                          ? 'border border-rose-200/85 bg-rose-50 text-rose-700'
                          : 'border border-amber-200/85 bg-amber-50 text-amber-700'
                      }`}>
                        {user.status}
                      </span>
                    )}
                    {user.must_change_password && (
                      <span className="rounded-lg border border-indigo-200/80 bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                        {t('users.userList.mustChangeTag')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('users.userList.lastLogin', {
                      value: user.last_login_at ? new Date(user.last_login_at).toLocaleString(localeForDateTime(locale)) : '-',
                    })}{' '}
                    ·{' '}
                    {t('users.userList.lastActive', {
                      value: user.last_active_at ? new Date(user.last_active_at).toLocaleString(localeForDateTime(locale)) : '-',
                    })}
                  </div>
                  {user.notes && <div className="text-xs text-muted-foreground mt-1">{t('users.userList.notes', { value: user.notes })}</div>}
                  {user.disable_reason && <div className="text-xs text-amber-600 mt-1">{t('users.userList.disableReason', { value: user.disable_reason })}</div>}
                </div>

                {canOperateTargetUser(user) && (
                  <div className="flex items-center gap-1">
                    {isAdmin && (
                      <button
                        onClick={() => {
                          const opening = changingPasswordId !== user.id;
                          setChangingPasswordId(opening ? user.id : null);
                          setChangePasswordValue('');
                        if (opening) setEditingId(null);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-indigo-200/85 hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer"
                        title={t('users.userList.action.changePassword')}
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    )}
                    {user.id !== currentUser?.id && (
                      <>
                        <button
                          onClick={() => startEdit(user)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/60 hover:text-foreground/80 cursor-pointer"
                          title={t('users.userList.action.edit')}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {user.status === 'active' ? (
                          <button
                            onClick={() => changeStatus(user, 'disabled')}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-amber-200/85 hover:bg-amber-50 hover:text-amber-700 cursor-pointer"
                            title={t('users.userList.action.disable')}
                          >
                            <ShieldOff className="w-4 h-4" />
                          </button>
                        ) : user.status === 'disabled' ? (
                          <button
                            onClick={() => changeStatus(user, 'active')}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-brand-200/80 hover:bg-brand-50/75 hover:text-primary cursor-pointer"
                            title={t('users.userList.action.enable')}
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRestore(user)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-brand-200/80 hover:bg-brand-50/75 hover:text-primary cursor-pointer"
                            title={t('users.userList.action.restore')}
                          >
                            <Undo2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRevokeAll(user)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-orange-200/85 hover:bg-orange-50 hover:text-orange-600 cursor-pointer"
                          title={t('users.userList.action.revokeSessions')}
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-red-200/85 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                          title={t('users.userList.action.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {changingPasswordId === user.id && (
                <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3.5">
                  <KeyRound className="w-4 h-4 text-indigo-500 shrink-0" />
                  <Input
                    type="password"
                    value={changePasswordValue}
                    onChange={(e) => setChangePasswordValue(e.target.value)}
                    placeholder={t('users.userList.newPassword')}
                    className="h-10 flex-1 rounded-xl border-indigo-200/80 bg-card/95 text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleChangePassword(user)}
                  />
                  <Button
                    size="sm"
                    className="h-9 rounded-xl px-3"
                    onClick={() => handleChangePassword(user)}
                    disabled={changingPasswordLoading}
                  >
                    {changingPasswordLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('users.userList.confirmButton')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl border-indigo-200/80 px-3"
                    onClick={() => { setChangingPasswordId(null); setChangePasswordValue(''); }}
                  >
                    {t('users.userList.cancel')}
                  </Button>
                </div>
              )}

              {editingId === user.id && (
                <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input
                      type="text"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      placeholder={t('users.userList.displayName')}
                      className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
                    />
                    {isAdmin ? (
                      <Select value={editRole} onValueChange={(value) => setEditRole(value as 'admin' | 'member')}>
                        <SelectTrigger className="h-10 rounded-xl border-border/75 bg-card/95 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{t('users.userList.filter.roleMember')}</SelectItem>
                          <SelectItem value="admin">{t('users.userList.filter.roleAdmin')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type="text"
                        value={user.role}
                        disabled
                        className="h-10 rounded-xl border-border/60 bg-muted/60 text-sm text-muted-foreground"
                      />
                    )}
                    <Input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder={t('users.userList.resetPasswordOptional')}
                      className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
                    />
                    <Input
                      type="text"
                      value={editDisableReason}
                      onChange={(e) => setEditDisableReason(e.target.value)}
                      placeholder={t('users.userList.disableReasonOptional')}
                      className="h-10 rounded-xl border-border/75 bg-card/95 text-sm"
                    />
                    <Input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder={t('users.userList.notesOptional')}
                      className="h-10 rounded-xl border-border/75 bg-card/95 text-sm md:col-span-2"
                    />
                  </div>
                  {assignablePermissions.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {assignablePermissions.map((perm) => (
                        <label
                          key={perm}
                          className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-card/90 px-2.5 py-2 text-xs text-foreground/85"
                        >
                          <input
                            type="checkbox"
                            checked={editPermissions.includes(perm)}
                            onChange={() => togglePermission(editPermissions, setEditPermissions, perm)}
                          />
                          {getPermissionLabel(t, perm) || perm}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button className="h-10 rounded-xl px-4" onClick={() => submitEdit(user)}>{t('users.userList.save')}</Button>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-border/75 px-4"
                      onClick={() => setEditingId(null)}
                    >
                      {t('users.userList.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>{t('users.userList.total', { count: totalUsers })}</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 rounded-xl border-border/75 px-3"
            onClick={() => applyQuery({ page: Math.max(1, (query.page || 1) - 1) })}
            disabled={(query.page || 1) <= 1}
          >
            {t('users.userList.prevPage')}
          </Button>
          <span>{t('users.userList.page', { page })}</span>
          <Button
            variant="outline"
            className="h-9 rounded-xl border-border/75 px-3"
            onClick={() => applyQuery({ page: (query.page || 1) + 1 })}
            disabled={page * pageSize >= totalUsers}
          >
            {t('users.userList.nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
}
