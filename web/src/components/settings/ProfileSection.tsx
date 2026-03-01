import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Trash2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmojiAvatar } from '@/components/common/EmojiAvatar';
import { EmojiPicker } from '@/components/common/EmojiPicker';
import { ColorPicker } from '@/components/common/ColorPicker';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface ProfileSectionProps extends SettingsNotification {}

export function ProfileSection({ setNotice, setError }: ProfileSectionProps) {
  const { locale, setLocale, t } = useI18n();
  const { user: currentUser, changePassword, updateProfile, uploadAvatar } = useAuthStore();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [avatarColor, setAvatarColor] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const [aiName, setAiName] = useState('');
  const [aiAvatarEmoji, setAiAvatarEmoji] = useState<string | null>(null);
  const [aiAvatarColor, setAiAvatarColor] = useState<string | null>(null);
  const [aiAvatarUrl, setAiAvatarUrl] = useState<string | null>(null);
  const [aiAppearanceSaving, setAiAppearanceSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdChanging, setPwdChanging] = useState(false);

  useEffect(() => {
    setUsername(currentUser?.username || '');
    setDisplayName(currentUser?.display_name || '');
    setAvatarEmoji(currentUser?.avatar_emoji ?? null);
    setAvatarColor(currentUser?.avatar_color ?? null);
    setAiName(currentUser?.ai_name || '');
    setAiAvatarEmoji(currentUser?.ai_avatar_emoji ?? null);
    setAiAvatarColor(currentUser?.ai_avatar_color ?? null);
    setAiAvatarUrl(currentUser?.ai_avatar_url ?? null);
  }, [
    currentUser?.username,
    currentUser?.display_name,
    currentUser?.avatar_emoji,
    currentUser?.avatar_color,
    currentUser?.ai_name,
    currentUser?.ai_avatar_emoji,
    currentUser?.ai_avatar_color,
    currentUser?.ai_avatar_url,
  ]);

  const handleUpdateProfile = async () => {
    setProfileSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateProfile({
        username: username.trim(),
        display_name: displayName.trim(),
        avatar_emoji: avatarEmoji,
        avatar_color: avatarColor,
      });
      setNotice(t('settings.profile.notice.profileSaved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.profile.errors.updateProfileFailed')));
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdChanging(true);
    setError(null);
    setNotice(null);
    try {
      await changePassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setNotice(t('settings.profile.notice.passwordUpdated'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.profile.errors.changePasswordFailed')));
    } finally {
      setPwdChanging(false);
    }
  };

  const handleSaveAiAppearance = async () => {
    setAiAppearanceSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateProfile({
        ai_name: aiName.trim() || null,
        ai_avatar_emoji: aiAvatarEmoji,
        ai_avatar_color: aiAvatarColor,
      });
      setNotice(t('settings.profile.notice.aiAppearanceSaved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.profile.errors.updateAiAppearanceFailed')));
    } finally {
      setAiAppearanceSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 2 * 1024 * 1024) {
      setError(t('settings.profile.errors.avatarTooLarge'));
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError(t('settings.profile.errors.avatarTypeUnsupported'));
      return;
    }

    setAvatarUploading(true);
    setError(null);
    setNotice(null);
    try {
      const url = await uploadAvatar(file);
      setAiAvatarUrl(url);
      setNotice(t('settings.profile.notice.avatarUploaded'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.profile.errors.uploadAvatarFailed')));
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setError(null);
    setNotice(null);
    try {
      await updateProfile({ ai_avatar_url: null });
      setAiAvatarUrl(null);
      setNotice(t('settings.profile.notice.avatarRemoved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.profile.errors.removeAvatarFailed')));
    }
  };

  const roleLabel =
    currentUser?.role === 'admin'
      ? t('settings.profile.role.admin')
      : t('settings.profile.role.member');
  const statusLabel =
    currentUser?.status === 'active'
      ? t('settings.profile.status.active')
      : currentUser?.status === 'disabled'
        ? t('settings.profile.status.disabled')
        : t('settings.profile.status.deleted');
  const lastLoginText = currentUser?.last_login_at
    ? new Date(currentUser.last_login_at).toLocaleString(localeForDateTime(locale))
    : t('settings.profile.notAvailable');

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('profile.locale.sectionTitle')}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {t('profile.locale.title')}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('profile.locale.description')}
        </p>
        <div className="inline-flex rounded-xl border border-border/70 bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setLocale('zh-CN')}
            className={`h-9 rounded-lg px-3 text-sm transition-colors ${
              locale === 'zh-CN'
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('profile.locale.zhOption')}
          </button>
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={`h-9 rounded-lg px-3 text-sm transition-colors ${
              locale === 'en'
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('profile.locale.enOption')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('profile.locale.followSystemHint')}
        </p>
      </section>

      <div className="rounded-xl border border-brand-200/80 bg-brand-50/55 px-4 py-3 text-sm text-foreground/85">
        {t('settings.profile.description')}
      </div>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.profile.basicInfoBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.profile.basicInfoTitle')}</div>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <EmojiAvatar
              emoji={avatarEmoji}
              color={avatarColor}
              fallbackChar={displayName || username}
              size="lg"
            />
            <div>
              <div className="text-sm font-semibold text-foreground">
                {displayName || username || t('settings.profile.unnamedUser')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('settings.profile.meta.role')}: {roleLabel} · {t('settings.profile.meta.status')}: {statusLabel}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80">{t('settings.profile.fields.username')}</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80">{t('settings.profile.fields.displayName')}</label>
              <Input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
            </div>
          </div>

          <SettingsMetaGrid
            items={[
              { label: t('settings.profile.meta.role'), value: roleLabel },
              { label: t('settings.profile.meta.status'), value: statusLabel },
              { label: t('settings.profile.meta.lastLogin'), value: lastLoginText },
            ]}
            columns={3}
          />

          {currentUser?.permissions && currentUser.permissions.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              {t('settings.profile.permissionsPrefix')}{currentUser.permissions.join(', ')}
            </div>
          )}

          <div className="rounded-lg bg-muted/10 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('settings.profile.avatarSettingsTitle')}</h3>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">{t('settings.profile.fields.emoji')}</label>
              <EmojiPicker value={avatarEmoji ?? undefined} onChange={setAvatarEmoji} />
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">{t('settings.profile.fields.color')}</label>
              <ColorPicker value={avatarColor ?? undefined} onChange={setAvatarColor} />
            </div>
          </div>

          <SettingsActionBar>
            <Button
              onClick={handleUpdateProfile}
              disabled={profileSaving || !username.trim()}
              className="h-10 rounded-xl"
            >
              {profileSaving && <Loader2 className="size-4 animate-spin" />}
              {profileSaving ? t('settings.profile.saving') : t('settings.profile.saveProfile')}
            </Button>
          </SettingsActionBar>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.profile.aiBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.profile.aiTitle')}</div>
        </div>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('settings.profile.aiDescription')}
          </p>

          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <EmojiAvatar
              imageUrl={aiAvatarUrl}
              emoji={aiAvatarEmoji}
              color={aiAvatarColor}
              fallbackChar={aiName || t('settings.profile.aiFallback')}
              size="lg"
            />
            <div>
              <div className="text-sm font-semibold text-foreground">{aiName || t('settings.profile.aiDefaultName')}</div>
              <div className="text-xs text-muted-foreground">
                {aiAvatarUrl ? t('settings.profile.aiAvatarImageUsed') : t('settings.profile.aiAvatarEmojiUsed')}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/80">{t('settings.profile.aiNameLabel')}</label>
            <Input
              type="text"
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder={t('settings.profile.aiNamePlaceholder')}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>

          <div className="rounded-lg bg-muted/10 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('settings.profile.avatarStyleTitle')}</h3>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">{t('settings.profile.fields.emoji')}</label>
              <EmojiPicker value={aiAvatarEmoji ?? undefined} onChange={setAiAvatarEmoji} />
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">{t('settings.profile.fields.color')}</label>
              <ColorPicker value={aiAvatarColor ?? undefined} onChange={setAiAvatarColor} />
            </div>
          </div>

          <div className="rounded-lg bg-muted/10 p-3 space-y-2">
            <label className="text-xs font-medium text-foreground/80">{t('settings.profile.customAvatarLabel')}</label>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                className="rounded-lg"
              >
                {avatarUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t('settings.profile.uploadImage')}
              </Button>
              {aiAvatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveAvatar}
                  className="rounded-lg"
                >
                  <Trash2 className="size-4" />
                  {t('settings.profile.removeImage')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('settings.profile.customAvatarHint')}
            </p>
          </div>

          <SettingsActionBar>
            <Button onClick={handleSaveAiAppearance} disabled={aiAppearanceSaving} className="h-10 rounded-xl">
              {aiAppearanceSaving && <Loader2 className="size-4 animate-spin" />}
              {aiAppearanceSaving ? t('settings.profile.saving') : t('settings.profile.saveAiAppearance')}
            </Button>
          </SettingsActionBar>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.profile.securityBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.profile.securityTitle')}</div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted/10 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/80">{t('settings.profile.currentPassword')}</label>
                <Input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/80">{t('settings.profile.newPassword')}</label>
                <Input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder={t('settings.profile.newPasswordPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>
            </div>
          </div>

          <SettingsActionBar>
            <Button onClick={handleChangePassword} disabled={pwdChanging || !currentPwd || !newPwd} className="h-10 rounded-xl">
              {pwdChanging && <Loader2 className="size-4 animate-spin" />}
              {pwdChanging ? t('settings.profile.changingPassword') : t('settings.profile.changePassword')}
            </Button>
          </SettingsActionBar>
        </div>
      </section>
    </div>
  );
}
