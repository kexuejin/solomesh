import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { FeishuConfigPublic, SettingsNotification } from './types';
import { getErrorMessage, sourceLabel } from './types';

interface FeishuConfigFormProps extends SettingsNotification {}

export function FeishuConfigForm({ setNotice, setError }: FeishuConfigFormProps) {
  const [config, setConfig] = useState<FeishuConfigPublic | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<FeishuConfigPublic>('/api/config/feishu');
      setConfig(data);
      setAppId(data.appId || '');
      setAppSecret('');
      setClearSecret(false);
      setEnabled(data.enabled);
    } catch (err) {
      setError(getErrorMessage(err, '加载飞书配置失败'));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleToggle = async (newEnabled: boolean) => {
    setToggling(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api.put<FeishuConfigPublic>('/api/config/feishu', { enabled: newEnabled });
      setConfig(saved);
      setEnabled(saved.enabled);
      setNotice(`飞书渠道已${newEnabled ? '启用' : '停用'}${saved.connected ? '，连接正常' : ''}`);

    } catch (err) {
      setError(getErrorMessage(err, '切换飞书渠道状态失败'));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { appId, enabled };
      if (appSecret.trim()) payload.appSecret = appSecret;
      if (!appSecret.trim() && clearSecret) payload.clearAppSecret = true;

      const saved = await api.put<FeishuConfigPublic>('/api/config/feishu', payload);
      setConfig(saved);
      setAppSecret('');
      setClearSecret(false);
      setNotice(`飞书配置已保存${saved.connected ? '，连接正常' : ''}`);

    } catch (err) {
      setError(getErrorMessage(err, '保存飞书配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = !enabled;
  const busy = loading || saving || toggling;

  return (
    <div className="surface-card overflow-hidden">
      {/* 卡片头部 */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${config?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">飞书 Feishu</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">接收飞书群消息并通过 Agent 自动回复</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            config?.connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-border/70 bg-card/75 text-muted-foreground'
          }`}>
            {config?.connected ? '已连接' : '未连接'}
          </span>
          <SettingsSwitch
            checked={enabled}
            disabled={busy}
            onCheckedChange={handleToggle}
            ariaLabel="切换飞书渠道"
          />
        </div>
      </div>

      {/* 卡片内容 */}
      <div className={`px-5 py-4 space-y-4 transition-opacity ${formDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/10 p-3">
            <label className="mb-1 block text-xs font-medium text-foreground/80">App ID</label>
            <Input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              disabled={loading || saving}
              placeholder="cli_xxx"
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="mt-1 text-xs text-muted-foreground">在飞书开放平台 → 应用管理 → 凭证与基础信息中获取</p>
          </div>

          <div className="rounded-lg bg-muted/10 p-3">
            <label className="mb-1 block text-xs font-medium text-foreground/80">
              App Secret {config?.hasAppSecret ? `(${config.appSecretMasked})` : ''}
            </label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              disabled={loading || saving}
              placeholder={config?.hasAppSecret ? '留空保持不变，输入新值覆盖' : '输入飞书 App Secret'}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              应用密钥，与 App ID 在同一页面获取（安全原因不会回显明文）
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearSecret}
                onChange={(e) => setClearSecret(e.target.checked)}
                disabled={saving}
              />
              清空现有 Secret
            </label>
          </div>
        </div>

        <SettingsActionBar>
          <Button variant="outline" onClick={loadConfig} disabled={busy} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '刷新中...' : '刷新'}
          </Button>
          <Button onClick={handleSave} disabled={busy} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? '保存中...' : '保存飞书配置'}
          </Button>
        </SettingsActionBar>

        <SettingsMetaGrid
          items={[
            { label: '当前来源', value: sourceLabel(config?.source || 'none') },
            {
              label: '最近保存',
              value: config?.updatedAt ? new Date(config.updatedAt).toLocaleString('zh-CN') : '未记录',
            },
          ]}
        />
      </div>
    </div>
  );
}
