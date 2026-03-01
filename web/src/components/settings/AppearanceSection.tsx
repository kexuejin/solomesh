import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmojiAvatar } from '@/components/common/EmojiAvatar';
import { EmojiPicker } from '@/components/common/EmojiPicker';
import { ColorPicker } from '@/components/common/ColorPicker';
import { SettingsActionBar } from './SettingsActionBar';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';
import type { AppearanceConfig } from '../../stores/auth';
import { useI18n } from '../../i18n';

interface AppearanceSectionProps extends SettingsNotification {}

export function AppearanceSection({ setNotice, setError }: AppearanceSectionProps) {
  const { hasPermission } = useAuthStore();
  const { t } = useI18n();

  const [appName, setAppName] = useState('');
  const [aiName, setAiName] = useState('');
  const [aiAvatarEmoji, setAiAvatarEmoji] = useState('');
  const [aiAvatarColor, setAiAvatarColor] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission('manage_system_config');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<AppearanceConfig>('/api/config/appearance');
        setAppName(data.appName);
        setAiName(data.aiName);
        setAiAvatarEmoji(data.aiAvatarEmoji);
        setAiAvatarColor(data.aiAvatarColor);
      } catch (err) {
        setError(getErrorMessage(err, t('settings.appearance.errors.loadFailed')));
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
      const data = await api.put<AppearanceConfig>('/api/config/appearance', {
        appName: appName.trim() || undefined,
        aiName: aiName.trim(),
        aiAvatarEmoji,
        aiAvatarColor,
      });
      setAppName(data.appName);
      setAiName(data.aiName);
      setAiAvatarEmoji(data.aiAvatarEmoji);
      setAiAvatarColor(data.aiAvatarColor);
      useAuthStore.setState({ appearance: data });
      setNotice(t('settings.appearance.notice.saved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.appearance.errors.saveFailed')));
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
    return <div className="text-sm text-muted-foreground">{t('settings.appearance.noPermission')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        {t('settings.appearance.description')}
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.appearance.previewBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.appearance.previewTitle')}</div>
        </div>
        <div className="px-4 py-4">
          <div className="surface-card-soft flex items-center gap-3 border border-border/70 bg-muted/30 p-4">
            <EmojiAvatar
              emoji={aiAvatarEmoji}
              color={aiAvatarColor}
              fallbackChar={aiName}
              size="lg"
            />
            <div>
              <div className="text-sm font-semibold text-foreground">{aiName || t('settings.appearance.defaultAiName')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.appearance.previewSubtitle')}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.appearance.namingBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.appearance.namingTitle')}</div>
        </div>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
          <div className="surface-card-soft rounded-xl space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="text-xs font-medium text-foreground/80">{t('settings.appearance.appNameLabel')}</label>
            <Input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              maxLength={32}
              placeholder="SoloMesh"
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="text-xs text-muted-foreground">{t('settings.appearance.appNameHint')}</p>
          </div>
          <div className="surface-card-soft rounded-xl space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="text-xs font-medium text-foreground/80">{t('settings.appearance.aiNameLabel')}</label>
            <Input
              type="text"
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              maxLength={32}
              placeholder="SoloMesh"
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.appearance.aiNameHint')}
            </p>
          </div>
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.appearance.avatarBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.appearance.avatarTitle')}</div>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="surface-card-soft rounded-xl space-y-3 border border-border/70 bg-muted/20 p-3">
            <h3 className="text-sm font-semibold text-foreground">{t('settings.appearance.avatarEmojiTitle')}</h3>
            <EmojiPicker value={aiAvatarEmoji} onChange={setAiAvatarEmoji} />
          </div>
          <div className="surface-card-soft rounded-xl space-y-3 border border-border/70 bg-muted/20 p-3">
            <h3 className="text-sm font-semibold text-foreground">{t('settings.appearance.avatarColorTitle')}</h3>
            <ColorPicker value={aiAvatarColor} onChange={setAiAvatarColor} />
          </div>
        </div>
      </section>

      <SettingsActionBar>
        <Button onClick={handleSave} disabled={saving || !aiName.trim()} className="h-10 rounded-xl">
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? t('settings.appearance.saving') : t('settings.appearance.save')}
        </Button>
      </SettingsActionBar>
    </div>
  );
}
