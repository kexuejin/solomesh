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

interface ProfileSectionProps extends SettingsNotification {}

export function ProfileSection({ setNotice, setError }: ProfileSectionProps) {
  const { user: currentUser, changePassword, updateProfile, uploadAvatar } = useAuthStore();

  // Profile
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [avatarColor, setAvatarColor] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // AI appearance
  const [aiName, setAiName] = useState('');
  const [aiAvatarEmoji, setAiAvatarEmoji] = useState<string | null>(null);
  const [aiAvatarColor, setAiAvatarColor] = useState<string | null>(null);
  const [aiAvatarUrl, setAiAvatarUrl] = useState<string | null>(null);
  const [aiAppearanceSaving, setAiAppearanceSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Password
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
  }, [currentUser?.username, currentUser?.display_name, currentUser?.avatar_emoji, currentUser?.avatar_color, currentUser?.ai_name, currentUser?.ai_avatar_emoji, currentUser?.ai_avatar_color, currentUser?.ai_avatar_url]);

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
      setNotice('基础信息已保存');
    } catch (err) {
      setError(getErrorMessage(err, '更新基础信息失败'));
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
      setNotice('密码已更新');
    } catch (err) {
      setError(getErrorMessage(err, '修改密码失败'));
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
      setNotice('机器人外观已保存');
    } catch (err) {
      setError(getErrorMessage(err, '更新机器人外观失败'));
    } finally {
      setAiAppearanceSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so re-selecting same file triggers onChange
    e.target.value = '';

    if (file.size > 2 * 1024 * 1024) {
      setError('图片文件不能超过 2MB');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('仅支持 jpg、png、gif、webp 格式');
      return;
    }

    setAvatarUploading(true);
    setError(null);
    setNotice(null);
    try {
      const url = await uploadAvatar(file);
      setAiAvatarUrl(url);
      setNotice('头像已上传并保存');
    } catch (err) {
      setError(getErrorMessage(err, '上传头像失败'));
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
      setNotice('头像已移除');
    } catch (err) {
      setError(getErrorMessage(err, '移除头像失败'));
    }
  };

  const roleLabel = currentUser?.role === 'admin' ? '管理员' : '普通成员';
  const statusLabel = currentUser?.status === 'active' ? '启用' : currentUser?.status === 'disabled' ? '禁用' : '已删除';
  const lastLoginText = currentUser?.last_login_at ? new Date(currentUser.last_login_at).toLocaleString('zh-CN') : '-';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-200/80 bg-brand-50/55 px-4 py-3 text-sm text-foreground/85">
        管理你的个人信息、头像和密码。这里的 AI 外观仅影响你自己的对话界面显示。
      </div>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">个人信息</div>
          <div className="mt-1 text-sm font-medium text-foreground">头像与账户资料</div>
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
              <div className="text-sm font-semibold text-foreground">{displayName || username || '未命名用户'}</div>
              <div className="text-xs text-muted-foreground">角色：{roleLabel} · 状态：{statusLabel}</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80">用户名</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80">显示名称</label>
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
              { label: '角色', value: roleLabel },
              { label: '状态', value: statusLabel },
              { label: '最近登录', value: lastLoginText },
            ]}
            columns={3}
          />

          {currentUser?.permissions && currentUser.permissions.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              权限：{currentUser.permissions.join(', ')}
            </div>
          )}

          <div className="rounded-lg bg-muted/10 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">头像设置</h3>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Emoji</label>
              <EmojiPicker value={avatarEmoji ?? undefined} onChange={setAvatarEmoji} />
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">背景色</label>
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
              {profileSaving ? '保存中...' : '保存基础信息'}
            </Button>
          </SettingsActionBar>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">我的 AI</div>
          <div className="mt-1 text-sm font-medium text-foreground">机器人外观</div>
        </div>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            自定义你的 AI 助手外观，覆盖系统默认值，仅影响你看到的对话界面。
          </p>

          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <EmojiAvatar
              imageUrl={aiAvatarUrl}
              emoji={aiAvatarEmoji}
              color={aiAvatarColor}
              fallbackChar={aiName || 'AI'}
              size="lg"
            />
            <div>
              <div className="text-sm font-semibold text-foreground">{aiName || '系统默认名称'}</div>
              <div className="text-xs text-muted-foreground">
                {aiAvatarUrl ? '已使用自定义图片头像' : '使用 Emoji / 背景色组合头像'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/80">AI 名称</label>
            <Input
              type="text"
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder="留空使用系统默认"
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>

          <div className="rounded-lg bg-muted/10 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">头像风格</h3>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Emoji</label>
              <EmojiPicker value={aiAvatarEmoji ?? undefined} onChange={setAiAvatarEmoji} />
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">背景色</label>
              <ColorPicker value={aiAvatarColor ?? undefined} onChange={setAiAvatarColor} />
            </div>
          </div>

          <div className="rounded-lg bg-muted/10 p-3 space-y-2">
            <label className="text-xs font-medium text-foreground/80">自定义头像图片</label>
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
                上传图片
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
                  移除
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              支持 jpg、png、gif、webp，最大 2MB。上传后将优先于 Emoji 头像显示。
            </p>
          </div>

          <SettingsActionBar>
            <Button onClick={handleSaveAiAppearance} disabled={aiAppearanceSaving} className="h-10 rounded-xl">
              {aiAppearanceSaving && <Loader2 className="size-4 animate-spin" />}
              {aiAppearanceSaving ? '保存中...' : '保存机器人外观'}
            </Button>
          </SettingsActionBar>
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">安全设置</div>
          <div className="mt-1 text-sm font-medium text-foreground">修改密码</div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted/10 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/80">当前密码</label>
                <Input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/80">新密码</label>
                <Input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="至少 8 位"
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>
            </div>
          </div>

          <SettingsActionBar>
            <Button onClick={handleChangePassword} disabled={pwdChanging || !currentPwd || !newPwd} className="h-10 rounded-xl">
              {pwdChanging && <Loader2 className="size-4 animate-spin" />}
              {pwdChanging ? '修改中...' : '修改密码'}
            </Button>
          </SettingsActionBar>
        </div>
      </section>
    </div>
  );
}
