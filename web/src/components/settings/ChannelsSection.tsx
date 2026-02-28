import type { SettingsNotification } from './types';
import { FeishuConfigForm } from './FeishuConfigForm';
import { TelegramConfigForm } from './TelegramConfigForm';

interface ChannelsSectionProps extends SettingsNotification {}

export function ChannelsSection({ setNotice, setError }: ChannelsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85 space-y-1.5">
        <p>管理系统级 IM 渠道凭据，此处配置作为全局默认，影响所有未单独配置的用户。</p>
        <p>如果你是在工作区内完成的个人渠道绑定，请前往「消息通道」页面查看，不会显示在这里。</p>
      </div>
      <FeishuConfigForm setNotice={setNotice} setError={setError} />
      <TelegramConfigForm setNotice={setNotice} setError={setError} />
    </div>
  );
}
