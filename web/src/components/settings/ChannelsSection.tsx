import type { SettingsNotification } from './types';
import { FeishuConfigForm } from './FeishuConfigForm';
import { TelegramConfigForm } from './TelegramConfigForm';
import { useI18n } from '../../i18n';

interface ChannelsSectionProps extends SettingsNotification {}

export function ChannelsSection({ setNotice, setError }: ChannelsSectionProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85 space-y-1.5">
        <p>{t('settings.channels.description')}</p>
        <p>{t('settings.channels.personalHint')}</p>
      </div>
      <FeishuConfigForm setNotice={setNotice} setError={setError} />
      <TelegramConfigForm setNotice={setNotice} setError={setError} />
    </div>
  );
}
