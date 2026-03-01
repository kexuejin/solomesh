import { NavLink, useLocation } from 'react-router-dom';
import { MessageSquare, Clock, Activity, Settings } from 'lucide-react';
import { useScrollDirection } from '../../hooks/useScrollDirection';
import { lightTap } from '../../hooks/useHaptic';
import { useI18n } from '../../i18n';

export const navItems = [
  { path: '/chat', icon: MessageSquare, labelKey: 'nav.workspace' as const },
  { path: '/tasks', icon: Clock, labelKey: 'nav.tasks' as const },
  { path: '/monitor', icon: Activity, labelKey: 'nav.monitor' as const },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' as const },
];

export function BottomTabBar() {
  const location = useLocation();
  const scrollDir = useScrollDirection();
  const isCompact = scrollDir === 'down';
  const { t } = useI18n();

  return (
    <>
      <div className="pwa-bottom-guard" aria-hidden="true" />
      <div className={`floating-nav-container ${isCompact ? 'compact' : ''}`}>
        <nav className="floating-nav">
          {navItems.map(({ path, icon: Icon, labelKey }) => {
            const isActive = location.pathname.startsWith(path);
            const label = t(labelKey);
            return (
              <NavLink
                key={path}
                to={path}
                replace
                className={`floating-nav-item flex-col items-center justify-center ${isActive ? 'active' : ''}`}
                aria-label={label}
                onClick={() => lightTap()}
              >
                <Icon className="w-5 h-5" />
                <span className={`text-[10px] leading-tight mt-0.5 transition-all duration-200 ${isActive ? 'text-primary' : ''} ${isCompact ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-4 opacity-100'}`}>{label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </>
  );
}
