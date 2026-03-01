import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SettingsActionBar } from './SettingsActionBar';
import type { SettingsNotification, SystemSettings } from './types';
import { getErrorMessage } from './types';
import { useI18n, type MessageKey } from '../../i18n';

interface SystemSettingsSectionProps extends SettingsNotification {}

interface FieldConfig {
  key: keyof SystemSettings;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  unitKey: MessageKey;
  toDisplay: (v: number) => number;
  toStored: (v: number) => number;
  min: number;
  max: number;
  step: number;
}

const fields: FieldConfig[] = [
  {
    key: 'containerTimeout',
    labelKey: 'settings.system.fields.containerTimeout.label',
    descriptionKey: 'settings.system.fields.containerTimeout.description',
    unitKey: 'settings.system.units.minutes',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'idleTimeout',
    labelKey: 'settings.system.fields.idleTimeout.label',
    descriptionKey: 'settings.system.fields.idleTimeout.description',
    unitKey: 'settings.system.units.minutes',
    toDisplay: (v) => Math.round(v / 60000),
    toStored: (v) => v * 60000,
    min: 1,
    max: 1440,
    step: 1,
  },
  {
    key: 'containerMaxOutputSize',
    labelKey: 'settings.system.fields.containerMaxOutputSize.label',
    descriptionKey: 'settings.system.fields.containerMaxOutputSize.description',
    unitKey: 'settings.system.units.mb',
    toDisplay: (v) => Math.round(v / 1048576),
    toStored: (v) => v * 1048576,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'maxConcurrentContainers',
    labelKey: 'settings.system.fields.maxConcurrentContainers.label',
    descriptionKey: 'settings.system.fields.maxConcurrentContainers.description',
    unitKey: 'settings.system.units.count',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'maxConcurrentHostProcesses',
    labelKey: 'settings.system.fields.maxConcurrentHostProcesses.label',
    descriptionKey: 'settings.system.fields.maxConcurrentHostProcesses.description',
    unitKey: 'settings.system.units.count',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 50,
    step: 1,
  },
  {
    key: 'maxLoginAttempts',
    labelKey: 'settings.system.fields.maxLoginAttempts.label',
    descriptionKey: 'settings.system.fields.maxLoginAttempts.description',
    unitKey: 'settings.system.units.times',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: 'loginLockoutMinutes',
    labelKey: 'settings.system.fields.loginLockoutMinutes.label',
    descriptionKey: 'settings.system.fields.loginLockoutMinutes.description',
    unitKey: 'settings.system.units.minutes',
    toDisplay: (v) => v,
    toStored: (v) => v,
    min: 1,
    max: 1440,
    step: 1,
  },
];

export function SystemSettingsSection({ setNotice, setError }: SystemSettingsSectionProps) {
  const { hasPermission } = useAuthStore();
  const { t } = useI18n();

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
        setError(getErrorMessage(err, t('settings.system.errors.loadFailed')));
      } finally {
        setLoading(false);
      }
    })();
  }, [setError, t]);

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
      setNotice(t('settings.system.notice.saved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.system.errors.saveFailed')));
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
    return <div className="text-sm text-muted-foreground">{t('settings.system.noPermission')}</div>;
  }

  if (!settings) return null;

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        {t('settings.system.description')}
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.system.headerBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.system.headerTitle')}</div>
        </div>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
          {fields.map((f) => {
            const unit = t(f.unitKey);
            return (
              <div key={f.key} className="surface-card-soft rounded-xl space-y-2 border border-border/70 bg-muted/20 p-3">
                <label className="block text-sm font-medium text-foreground">{t(f.labelKey)}</label>
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
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(f.descriptionKey)} {t('settings.system.range', { min: f.min, max: f.max, unit })}
                </p>
              </div>
            );
          })}
        </div>
        <div className="px-4 pb-4">
          <SettingsActionBar>
            <Button onClick={handleSave} disabled={saving} className="h-10 rounded-xl">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t('settings.system.saving') : t('settings.system.save')}
            </Button>
          </SettingsActionBar>
        </div>
      </section>
    </div>
  );
}
