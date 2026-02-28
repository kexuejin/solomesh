import { useState, memo } from 'react';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Message } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { EmojiAvatar } from '../common/EmojiAvatar';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ImageLightbox } from './ImageLightbox';
import { getMessageProviderLabel } from '../../lib/message-provider';

interface MessageBubbleProps {
  message: Message;
  showTime: boolean;
  thinkingContent?: string;
  isShared?: boolean;
}

interface MessageAttachment {
  type: 'image';
  data: string; // base64
  mimeType?: string;
  name?: string;
}

/** Collapsible reasoning block for AI messages */
function ReasoningBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-3 rounded-xl border border-amber-200/60 bg-amber-50/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-50/60 transition-colors"
      >
        <svg className="w-4 h-4 text-amber-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
        <span className="text-xs font-medium text-amber-700">Reasoning</span>
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-sm text-amber-900/70 whitespace-pre-wrap break-words max-h-64 overflow-y-auto border-t border-amber-100">
          {content}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, showTime, thinkingContent, isShared }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const appearance = useAuthStore((s) => s.appearance);
  const isUser = !message.is_from_me;
  const isOtherUser = isShared && isUser && message.sender !== currentUser?.id;
  const time = new Date(message.timestamp)
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(/\//g, '-');

  // Parse image attachments
  const attachments: MessageAttachment[] = message.attachments
    ? (() => {
        try {
          return JSON.parse(message.attachments);
        } catch {
          return [];
        }
      })()
    : [];
  const images = attachments.filter((att) => att.type === 'image');
  const imageUrls = images.map(
    (img) => `data:${img.mimeType || 'image/png'};base64,${img.data}`,
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message.content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Context overflow system message
  if (message.sender === '__system__' && message.content.startsWith('context_overflow:')) {
    const errorMsg = message.content.replace(/^context_overflow:\s*/, '');
    return (
      <div className="mb-6">
        {showTime && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">{time}</span>
            <span className="text-xs font-medium text-red-600">系统消息</span>
          </div>
        )}
        <div className="relative bg-red-50 rounded-xl border border-red-200 border-l-[3px] border-l-red-500 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
              !
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900 mb-1">上下文溢出错误</h3>
              <p className="text-sm text-red-800 leading-relaxed">{errorMsg}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    // Shared workspace — other user's message: left-aligned with avatar
    if (isOtherUser) {
      const otherName = message.sender_name || '用户';
      const initial = otherName[0]?.toUpperCase() || '?';
      return (
        <div className="group mb-4">
          <div className="flex items-center gap-2 mb-1.5 lg:hidden">
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">
              {initial}
            </div>
            <span className="text-xs text-muted-foreground font-medium">{otherName}</span>
            {showTime && <span className="text-xs text-muted-foreground">{time}</span>}
          </div>

          <div className="lg:flex lg:gap-3">
            <div className="hidden lg:block flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                {initial}
              </div>
            </div>
            <div className="flex-1 min-w-0 max-w-[85%] lg:max-w-[75%]">
              <div className="hidden lg:flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground font-medium">{otherName}</span>
                {showTime && <span className="text-xs text-muted-foreground">{time}</span>}
              </div>
              <div className="relative">
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {images.map((img, i) => (
                      <img
                        key={i}
                        src={imageUrls[i]}
                        alt={img.name || `图片 ${i + 1}`}
                        className="max-h-48 max-w-48 cursor-pointer rounded-lg border border-border/70 object-cover shadow-[0_6px_14px_rgba(15,23,42,0.1)] transition hover:border-brand-300"
                        onClick={() => setExpandedImageIndex(i)}
                      />
                    ))}
                  </div>
                )}
                <div className="rounded-xl rounded-tl-none border border-sidebar-border bg-card px-4 py-3 text-foreground shadow-[0_4px_14px_rgba(15,23,42,0.06)]">
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
                </div>
                <button
                  onClick={handleCopy}
                  className="absolute -right-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="复制"
                  aria-label="复制消息"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {expandedImageIndex !== null && (
            <ImageLightbox
              images={imageUrls}
              initialIndex={expandedImageIndex}
              onClose={() => setExpandedImageIndex(null)}
            />
          )}
        </div>
      );
    }

    // User message (own): right-aligned
    const showSenderLabel = isShared;
    return (
      <div className="group flex justify-end mb-4">
        <div className="flex flex-col items-end max-w-[85%] lg:max-w-[75%] min-w-0">
          {showSenderLabel && (
            <span className="text-xs text-muted-foreground font-medium mb-1 mr-1">
              {message.sender_name || currentUser?.display_name || currentUser?.username || '我'}
            </span>
          )}
          <div className="relative">
            {/* Image attachments */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 justify-end">
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={imageUrls[i]}
                    alt={img.name || `图片 ${i + 1}`}
                    className="max-h-48 max-w-48 cursor-pointer rounded-lg border border-brand-200/80 object-cover shadow-[0_6px_14px_rgba(15,23,42,0.1)] transition hover:border-brand-300"
                    onClick={() => setExpandedImageIndex(i)}
                  />
                ))}
              </div>
            )}
            <div className="rounded-xl rounded-tr-none border border-brand-200 bg-brand-50/85 px-4 py-3 text-foreground shadow-[0_4px_14px_rgba(15,23,42,0.06)]">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.content}</p>
            </div>
            <button
              onClick={handleCopy}
              className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity cursor-pointer"
              title="复制"
              aria-label="复制消息"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          {showTime && (
            <span className="text-xs text-muted-foreground mt-1.5 mr-1">{time}</span>
          )}
        </div>

        {expandedImageIndex !== null && (
          <ImageLightbox
            images={imageUrls}
            initialIndex={expandedImageIndex}
            onClose={() => setExpandedImageIndex(null)}
          />
        )}
      </div>
    );
  }

  // AI message: avatar + card layout — user-level AI appearance takes priority
  const senderName = currentUser?.ai_name || appearance?.aiName || message.sender_name || 'AI';
  const providerLabel = getMessageProviderLabel(message.provider);
  const aiEmoji = currentUser?.ai_avatar_emoji || appearance?.aiAvatarEmoji;
  const aiColor = currentUser?.ai_avatar_color || appearance?.aiAvatarColor;

  return (
    <div className="group mb-4">
      {/* Mobile: compact avatar + name row */}
      <div className="flex items-center gap-2 mb-1.5 lg:hidden">
        <EmojiAvatar emoji={aiEmoji} color={aiColor} fallbackChar={senderName[0]} size="sm" />
        <span className="text-xs text-muted-foreground font-medium">{senderName}</span>
        {providerLabel && (
          <span className="inline-flex items-center rounded-full border border-border/70 bg-card/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {providerLabel}
          </span>
        )}
        {showTime && <span className="text-xs text-muted-foreground">{time}</span>}
      </div>

      {/* Desktop: horizontal avatar + content layout */}
      <div className="lg:flex lg:gap-3">
        <div className="hidden lg:block flex-shrink-0">
          <EmojiAvatar emoji={aiEmoji} color={aiColor} fallbackChar={senderName[0]} size="md" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Desktop: name + time row */}
          <div className="hidden lg:flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground font-medium">{senderName}</span>
            {providerLabel && (
              <span className="inline-flex items-center rounded-full border border-border/70 bg-card/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {providerLabel}
              </span>
            )}
            {showTime && <span className="text-xs text-muted-foreground">{time}</span>}
          </div>

          {/* Card */}
          <div className="relative overflow-hidden rounded-xl rounded-tl-none border border-sidebar-border bg-card px-4 py-4 shadow-[0_4px_18px_-2px_rgba(15,23,42,0.05)]">
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground/70 opacity-60 transition-opacity hover:border-border/70 hover:bg-muted hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
              title="复制"
              aria-label="复制消息"
            >
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            </button>

            {/* Reasoning block */}
            {thinkingContent && <ReasoningBlock content={thinkingContent} />}

            {/* Image attachments */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={imageUrls[i]}
                    alt={img.name || `图片 ${i + 1}`}
                    className="max-w-48 max-h-48 rounded-lg object-cover cursor-pointer border border-border/70 hover:border-primary transition-colors"
                    onClick={() => setExpandedImageIndex(i)}
                  />
                ))}
              </div>
            )}

            {/* Content */}
            <div className="max-w-none overflow-hidden">
              <MarkdownRenderer content={message.content} groupJid={message.chat_jid} variant="chat" />
            </div>
          </div>
        </div>
      </div>

      {expandedImageIndex !== null && (
        <ImageLightbox
          images={imageUrls}
          initialIndex={expandedImageIndex}
          onClose={() => setExpandedImageIndex(null)}
        />
      )}
    </div>
  );
}, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.provider === next.message.provider &&
  prev.showTime === next.showTime &&
  prev.thinkingContent === next.thinkingContent &&
  prev.isShared === next.isShared
);
