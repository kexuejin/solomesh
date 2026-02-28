import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';

interface RegistrationSectionProps extends SettingsNotification {}

export function RegistrationSection({ setNotice, setError }: RegistrationSectionProps) {
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [requireInviteCode, setRequireInviteCode] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ allowRegistration: boolean; requireInviteCode: boolean; updatedAt: string | null }>('/api/config/registration');
      setAllowRegistration(data.allowRegistration);
      setRequireInviteCode(data.requireInviteCode);
      setUpdatedAt(data.updatedAt);
    } catch {
      // ignore — keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = useCallback(async (allow: boolean, invite: boolean) => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const data = await api.put<{ allowRegistration: boolean; requireInviteCode: boolean; updatedAt: string | null }>('/api/config/registration', {
        allowRegistration: allow,
        requireInviteCode: invite,
      });
      setAllowRegistration(data.allowRegistration);
      setRequireInviteCode(data.requireInviteCode);
      setUpdatedAt(data.updatedAt);
      setNotice('注册策略已保存');
    } catch (err) {
      setError(getErrorMessage(err, '保存注册配置失败'));
    } finally {
      setSaving(false);
    }
  }, [setNotice, setError]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        控制系统注册入口与邀请码策略。开关变更后会立即保存并生效。
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">注册策略</div>
          <div className="mt-1 text-sm font-medium text-foreground">入口与准入控制</div>
        </div>

        <div className="space-y-3 px-4 py-4">
          {saving && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              保存中...
            </div>
          )}

          <div className="rounded-lg flex items-center justify-between gap-4 bg-muted/10 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-foreground">允许注册</div>
              <div className="mt-0.5 text-xs text-muted-foreground">关闭后注册入口不可用</div>
            </div>
            <SettingsSwitch
              checked={allowRegistration}
              disabled={saving}
              onCheckedChange={(next) => saveConfig(next, requireInviteCode)}
              ariaLabel="切换是否允许注册"
            />
          </div>

          <div className="rounded-lg flex items-center justify-between gap-4 bg-muted/10 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-foreground">需要邀请码</div>
              <div className="mt-0.5 text-xs text-muted-foreground">关闭后任何人可直接注册</div>
            </div>
            <SettingsSwitch
              checked={requireInviteCode}
              disabled={saving}
              onCheckedChange={(next) => saveConfig(allowRegistration, next)}
              ariaLabel="切换是否需要邀请码"
            />
          </div>

          <SettingsMetaGrid
            columns={1}
            items={[
              {
                label: '最近保存',
                value: updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '未记录',
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
