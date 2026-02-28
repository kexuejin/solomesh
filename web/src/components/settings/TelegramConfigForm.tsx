import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { TelegramConfigPublic, TelegramTestResult, SettingsNotification } from './types';
import { getErrorMessage, sourceLabel } from './types';

interface TelegramConfigFormProps extends SettingsNotification {}

export function TelegramConfigForm({ setNotice, setError }: TelegramConfigFormProps) {
  const [config, setConfig] = useState<TelegramConfigPublic | null>(null);
  const [botToken, setBotToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TelegramConfigPublic>('/api/config/telegram');
      setConfig(data);
      setBotToken('');
      setClearToken(false);
      setEnabled(data.enabled);
    } catch (err) {
      setError(getErrorMessage(err, '加载 Telegram 配置失败'));
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
      const saved = await api.put<TelegramConfigPublic>('/api/config/telegram', { enabled: newEnabled });
      setConfig(saved);
      setEnabled(saved.enabled);
      setNotice(`Telegram 渠道已${newEnabled ? '启用' : '停用'}${saved.connected ? '，连接正常' : ''}`);

    } catch (err) {
      setError(getErrorMessage(err, '切换 Telegram 渠道状态失败'));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { enabled };
      if (botToken.trim()) payload.botToken = botToken;
      if (!botToken.trim() && clearToken) payload.clearBotToken = true;

      const saved = await api.put<TelegramConfigPublic>('/api/config/telegram', payload);
      setConfig(saved);
      setBotToken('');
      setClearToken(false);
      setNotice(`Telegram 配置已保存${saved.connected ? '，连接正常' : ''}`);

    } catch (err) {
      setError(getErrorMessage(err, '保存 Telegram 配置失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<TelegramTestResult>('/api/config/telegram/test');
      if (result.success) {
        setNotice(`Telegram 连接测试成功：@${result.bot_username} (${result.bot_name})`);
      } else {
        setError(result.error || 'Telegram 连接失败');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Telegram 连接测试失败'));
    } finally {
      setTesting(false);
    }
  };

  const formDisabled = !enabled;
  const busy = loading || saving || testing || toggling;

  return (
    <div className="surface-card overflow-hidden">
      {/* 卡片头部 */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${config?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">通过 Telegram Bot 接收和回复消息</p>
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
            ariaLabel="切换 Telegram 渠道"
          />
        </div>
      </div>

      {/* 卡片内容 */}
      <div className={`px-5 py-4 space-y-4 transition-opacity ${formDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="rounded-lg bg-muted/10 p-3">
          <label className="mb-1 block text-xs font-medium text-foreground/80">
            Bot Token {config?.hasBotToken ? `(${config.botTokenMasked})` : ''}
          </label>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            disabled={loading || saving}
            placeholder={config?.hasBotToken ? '留空保持不变，输入新值覆盖' : '输入 Telegram Bot Token'}
            className="h-10 rounded-xl border-border/75 bg-card/95"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            在 Telegram 中搜索 @BotFather，发送 /newbot 创建机器人后获得（安全原因不会回显明文）
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearToken}
              onChange={(e) => setClearToken(e.target.checked)}
              disabled={saving}
            />
            清空现有 Token
          </label>
        </div>

        <SettingsActionBar>
          <Button variant="outline" onClick={loadConfig} disabled={busy} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '刷新中...' : '刷新'}
          </Button>
          <Button onClick={handleSave} disabled={busy} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? '保存中...' : '保存 Telegram 配置'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={busy || !config?.hasBotToken} className="h-10 rounded-xl">
            {testing && <Loader2 className="size-4 animate-spin" />}
            {testing ? '测试中...' : '测试连接'}
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
