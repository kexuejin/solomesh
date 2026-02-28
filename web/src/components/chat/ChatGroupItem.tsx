import { MoreHorizontal, Pencil, Trash2, RotateCcw, Star, Folder, FolderOpen, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthStore } from '../../stores/auth';

export interface ChatGroupItemProps {
  jid: string;
  name: string;
  folder: string;
  lastMessage?: string;
  executionMode?: 'container' | 'host';
  customCwd?: string;
  isImSession?: boolean;
  isBoundSession?: boolean;
  isActive: boolean;
  isHome: boolean;
  editable?: boolean;
  deletable?: boolean;
  onSelect: (jid: string, folder: string) => void;
  onRename?: (jid: string, name: string) => void;
  onEditDirectory?: (jid: string, name: string, customCwd?: string) => void;
  onClearHistory: (jid: string, name: string) => void;
  onDelete?: (jid: string, name: string) => void;
}

export function ChatGroupItem({
  jid,
  name,
  folder,
  lastMessage,
  executionMode,
  customCwd,
  isImSession,
  isBoundSession,
  isActive,
  isHome,
  editable,
  deletable,
  onSelect,
  onRename,
  onEditDirectory,
  onClearHistory,
  onDelete,
}: ChatGroupItemProps) {
  const currentUser = useAuthStore((s) => s.user);
  const defaultHomeName = '我的工作区';
  // Use actual name if it's been renamed, otherwise fall back to default
  const isDefaultName = !name || name === 'Main' || name === `${currentUser?.username} Home`;
  const displayName = isHome && isDefaultName ? defaultHomeName : name;
  const truncatedMsg =
    lastMessage && lastMessage.length > 40
      ? lastMessage.substring(0, 40) + '...'
      : lastMessage;
  const hasMeta = !!executionMode || (isImSession && !!isBoundSession);

  return (
    <div
      className={cn(
        'group relative mb-1.5 transition-all',
        isActive
          ? 'rounded-r-lg border-l-4 border-brand-500 bg-brand-50/55'
          : 'rounded-lg hover:bg-accent/70',
      )}
    >
      <button
        onClick={() => onSelect(jid, folder)}
        className={cn(
          'w-full cursor-pointer py-2.5 pr-12 text-left',
          isActive ? 'pl-2.5' : 'px-3',
        )}
      >
        <div className="flex items-center gap-2">
          {isHome ? (
            <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-500 text-amber-500" />
          ) : (
            <FolderOpen className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-brand-600' : 'text-muted-foreground')} />
          )}
          <span
            className={cn(
              'truncate text-sm',
              isActive ? 'font-semibold text-foreground' : 'font-medium text-foreground/85',
            )}
          >
            {displayName}
          </span>
        </div>
        {truncatedMsg && (
          <p className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">
            {truncatedMsg}
          </p>
        )}
        {hasMeta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
            {executionMode === 'host' ? (
              <span className="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50/85 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                宿主机
              </span>
            ) : executionMode === 'container' ? (
              <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-sky-50/85 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                Docker
              </span>
            ) : null}
            {isImSession && isBoundSession ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50/85 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Link2 className="h-2.5 w-2.5" />
                已绑定
              </span>
            ) : null}
          </div>
        )}
      </button>

      {/* Dropdown menu */}
      <div
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2 flex items-center',
          'opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100',
          isActive && 'lg:opacity-100',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="cursor-pointer rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border/70 hover:bg-card/95 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {editable && onRename && (
              <DropdownMenuItem onClick={() => onRename(jid, name)}>
                <Pencil className="w-4 h-4" />
                重命名
              </DropdownMenuItem>
            )}
            {editable && executionMode === 'host' && onEditDirectory && (
              <DropdownMenuItem onClick={() => onEditDirectory(jid, displayName, customCwd)}>
                <Folder className="w-4 h-4" />
                修改目录
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onClearHistory(jid, displayName)}
              className="text-amber-700 focus:text-amber-700"
            >
              <RotateCcw className="w-4 h-4" />
              重建工作区
            </DropdownMenuItem>
            {!isHome && deletable && onDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(jid, name)}
              >
                <Trash2 className="w-4 h-4" />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
