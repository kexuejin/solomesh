import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SettingsActionBarProps {
  children: ReactNode;
  className?: string;
  separated?: boolean;
}

export function SettingsActionBar({
  children,
  className,
  separated = true,
}: SettingsActionBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        separated && 'border-t border-border/70 pt-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
