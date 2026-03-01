import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useI18n } from '../../i18n';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounce?: number;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  debounce = 300,
  className,
  autoFocus,
}: SearchInputProps) {
  const { t } = useI18n();
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const effectivePlaceholder = placeholder ?? t('common.searchPlaceholder');

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (v: string) => {
    setLocalValue(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounce);
  };

  const handleClear = () => {
    setLocalValue('');
    clearTimeout(timerRef.current);
    onChange('');
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <Input
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={effectivePlaceholder}
        className="h-10 rounded-xl border-border/70 bg-card/95 pl-9 pr-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] focus-visible:ring-brand-300/70"
        autoFocus={autoFocus}
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-transparent p-0.5 text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/65 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
