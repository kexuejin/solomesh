import { NavLink, useNavigate } from 'react-router-dom';
import { MessageSquare, Clock, Activity, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { EmojiAvatar } from '../common/EmojiAvatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '../../i18n';

const mainNavItems = [
  { path: '/chat', icon: MessageSquare, labelKey: 'nav.workspace' as const },
  { path: '/tasks', icon: Clock, labelKey: 'nav.tasks' as const },
  { path: '/monitor', icon: Activity, labelKey: 'nav.monitor' as const },
];

const utilityNavItems = [
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' as const },
];

export function NavRail() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { t } = useI18n();

  const userInitial = (user?.display_name || user?.username || '?')[0].toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex h-full w-16 flex-col items-center border-r border-sidebar-border bg-card py-6">
        {/* Logo */}
        <div className="mb-8 h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl ring-1 ring-border/80">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="SoloMesh" className="w-full h-full object-cover" />
        </div>

        <div className="flex w-full flex-1 flex-col items-center gap-6">
          {mainNavItems.map(({ path, icon: Icon, labelKey }) => (
            <Tooltip key={path}>
              <TooltipTrigger asChild>
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? 'bg-brand-50 text-brand-600'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`
                  }
                >
                  {({ isActive }) => <Icon className={isActive ? 'h-5 w-5 text-brand-600' : 'h-5 w-5'} />}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(labelKey)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Utilities + profile */}
        <div className="mt-auto flex flex-col items-center gap-6 pb-1">
          {utilityNavItems.map(({ path, icon: Icon, labelKey }) => (
            <Tooltip key={path}>
              <TooltipTrigger asChild>
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    `mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? 'bg-brand-50 text-brand-600'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`
                  }
                >
                  {({ isActive }) => <Icon className={isActive ? 'h-5 w-5 text-brand-600' : 'h-5 w-5'} />}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(labelKey)}
              </TooltipContent>
            </Tooltip>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/settings?tab=profile')}
                className="cursor-pointer rounded-full transition-all hover:ring-2 hover:ring-brand-200"
              >
                <EmojiAvatar
                  emoji={user?.avatar_emoji}
                  color={user?.avatar_color}
                  fallbackChar={userInitial}
                  size="md"
                  className="h-8 w-8"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {user?.display_name || user?.username}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('nav.signOut')}
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  );
}
