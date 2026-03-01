import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, FileText } from 'lucide-react';
import { useI18n } from '../../i18n';

interface MessageContextMenuProps {
  content: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function MessageContextMenu({ content, position, onClose }: MessageContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${position.y - rect.height - 8}px`;
    }
  }, [position]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    onClose();
  };

  const handleCopyText = () => {
    const plain = content
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/, '').replace(/\n?```$/, ''))
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    copyToClipboard(plain);
  };

  const handleCopyMarkdown = () => copyToClipboard(content);

  return createPortal(
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div
        ref={menuRef}
        className="surface-card-soft absolute min-w-[168px] rounded-xl border border-border/70 bg-card/95 py-1 shadow-[0_14px_36px_rgba(15,23,42,0.14)] animate-in zoom-in-95 fade-in duration-150"
        style={{ left: position.x, top: position.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleCopyText}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/70 active:bg-muted"
        >
          <Copy className="w-4 h-4 text-muted-foreground" />
          {t('chat.contextMenu.copyText')}
        </button>
        <div className="mx-3 border-t border-border/70" />
        <button
          onClick={handleCopyMarkdown}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/70 active:bg-muted"
        >
          <FileText className="w-4 h-4 text-muted-foreground" />
          {t('chat.contextMenu.copyMarkdown')}
        </button>
      </div>
    </div>,
    document.body
  );
}
