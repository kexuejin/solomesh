import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SettingsMetaItem {
  label: string;
  value: ReactNode;
}

interface SettingsMetaGridProps {
  items: SettingsMetaItem[];
  className?: string;
  columns?: 1 | 2 | 3;
}

const columnClassName: Record<NonNullable<SettingsMetaGridProps['columns']>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

export function SettingsMetaGrid({
  items,
  className,
  columns = 2,
}: SettingsMetaGridProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('grid gap-2 text-xs', columnClassName[columns], className)}>
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2 text-muted-foreground"
        >
          {item.label}
          {'：'}
          {item.value}
        </div>
      ))}
    </div>
  );
}
