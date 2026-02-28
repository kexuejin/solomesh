import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { useAuthStore } from '../stores/auth';
import { SettingsNav } from '../components/settings/SettingsNav';
import { ChannelsSection } from '../components/settings/ChannelsSection';
import { RuntimeSection } from '../components/settings/RuntimeSection';
import { RegistrationSection } from '../components/settings/RegistrationSection';
import { ProfileSection } from '../components/settings/ProfileSection';
import { SecuritySection } from '../components/settings/SecuritySection';
import { AboutSection } from '../components/settings/AboutSection';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { UserChannelsSection } from '../components/settings/UserChannelsSection';
import { WorkflowSection } from '../components/settings/WorkflowSection';
import { GroupsPage } from './GroupsPage';
import { MemoryPage } from './MemoryPage';
import { SkillsPage } from './SkillsPage';
import { McpServersPage } from './McpServersPage';
import { UsersPage } from './UsersPage';
import { SettingsFeedback } from '../components/settings/SettingsFeedback';
import type { SettingsTab } from '../components/settings/types';

const VALID_TABS: SettingsTab[] = ['channels', 'runtime', 'registration', 'appearance', 'profile', 'my-channels', 'security', 'groups', 'memory', 'skills', 'mcp-servers', 'workflows', 'users', 'about'];
const SYSTEM_TABS: SettingsTab[] = ['channels', 'runtime', 'registration', 'appearance'];
const FULLPAGE_TABS: SettingsTab[] = ['groups', 'memory', 'skills', 'mcp-servers', 'users'];

export function SettingsPage() {
  const { user: currentUser } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const hasSystemConfigPermission =
    currentUser?.role === 'admin' || !!currentUser?.permissions.includes('manage_system_config');
  const mustChangePassword = !!currentUser?.must_change_password;
  const canManageSystemConfig = hasSystemConfigPermission && !mustChangePassword;
  const canManageUsers =
    currentUser?.role === 'admin' ||
    !!currentUser?.permissions.includes('manage_users') ||
    !!currentUser?.permissions.includes('manage_invites') ||
    !!currentUser?.permissions.includes('view_audit_log');

  const defaultTab: SettingsTab = canManageSystemConfig ? 'channels' : 'profile';

  const activeTab = useMemo((): SettingsTab => {
    if (mustChangePassword) return 'profile';
    const raw = searchParams.get('tab') as SettingsTab | null;
    if (raw && VALID_TABS.includes(raw)) {
      if (SYSTEM_TABS.includes(raw) && !canManageSystemConfig) return defaultTab;
      return raw;
    }
    return defaultTab;
  }, [searchParams, canManageSystemConfig, mustChangePassword, defaultTab]);

  const handleTabChange = useCallback((tab: SettingsTab) => {
    setNotice(null);
    setError(null);
    setNavOpen(false);
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

  const sectionTitle: Record<SettingsTab, string> = {
    channels: '渠道配置',
    runtime: 'Agent 运行时',
    registration: '注册管理',
    appearance: '外观设置',
    profile: '个人资料',
    'my-channels': '消息通道',
    security: '安全与设备',
    groups: '会话管理',
    memory: '记忆管理',
    skills: '技能管理',
    'mcp-servers': 'MCP 服务器',
    workflows: 'Workflow 模板',
    users: '用户管理',
    about: '关于',
  };
  const workflowWideLayout = activeTab === 'workflows';

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="min-h-full app-canvas flex flex-col lg:flex-row">
      {/* Mobile header */}
      <div className="sticky top-0 z-10 flex h-14 items-center border-b border-sidebar-border bg-card/95 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setNavOpen(true)}
          className="-ml-1.5 rounded-xl border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/60 hover:text-foreground"
          aria-label="打开导航"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-3 truncate text-sm font-semibold text-foreground">{sectionTitle[activeTab]}</span>
      </div>

      <SettingsNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        canManageSystemConfig={canManageSystemConfig}
        canManageUsers={!!canManageUsers}
        mustChangePassword={mustChangePassword}
        open={navOpen}
        onOpenChange={setNavOpen}
      />

      <div className="flex-1 overflow-y-auto">
        {FULLPAGE_TABS.includes(activeTab) ? (
          <>
            {activeTab === 'groups' && <GroupsPage />}
            {activeTab === 'memory' && <MemoryPage />}
            {activeTab === 'skills' && <SkillsPage />}
            {activeTab === 'mcp-servers' && <McpServersPage />}
            {activeTab === 'users' && <UsersPage />}
          </>
        ) : (
          <div className={workflowWideLayout ? 'px-4 py-4 lg:px-7 lg:py-6' : 'px-4 py-4 lg:px-7 lg:py-6'}>
            <div className={`${workflowWideLayout ? 'max-w-7xl' : 'max-w-4xl'} mx-auto space-y-5`}>
              <div className="rounded-xl border border-border/80 bg-card/80 px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/85">
                  Settings
                </div>
                <h1 className="mt-1 text-2xl font-bold text-foreground">{sectionTitle[activeTab]}</h1>
              </div>

              {mustChangePassword && (
                <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  检测到首次登录或管理员重置密码，请先完成"修改密码"，其余关键操作会被暂时限制。
                </div>
              )}

              <SettingsFeedback
                notice={notice}
                error={error}
                onClearNotice={() => setNotice(null)}
                onClearError={() => setError(null)}
              />

              {activeTab === 'workflows' ? (
                <WorkflowSection
                  setNotice={setNotice}
                  setError={setError}
                  canManageSystemConfig={canManageSystemConfig}
                />
              ) : (
                <>
                  {activeTab === 'channels' && <ChannelsSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'runtime' && <RuntimeSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'registration' && <RegistrationSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'appearance' && <AppearanceSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'profile' && <ProfileSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'my-channels' && <UserChannelsSection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'security' && <SecuritySection setNotice={setNotice} setError={setError} />}
                  {activeTab === 'about' && <AboutSection />}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
