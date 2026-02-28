import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SettingsActionBar } from './SettingsActionBar';
import type { SettingsNotification, SystemSettings } from './types';
import { getErrorMessage } from './types';

interface SystemSettingsSectionProps extends SettingsNotification {}

interface FieldConfig {
  key: keyof SystemSettings;
  label: string;
  description: string;
  unit: string;
  /** Convert stored value to display value */
  toDisplay: (v: number) => number;
  /** Convert display value to stored value */
  toStored: (v: number) => number;
  min: number;
  max: number;
  step: number;
}

const fields: FieldConfig[] = [
  {
    key: 'containerTimeout',
    label: '容器最大运行时间',
    description: '单个容器/进程的最长运行时间',
    unit: '分钟',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'idleTimeout',
    label: '容器空闲超时',
    description: '最后一次输出后无新消息则关闭容器',
    unit: '分钟',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'containerMaxOutputSize',
    label: '单次输出上限',
    description: '单次容器运行的最大输出大小',
    unit: 'MB',
    toDisplay: (v) => Math.round(v / 1048576),
    toStored: (v) => v * 1048576,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'maxConcurrentContainers',
    label: '最大并发容器数',
    description: '同时运行的 Docker 容器数量上限',
    unit: '个',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'maxConcurrentHostProcesses',
    label: '最大并发宿主机进程数',
    description: '同时运行的宿主机模式进程数量上限',
    unit: '个',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 50,
    step: 1,
  },
  {
    key: 'maxLoginAttempts',
    label: '登录失败锁定次数',
    description: '连续失败该次数后锁定账户',
    unit: '次',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'loginLockoutMinutes',
    label: '锁定时间',
    description: '账户被锁定后的等待时间',
    unit: '分钟',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 1440,
    step: 1,
  },
];

export function SystemSettingsSection({ setNotice, setError }: SystemSettingsSectionProps) {
  const { hasPermission } = useAuthStore();

  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [displayValues, setDisplayValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission('manage_system_config');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<SystemSettings>('/api/config/system');
        setSettings(data);
        const display: Record<string, number> = {};
        for (const f of fields) {
          display[f.key] = f.toDisplay(data[f.key]);
        }
        setDisplayValues(display);
      } catch (err) {
        setError(getErrorMessage(err, '加载系统参数失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, [setError]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Partial<SystemSettings> = {};
      for (const f of fields) {
        const val = displayValues[f.key];
        if (val !== undefined) {
          (payload as Record<string, number>)[f.key] = f.toStored(val);
        }
      }
      const data = await api.put<SystemSettings>('/api/config/system', payload);
      setSettings(data);
      const display: Record<string, number> = {};
      for (const f of fields) {
        display[f.key] = f.toDisplay(data[f.key]);
      }
      setDisplayValues(display);
      setNotice('系统参数已保存，新的容器/进程将使用最新配置');
    } catch (err) {
      setError(getErrorMessage(err, '保存系统参数失败'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManage) {
    return <div className="text-sm text-muted-foreground">需要系统配置权限才能修改系统参数。</div>;
  }

  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        调整容器运行参数和安全限制。修改后无需重启，新参数对后续创建的容器/进程立即生效。
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">系统参数</div>
          <div className="mt-1 text-sm font-medium text-foreground">资源与安全限制</div>
        </div>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="surface-card-soft rounded-xl space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="block text-sm font-medium text-foreground">{f.label}</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={displayValues[f.key] ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDisplayValues((prev) => ({
                    ...prev,
                    [f.key]: Number.isFinite(val) ? val : 0,
                  }));
                }}
                min={f.min}
                max={f.max}
                step={f.step}
                className="h-10 max-w-32 rounded-xl border-border/75 bg-card/95"
              />
              <span className="text-xs text-muted-foreground">{f.unit}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {f.description}（范围：{f.min} - {f.max} {f.unit}）
            </p>
          </div>
        ))}
        </div>
        <div className="px-4 pb-4">
          <SettingsActionBar>
            <Button onClick={handleSave} disabled={saving} className="h-10 rounded-xl">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? '保存中...' : '保存系统参数'}
            </Button>
          </SettingsActionBar>
        </div>
      </section>
    </div>
  );
}
