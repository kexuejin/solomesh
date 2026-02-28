import {
  Radio,
  ShieldCheck,
  UserPlus,
  User,
  Shield,
  Layers,
  BookOpen,
  Puzzle,
  Server,
  UserCog,
  Info,
  Palette,
  MessageSquare,
  GitBranch,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { SettingsTab } from './types';

interface NavItem {
  key: SettingsTab;
  label: string;
  icon: React.ReactNode;
  group: 'system' | 'account' | 'features';
}

const systemItems: NavItem[] = [
  { key: 'channels', label: '渠道配置', icon: <Radio className="w-4 h-4" />, group: 'system' },
  { key: 'runtime', label: 'Agent 运行时', icon: <ShieldCheck className="w-4 h-4" />, group: 'system' },
  { key: 'registration', label: '注册管理', icon: <UserPlus className="w-4 h-4" />, group: 'system' },
  { key: 'appearance', label: '外观设置', icon: <Palette className="w-4 h-4" />, group: 'system' },
];

const accountItems: NavItem[] = [
  { key: 'profile', label: '个人资料', icon: <User className="w-4 h-4" />, group: 'account' },
  { key: 'my-channels', label: '消息通道', icon: <MessageSquare className="w-4 h-4" />, group: 'account' },
  { key: 'security', label: '安全与设备', icon: <Shield className="w-4 h-4" />, group: 'account' },
];

const featureItems: NavItem[] = [
  { key: 'groups', label: '会话管理', icon: <Layers className="w-4 h-4" />, group: 'features' },
  { key: 'memory', label: '记忆管理', icon: <BookOpen className="w-4 h-4" />, group: 'features' },
  { key: 'skills', label: '技能管理', icon: <Puzzle className="w-4 h-4" />, group: 'features' },
  { key: 'mcp-servers', label: 'MCP 服务器', icon: <Server className="w-4 h-4" />, group: 'features' },
  { key: 'workflows', label: 'Workflow 模板', icon: <GitBranch className="w-4 h-4" />, group: 'features' },
  { key: 'users', label: '用户管理', icon: <UserCog className="w-4 h-4" />, group: 'features' },
  { key: 'about', label: '关于', icon: <Info className="w-4 h-4" />, group: 'features' },
];

interface SettingsNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  canManageSystemConfig: boolean;
  canManageUsers: boolean;
  mustChangePassword: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsNav({ activeTab, onTabChange, canManageSystemConfig, canManageUsers, mustChangePassword, open, onOpenChange }: SettingsNavProps) {
  const visibleItems: { group: string; items: NavItem[] }[] = [];

  if (canManageSystemConfig) {
    visibleItems.push({ group: '系统配置', items: systemItems });
  }
  visibleItems.push({ group: '账户设置', items: accountItems });

  const visibleFeatures = featureItems.filter((item) => {
    if (item.key === 'users' && !canManageUsers) return false;
    return true;
  });
  if (visibleFeatures.length > 0) {
    visibleItems.push({ group: '更多功能', items: visibleFeatures });
  }

  const isDisabled = (item: NavItem) => mustChangePassword && item.key !== 'profile';

  const itemClassName = (active: boolean, disabled: boolean) =>
    `group flex h-11 w-full items-center gap-2.5 rounded-lg px-3.5 text-left text-sm leading-none transition-colors ${
      active
        ? 'bg-brand-50 text-brand-700 font-semibold shadow-[inset_0_0_0_1px_var(--brand-200)]'
        : disabled
          ? 'cursor-not-allowed text-muted-foreground/45'
          : 'cursor-pointer text-muted-foreground hover:bg-muted/55 hover:text-foreground'
    }`;

  return (
    <>
      {/* Desktop: vertical sidebar */}
      <nav className="hidden w-64 shrink-0 border-r border-sidebar-border bg-card lg:flex lg:flex-col">
        <div className="border-b border-sidebar-border px-6 pb-4 pt-6">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">系统与账户配置</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          {visibleItems.map((section, si) => (
            <div key={section.group} className={si > 0 ? 'mt-6' : ''}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {section.group}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = activeTab === item.key;
                  const disabled = isDisabled(item);
                  return (
                    <button
                      key={item.key}
                      onClick={() => !disabled && onTabChange(item.key)}
                      disabled={disabled}
                      className={itemClassName(active, disabled)}
                    >
                      <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${active ? 'text-brand-700' : 'group-hover:text-foreground'}`}>
                        {item.icon}
                      </span>
                      <span className="truncate leading-none">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile: left sheet drawer */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-72 border-r border-sidebar-border bg-card p-0" showCloseButton={false}>
          <SheetHeader className="border-b border-sidebar-border px-5 pb-3 pt-5">
            <SheetTitle className="text-base font-semibold">设置</SheetTitle>
          </SheetHeader>
          <nav className="overflow-y-auto px-3 pb-4 pt-3">
            {visibleItems.map((section, si) => (
              <div key={section.group} className={si > 0 ? 'mt-5' : ''}>
                <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {section.group}
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const active = activeTab === item.key;
                    const disabled = isDisabled(item);
                    return (
                      <button
                        key={item.key}
                        onClick={() => {
                          if (!disabled) {
                            onTabChange(item.key);
                            onOpenChange?.(false);
                          }
                        }}
                        disabled={disabled}
                        className={itemClassName(active, disabled)}
                      >
                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${active ? 'text-brand-700' : 'group-hover:text-foreground'}`}>
                          {item.icon}
                        </span>
                        <span className="truncate leading-none">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
