import type { Permission } from '../../stores/auth';
import type { MessageKey } from '../../i18n';

export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return fallback;
}

export function samePermissions(left: Permission[], right: Permission[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, idx) => value === b[idx]);
}

const PERMISSION_LABEL_KEYS: Record<Permission, MessageKey> = {
  manage_system_config: 'users.permissions.manage_system_config',
  manage_group_env: 'users.permissions.manage_group_env',
  manage_users: 'users.permissions.manage_users',
  manage_invites: 'users.permissions.manage_invites',
  view_audit_log: 'users.permissions.view_audit_log',
};

export function getPermissionLabel(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  permission: Permission,
): string {
  return t(PERMISSION_LABEL_KEYS[permission]);
}

export interface TabNotification {
  setNotice: (value: string | null) => void;
  setError: (value: string | null) => void;
}
