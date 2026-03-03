import { useState, useRef, useEffect } from 'react';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowUp,
  Brush,
  FileUp,
  FolderUp,
  X,
  Paperclip,
  Image as ImageIcon,
  TerminalSquare,
} from 'lucide-react';
import { useFileStore } from '../../stores/files';
import { api } from '../../api/client';
import type { ProviderId } from '@/lib/provider-directive';
import {
  getProviderMentionSuggestions,
  parseProviderDirectiveInput,
} from '@/lib/provider-directive';
import { getMessageProviderLabel } from '@/lib/message-provider';
import {
  getWorkflowCommandSuggestions,
  type WorkflowCommandSuggestion,
  type WorkflowTemplateSuggestionSource,
} from '@/lib/workflow-directive';
import { useI18n } from '../../i18n';
import {
  DEFAULT_RUNTIME_DEFINITIONS,
  normalizeRuntimeDefinitions,
  type RuntimeDefinition,
} from '../../runtime-definitions';

interface PendingFile {
  /** Display name: relative path for folder uploads, file name otherwise */
  label: string;
}

interface PendingImage {
  name: string;
  data: string; // base64 data
  mimeType: string;
  preview: string; // object URL for preview
}

/** Max size per image is 5MB. */
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
type OperationPermissionMode = 'default' | 'bypass';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface MessageInputSendOptions {
  operationPermissionMode?: OperationPermissionMode;
  agentRuntimeOverride?: ProviderId;
  modelOverride?: string;
  reasoningEffort?: ReasoningEffort;
}

interface OperationPermissionModeOption {
  value: OperationPermissionMode;
  label: string;
  hint: string;
}

const DEFAULT_PERMISSION_MODE_BY_PROVIDER: Record<ProviderId, OperationPermissionMode> = {
  claude: 'bypass',
  codex: 'default',
  gemini: 'default',
};

const PROVIDER_OPTIONS: ProviderId[] = ['claude', 'codex', 'gemini'];
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const MODEL_AUTO_OPTION_VALUE = '__auto__';
const CLAUDE_MODEL_ALIAS_TO_ID: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};
const DEFAULT_MODEL_OVERRIDE_BY_PROVIDER: Record<ProviderId, string> = {
  claude: '',
  codex: '',
  gemini: '',
};
const DEFAULT_REASONING_EFFORT_BY_PROVIDER: Record<ProviderId, ReasoningEffort> = {
  claude: 'medium',
  codex: 'medium',
  gemini: 'medium',
};
const RUNTIME_DEFINITIONS_CACHE_KEY = 'solomesh:chat:runtime-definitions:v5';
const RUNTIME_DEFINITIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const RUNTIME_CONTROL_SELECTIONS_CACHE_KEY = 'solomesh:chat:runtime-controls:v1';

interface RuntimeDefinitionsCachePayload {
  ts: number;
  runtimes: unknown;
}

interface RuntimeControlSelections {
  modelOverrideByProvider: Record<ProviderId, string>;
  reasoningEffortByProvider: Record<ProviderId, ReasoningEffort>;
  permissionModeByProvider: Record<ProviderId, OperationPermissionMode>;
}

interface RuntimeControlSelectionsCachePayload {
  modelOverrideByProvider?: unknown;
  reasoningEffortByProvider?: unknown;
  permissionModeByProvider?: unknown;
}

function isObjectRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input);
}

function getDefaultRuntimeControlSelections(): RuntimeControlSelections {
  return {
    modelOverrideByProvider: { ...DEFAULT_MODEL_OVERRIDE_BY_PROVIDER },
    reasoningEffortByProvider: { ...DEFAULT_REASONING_EFFORT_BY_PROVIDER },
    permissionModeByProvider: { ...DEFAULT_PERMISSION_MODE_BY_PROVIDER },
  };
}

function normalizeRuntimeModelOverride(provider: ProviderId, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (provider !== 'claude') return trimmed;
  return CLAUDE_MODEL_ALIAS_TO_ID[trimmed] ?? trimmed;
}

function normalizeModelOverrideByProvider(input: unknown): Record<ProviderId, string> {
  const normalized = { ...DEFAULT_MODEL_OVERRIDE_BY_PROVIDER };
  if (!isObjectRecord(input)) return normalized;
  for (const provider of PROVIDER_OPTIONS) {
    const value = input[provider];
    if (typeof value === 'string') {
      normalized[provider] = normalizeRuntimeModelOverride(provider, value);
    }
  }
  return normalized;
}

function normalizeReasoningEffortByProvider(input: unknown): Record<ProviderId, ReasoningEffort> {
  const normalized = { ...DEFAULT_REASONING_EFFORT_BY_PROVIDER };
  if (!isObjectRecord(input)) return normalized;
  for (const provider of PROVIDER_OPTIONS) {
    const value = input[provider];
    if (
      typeof value === 'string'
      && REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort)
    ) {
      normalized[provider] = value as ReasoningEffort;
    }
  }
  return normalized;
}

function normalizePermissionModeByProvider(input: unknown): Record<ProviderId, OperationPermissionMode> {
  const normalized = { ...DEFAULT_PERMISSION_MODE_BY_PROVIDER };
  if (!isObjectRecord(input)) return normalized;
  for (const provider of PROVIDER_OPTIONS) {
    const value = input[provider];
    if (value === 'default' || value === 'bypass') {
      normalized[provider] = value;
    }
  }
  return normalized;
}

function readRuntimeControlSelectionsCache(): RuntimeControlSelections | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RUNTIME_CONTROL_SELECTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RuntimeControlSelectionsCachePayload;
    if (!isObjectRecord(parsed)) return null;
    return {
      modelOverrideByProvider: normalizeModelOverrideByProvider(parsed.modelOverrideByProvider),
      reasoningEffortByProvider: normalizeReasoningEffortByProvider(parsed.reasoningEffortByProvider),
      permissionModeByProvider: normalizePermissionModeByProvider(parsed.permissionModeByProvider),
    };
  } catch {
    return null;
  }
}

function writeRuntimeControlSelectionsCache(selections: RuntimeControlSelections): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RUNTIME_CONTROL_SELECTIONS_CACHE_KEY,
      JSON.stringify(selections),
    );
  } catch {
    // Best effort cache
  }
}

function hasExpectedRuntimeCatalog(runtimes: RuntimeDefinition[]): boolean {
  const codex = runtimes.find((item) => item.id === 'codex');
  const claude = runtimes.find((item) => item.id === 'claude');
  if (!codex || !claude) return false;
  return codex.supportedModels.includes('gpt-5.3-codex')
    && claude.supportedModels.includes('claude-opus-4-6');
}

function readRuntimeDefinitionsCache(): {
  runtimes: RuntimeDefinition[];
  isFresh: boolean;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RUNTIME_DEFINITIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RuntimeDefinitionsCachePayload;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.ts !== 'number') {
      return null;
    }
    const runtimes = normalizeRuntimeDefinitions(parsed.runtimes);
    if (runtimes.length === 0) return null;
    if (!hasExpectedRuntimeCatalog(runtimes)) return null;
    return {
      runtimes,
      isFresh: Date.now() - parsed.ts < RUNTIME_DEFINITIONS_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeRuntimeDefinitionsCache(runtimes: RuntimeDefinition[]): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: RuntimeDefinitionsCachePayload = {
      ts: Date.now(),
      runtimes,
    };
    window.localStorage.setItem(RUNTIME_DEFINITIONS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Best effort cache
  }
}

interface MessageInputProps {
  onSend: (
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    options?: MessageInputSendOptions,
  ) => void;
  groupJid?: string;
  disabled?: boolean;
  currentProvider?: ProviderId | null;
  workflowContext?: {
    status?: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
    templateId?: string | null;
    stageName?: string | null;
    stageProvider?: ProviderId | null;
  } | null;
  queuedMessages?: Array<{
    id: string;
    content: string;
    attachments?: Array<{ data: string; mimeType: string }>;
  }>;
  onRemoveQueuedMessage?: (queuedMessageId: string) => void;
  onClearQueuedMessages?: () => void;
  onResetSession?: () => void;
  onToggleTerminal?: () => void;
}

interface WorkflowTemplatesVisibleResponse {
  templates?: Array<{
    template?: {
      id?: string;
      name?: string;
      description?: string;
    };
  }>;
}

export function MessageInput({
  onSend,
  groupJid,
  disabled = false,
  currentProvider = null,
  workflowContext = null,
  queuedMessages = [],
  onRemoveQueuedMessage,
  onClearQueuedMessages,
  onResetSession,
  onToggleTerminal,
}: MessageInputProps) {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mentionReplaceRangeRef = useRef<{ start: number; end: number } | null>(null);
  const commandReplaceRangeRef = useRef<{ start: number; end: number } | null>(null);
  const mentionCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { uploadFiles, uploading, uploadProgress } = useFileStore();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<ProviderId[]>([]);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSuggestions, setCommandSuggestions] = useState<WorkflowCommandSuggestion[]>([]);
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
  const [workflowTemplateSuggestions, setWorkflowTemplateSuggestions] = useState<WorkflowTemplateSuggestionSource[]>([]);
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>(
    DEFAULT_RUNTIME_DEFINITIONS,
  );
  const initialRuntimeControlSelectionsRef = useRef<RuntimeControlSelections | null>(null);
  if (!initialRuntimeControlSelectionsRef.current) {
    initialRuntimeControlSelectionsRef.current =
      readRuntimeControlSelectionsCache() ?? getDefaultRuntimeControlSelections();
  }
  const initialRuntimeControlSelections = initialRuntimeControlSelectionsRef.current;
  const [selectedRuntime, setSelectedRuntime] = useState<ProviderId>(
    currentProvider ?? 'claude',
  );
  const [modelOverrideByProvider, setModelOverrideByProvider] = useState<Record<ProviderId, string>>(
    initialRuntimeControlSelections.modelOverrideByProvider,
  );
  const [reasoningEffortByProvider, setReasoningEffortByProvider] = useState<Record<ProviderId, ReasoningEffort>>(
    initialRuntimeControlSelections.reasoningEffortByProvider,
  );
  const [permissionModeByProvider, setPermissionModeByProvider] = useState<Record<ProviderId, OperationPermissionMode>>(
    initialRuntimeControlSelections.permissionModeByProvider,
  );
  const permissionModeOptionsByProvider: Record<ProviderId, OperationPermissionModeOption[]> = {
    claude: [
      {
        value: 'default',
        label: t('chat.messageInput.permission.defaultLabel'),
        hint: t('chat.messageInput.permission.hintClaudeDefault'),
      },
      {
        value: 'bypass',
        label: t('chat.messageInput.permission.bypassLabel'),
        hint: t('chat.messageInput.permission.hintClaudeBypass'),
      },
    ],
    codex: [
      {
        value: 'default',
        label: t('chat.messageInput.permission.defaultLabel'),
        hint: t('chat.messageInput.permission.hintCodexDefault'),
      },
      {
        value: 'bypass',
        label: t('chat.messageInput.permission.bypassLabel'),
        hint: t('chat.messageInput.permission.hintCodexBypass'),
      },
    ],
    gemini: [
      {
        value: 'default',
        label: t('chat.messageInput.permission.defaultLabel'),
        hint: t('chat.messageInput.permission.hintGeminiDefault'),
      },
      {
        value: 'bypass',
        label: t('chat.messageInput.permission.bypassLabel'),
        hint: t('chat.messageInput.permission.hintGeminiBypass'),
      },
    ],
  };

  const getResolvedPermissionMode = (
    provider: ProviderId,
    requested?: OperationPermissionMode,
  ): OperationPermissionMode => {
    return requested === 'default' || requested === 'bypass'
      ? requested
      : DEFAULT_PERMISSION_MODE_BY_PROVIDER[provider];
  };

  useEffect(() => {
    if (!currentProvider) return;
    setSelectedRuntime(currentProvider);
  }, [currentProvider]);

  useEffect(() => {
    writeRuntimeControlSelectionsCache({
      modelOverrideByProvider,
      reasoningEffortByProvider,
      permissionModeByProvider,
    });
  }, [modelOverrideByProvider, reasoningEffortByProvider, permissionModeByProvider]);

  useEffect(() => {
    let cancelled = false;
    const cached = readRuntimeDefinitionsCache();
    if (cached?.runtimes.length) {
      setRuntimeDefinitions(cached.runtimes);
      if (cached.isFresh) {
        return () => {
          cancelled = true;
        };
      }
    }
    const loadRuntimeDefinitions = async () => {
      try {
        const data = await api.get<{ runtimes: unknown }>('/api/config/runtimes');
        if (cancelled) return;
        const normalized = normalizeRuntimeDefinitions(data.runtimes);
        setRuntimeDefinitions(normalized);
        writeRuntimeDefinitionsCache(normalized);
      } catch {
        if (cancelled) return;
        if (!cached?.runtimes.length) {
          setRuntimeDefinitions(DEFAULT_RUNTIME_DEFINITIONS);
        }
      }
    };
    void loadRuntimeDefinitions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWorkflowTemplateIds = async () => {
      try {
        const resp = await api.get<WorkflowTemplatesVisibleResponse>('/api/workflows/templates?view=visible');
        if (cancelled) return;
        const byId = new Map<string, WorkflowTemplateSuggestionSource>();
        for (const item of resp.templates ?? []) {
          const template = item.template;
          const id = typeof template?.id === 'string'
            ? template.id.trim().toLowerCase()
            : '';
          if (!id) continue;
          if (byId.has(id)) continue;
          byId.set(id, {
            id,
            name: typeof template?.name === 'string' ? template.name.trim() : undefined,
            description: typeof template?.description === 'string'
              ? template.description.trim()
              : undefined,
          });
        }
        const suggestions = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
        setWorkflowTemplateSuggestions(suggestions);
      } catch {
        if (cancelled) return;
        setWorkflowTemplateSuggestions([]);
      }
    };
    void loadWorkflowTemplateIds();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mentionCloseTimerRef.current) {
        clearTimeout(mentionCloseTimerRef.current);
      }
    };
  }, []);

  // iOS keyboard adaptation
  useKeyboardHeight();

  // Auto-resize textarea (1-6 lines)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const lineHeight = 24;
    const maxHeight = lineHeight * 6;
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [content]);

  // IME composition state — prevent Enter from sending while composing.
  const composingRef = useRef(false);

  const closeMention = () => {
    mentionReplaceRangeRef.current = null;
    setMentionOpen(false);
    setMentionSuggestions([]);
    setMentionActiveIndex(0);
  };

  const closeCommand = () => {
    commandReplaceRangeRef.current = null;
    setCommandOpen(false);
    setCommandSuggestions([]);
    setCommandActiveIndex(0);
  };

  const refreshMentionSuggestions = (nextContent: string, caret: number | null): boolean => {
    if (disabled || caret === null || caret < 0) {
      closeMention();
      return false;
    }
    const beforeCaret = nextContent.slice(0, caret);
    const match = beforeCaret.match(/^(\s*)@([a-z]*)$/i);
    if (!match) {
      closeMention();
      return false;
    }
    const query = (match[2] || '').toLowerCase();
    const providers = getProviderMentionSuggestions({
      query,
      currentProvider,
    });
    if (providers.length === 0) {
      closeMention();
      return false;
    }
    const mentionStart = beforeCaret.lastIndexOf('@');
    mentionReplaceRangeRef.current = { start: mentionStart, end: caret };
    setMentionSuggestions(providers);
    setMentionOpen(true);
    setMentionActiveIndex(0);
    return true;
  };

  const refreshCommandSuggestions = (nextContent: string, caret: number | null): boolean => {
    if (disabled || caret === null || caret < 0) {
      closeCommand();
      return false;
    }
    const beforeCaret = nextContent.slice(0, caret);
    const suggestions = getWorkflowCommandSuggestions(beforeCaret, {
      templates: workflowTemplateSuggestions,
    });
    if (suggestions.length === 0) {
      closeCommand();
      return false;
    }
    const leadingSpacesLen = beforeCaret.length - beforeCaret.trimStart().length;
    commandReplaceRangeRef.current = { start: leadingSpacesLen, end: caret };
    setCommandSuggestions(suggestions);
    setCommandOpen(true);
    setCommandActiveIndex(0);
    return true;
  };

  const refreshInputSuggestions = (nextContent: string, caret: number | null) => {
    const hasMention = refreshMentionSuggestions(nextContent, caret);
    if (hasMention) {
      closeCommand();
      return;
    }
    refreshCommandSuggestions(nextContent, caret);
  };

  const applyMentionSuggestion = (provider: ProviderId) => {
    const range = mentionReplaceRangeRef.current;
    if (!range) return;
    const replacement = `@${provider} `;
    const nextContent = `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`;
    setContent(nextContent);
    closeMention();
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextPos = range.start + replacement.length;
      textarea.focus();
      textarea.setSelectionRange(nextPos, nextPos);
    });
  };

  const applyCommandSuggestion = (command: WorkflowCommandSuggestion) => {
    const range = commandReplaceRangeRef.current;
    if (!range) return;
    const replacement = `${command.value} `;
    const nextContent = `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`;
    setContent(nextContent);
    closeCommand();
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextPos = range.start + replacement.length;
      textarea.focus();
      textarea.setSelectionRange(nextPos, nextPos);
    });
  };

  useEffect(() => {
    if (disabled) {
      closeMention();
      closeCommand();
    }
  }, [disabled]);

  const getCommandSuggestionDescription = (command: WorkflowCommandSuggestion): string => {
    if (command.descriptionKey) {
      return t(command.descriptionKey, command.descriptionParams);
    }
    return command.description || '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = mentionSuggestions[mentionActiveIndex] ?? mentionSuggestions[0];
        if (selected) applyMentionSuggestion(selected);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }

    if (commandOpen && commandSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandActiveIndex((prev) => (prev + 1) % commandSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandActiveIndex((prev) => (prev - 1 + commandSuggestions.length) % commandSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = commandSuggestions[commandActiveIndex] ?? commandSuggestions[0];
        if (selected) applyCommandSuggestion(selected);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommand();
        return;
      }
    }

    if (composingRef.current) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = content.trim();
    const hasPending = pendingFiles.length > 0;
    const hasImages = pendingImages.length > 0;

    if (!trimmed && !hasPending && !hasImages) return;
    if (disabled) return;

    let message = trimmed;

    if (hasPending) {
      const list = pendingFiles.map((f) => `- ${f.label}`).join('\n');
      // Keep this prefix stable because it becomes part of model input.
      const prefix = `[Uploaded files to workspace, please review and use]\n${list}`;
      message = message ? `${prefix}\n\n${message}` : prefix;
      setPendingFiles([]);
    }

    const attachments = hasImages
      ? pendingImages.map((img) => ({ data: img.data, mimeType: img.mimeType }))
      : undefined;

    const messageProvider = parseProviderDirectiveInput(message).provider
      ?? selectedRuntime
      ?? currentProvider
      ?? 'claude';
    const operationPermissionMode = getResolvedPermissionMode(
      messageProvider,
      permissionModeByProvider[messageProvider],
    );
    const normalizedModelOverride = modelOverrideByProvider[messageProvider]?.trim() || '';
    const modelOverride = normalizedModelOverride || undefined;
    const reasoningEffort =
      messageProvider === 'codex' || messageProvider === 'gemini'
        ? reasoningEffortByProvider[messageProvider]
      : undefined;

    onSend(message, attachments, {
      operationPermissionMode,
      agentRuntimeOverride: messageProvider,
      modelOverride,
      reasoningEffort,
    });
    setContent('');
    closeMention();
    closeCommand();

    // Clean up image previews
    if (hasImages) {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPendingImages([]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!groupJid) return;
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const files = Array.from(fileList);
      setShowActions(false);

      // Separate image files from regular files
      const imageFiles: File[] = [];
      const regularFiles: File[] = [];
      files.forEach((file) => {
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        } else {
          regularFiles.push(file);
        }
      });

      // Process image files
      if (imageFiles.length > 0) {
        const newImages: PendingImage[] = [];
        for (const file of imageFiles) {
          try {
            const base64 = await readFileAsBase64(file);
            newImages.push({
              name: file.name,
              data: base64,
              mimeType: file.type,
              preview: URL.createObjectURL(file),
            });
          } catch {
            // Skip failed images
          }
        }
        setPendingImages((prev) => [...prev, ...newImages]);
      }

      // Upload regular files to workspace
      if (regularFiles.length > 0) {
        const ok = await uploadFiles(groupJid, regularFiles);
        if (ok) {
          const newPending = regularFiles.map((f) => ({
            label: f.webkitRelativePath || f.name,
          }));
          setPendingFiles((prev) => [...prev, ...newPending]);
        }
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const files = Array.from(fileList);
      setShowActions(false);

      const newImages: PendingImage[] = [];
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          try {
            const base64 = await readFileAsBase64(file);
            newImages.push({
              name: file.name,
              data: base64,
              mimeType: file.type,
              preview: URL.createObjectURL(file),
            });
          } catch {
            // Skip failed images
          }
        }
      }
      setPendingImages((prev) => [...prev, ...newImages]);

      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return Promise.reject(new Error(t('chat.messageInput.imageTooLarge', {
        name: file.name,
        limitMB: Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024),
        sizeMB: (file.size / 1024 / 1024).toFixed(1),
      })));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault();
      const newImages: PendingImage[] = [];

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          try {
            const base64 = await readFileAsBase64(file);
            newImages.push({
              name: file.name || `pasted-${Date.now()}.png`,
              data: base64,
              mimeType: file.type,
              preview: URL.createObjectURL(file),
            });
          } catch {
            // Skip failed images
          }
        }
      }

      setPendingImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!groupJid) return;
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const files = Array.from(fileList);
      setShowActions(false);
      const ok = await uploadFiles(groupJid, files);
      if (ok) {
        const newPending = files.map((f) => ({
          label: f.webkitRelativePath || f.name,
        }));
        setPendingFiles((prev) => [...prev, ...newPending]);
      }
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const img = prev[index];
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const clearPendingFiles = () => {
    setPendingFiles([]);
  };

  const clearPendingImages = () => {
    pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
    setPendingImages([]);
  };

  const hasContent = content.trim().length > 0;
  const canSend = hasContent || pendingFiles.length > 0 || pendingImages.length > 0;
  const directiveProvider = parseProviderDirectiveInput(content).provider;
  const activePermissionProvider: ProviderId =
    directiveProvider ?? selectedRuntime ?? currentProvider ?? 'claude';
  const activeRuntimeDefinition = runtimeDefinitions.find(
    (item) => item.id === activePermissionProvider,
  ) || DEFAULT_RUNTIME_DEFINITIONS.find((item) => item.id === activePermissionProvider)
    || DEFAULT_RUNTIME_DEFINITIONS[0];
  const permissionModeOptions = permissionModeOptionsByProvider[activePermissionProvider];
  const selectedPermissionMode = getResolvedPermissionMode(
    activePermissionProvider,
    permissionModeByProvider[activePermissionProvider],
  );
  const selectedPermissionModeOption = permissionModeOptions.find(
    (item) => item.value === selectedPermissionMode,
  ) ?? permissionModeOptions[0];
  const runtimeSupportsModelOverride = activeRuntimeDefinition.capabilities.supportsModelOverride;
  const runtimeSupportsReasoningEffort =
    activePermissionProvider === 'codex' || activePermissionProvider === 'gemini';
  const modelOverrideValue = modelOverrideByProvider[activePermissionProvider] || '';
  const modelSelectValue = modelOverrideValue || MODEL_AUTO_OPTION_VALUE;
  const modelOptions = (() => {
    const baseOptions = activeRuntimeDefinition.supportedModels;
    if (modelOverrideValue && !baseOptions.includes(modelOverrideValue)) {
      return [modelOverrideValue, ...baseOptions];
    }
    return baseOptions;
  })();
  const activeReasoningEffort = reasoningEffortByProvider[activePermissionProvider];
  const workflowRunning =
    workflowContext?.status === 'running'
    && !!workflowContext.templateId;
  const workflowStageName = workflowContext?.stageName || t('chat.messageInput.workflowStageFallback');
  const workflowProviderHint = workflowContext?.stageProvider
    ? t('chat.messageInput.workflowProviderHint', { provider: workflowContext.stageProvider })
    : '';
  const inputPlaceholder = workflowRunning
    ? t('chat.messageInput.inputPlaceholderWorkflow', {
      stageName: workflowStageName,
      providerHint: workflowProviderHint,
    })
    : t('chat.messageInput.inputPlaceholderDefault');

  const progressPercent =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.round((uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100)
      : 0;

  return (
    <div
      className="ios-pwa-bottom-safe bg-background px-3 pb-3 pt-2 sm:px-4 sm:pb-4 lg:px-8 lg:pb-8 lg:pt-0 max-lg:border-t max-lg:border-border/70 max-lg:bg-card/70 max-lg:backdrop-blur-xl max-lg:saturate-[1.6]"
      style={{ paddingBottom: `max(0.75rem, var(--keyboard-height, 0px))` }}
    >
      <div className="mx-auto max-w-4xl">
        {queuedMessages.length > 0 && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-amber-800">
                {t('chat.messageInput.queued.title', { count: queuedMessages.length })}
              </span>
              {onClearQueuedMessages && (
                <button
                  onClick={onClearQueuedMessages}
                  className="ml-auto text-[11px] text-amber-700 hover:text-amber-900 cursor-pointer"
                >
                  {t('chat.messageInput.common.clear')}
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {queuedMessages.map((queued) => {
                const text = queued.content.trim();
                const preview = text.length > 48 ? `${text.slice(0, 48)}...` : text;
                const attachmentCount = queued.attachments?.length ?? 0;
                return (
                  <div
                    key={queued.id}
                    className="flex items-center gap-2 rounded-lg border border-amber-200/85 bg-amber-50/45 px-2 py-1"
                  >
                    <span className="text-[11px] text-amber-900 truncate">
                      {preview || t('chat.messageInput.queued.emptyMessage')}
                    </span>
                    {attachmentCount > 0 && (
                      <span className="text-[10px] text-amber-700 flex-shrink-0">
                        {t('chat.messageInput.queued.imagesCount', { count: attachmentCount })}
                      </span>
                    )}
                    {onRemoveQueuedMessage && (
                      <button
                        onClick={() => onRemoveQueuedMessage(queued.id)}
                        className="ml-auto text-[11px] text-amber-700 hover:text-amber-900 cursor-pointer"
                        aria-label={t('chat.messageInput.queued.removeAria')}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upload progress bar */}
        {uploading && uploadProgress && (
          <div className="mb-2 rounded-lg border border-border/70 bg-muted/10 px-4 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground truncate max-w-[65%]">
                {uploadProgress.currentFile || t('chat.messageInput.uploadProgress.done')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('chat.messageInput.uploadProgress.summary', {
                  completed: uploadProgress.completed,
                  total: uploadProgress.total,
                  percent: progressPercent,
                })}
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Main input card */}
        <div className="rounded-xl border border-sidebar-border bg-card shadow-[0_4px_20px_-2px_rgba(15,23,42,0.05)]">
          {/* Pending images preview */}
          {pendingImages.length > 0 && (
            <div className="px-3 pt-2.5 pb-1 border-b border-border/70">
              <div className="flex items-center gap-1 mb-1.5">
                <ImageIcon className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {t('chat.messageInput.pendingImages.addedCount', { count: pendingImages.length })}
                </span>
                <button
                  onClick={clearPendingImages}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {t('chat.messageInput.common.clear')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 pb-1.5">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.preview}
                      alt={img.name}
                      className="w-16 h-16 object-cover rounded-lg border border-border/70"
                    />
                    <button
                      onClick={() => removePendingImage(i)}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground cursor-pointer"
                      aria-label={t('chat.messageInput.pendingImages.removeAria')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending files chips */}
          {pendingFiles.length > 0 && (
            <div className="px-3 pt-2.5 pb-1 border-b border-border/70">
              <div className="flex items-center gap-1 mb-1">
                <Paperclip className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {t('chat.messageInput.pendingFiles.addedCount', { count: pendingFiles.length })}
                </span>
                <button
                  onClick={clearPendingFiles}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {t('chat.messageInput.common.clear')}
                </button>
              </div>
              <div className="flex flex-wrap gap-1 pb-1">
                {pendingFiles.map((file, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 max-w-[200px] px-2 py-0.5 bg-brand-50 text-primary text-[11px] rounded-md"
                  >
                    <span className="truncate">{file.label}</span>
                    <button
                      onClick={() => removePendingFile(i)}
                      className="flex-shrink-0 hover:text-primary cursor-pointer p-1 min-w-[28px] min-h-[28px] flex items-center justify-center"
                      aria-label={t('chat.messageInput.pendingFiles.removeAria')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action row — shown when attach is toggled */}
          {showActions && groupJid && (
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-border/70">
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                {t('chat.messageInput.actions.addImage')}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
              >
                <FileUp className="w-3.5 h-3.5" />
                {t('chat.messageInput.actions.uploadFile')}
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
                className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted hover:bg-muted rounded-lg transition-colors cursor-pointer disabled:opacity-40"
              >
                <FolderUp className="w-3.5 h-3.5" />
                {t('chat.messageInput.actions.uploadFolder')}
              </button>
            </div>
          )}

          {/* Textarea */}
          <div className="px-4 pt-3 pb-1">
            {workflowRunning && (
              <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                {t('chat.messageInput.workflow.bannerPrefix', {
                  templateId: workflowContext?.templateId || '',
                  stageName: workflowStageName,
                })}
                {workflowProviderHint}
                {t('chat.messageInput.workflow.bannerMiddle')}
                <code>/wf-next</code>
                {t('chat.messageInput.workflow.bannerSuffix')}
              </div>
            )}
            {mentionOpen && mentionSuggestions.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-lg border border-border/70 bg-muted/10">
                {mentionSuggestions.map((provider, idx) => (
                  <button
                    key={provider}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMentionSuggestion(provider);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      idx === mentionActiveIndex
                        ? 'bg-brand-50 text-primary'
                        : 'text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    @{provider}
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {t('chat.messageInput.mention.switchTo', { provider: getMessageProviderLabel(provider) ?? provider })}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!mentionOpen && commandOpen && commandSuggestions.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-lg border border-border/70 bg-muted/10">
                {commandSuggestions.map((command, idx) => (
                  <button
                    key={command.value}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyCommandSuggestion(command);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      idx === commandActiveIndex
                        ? 'bg-brand-50 text-primary'
                        : 'text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {command.value}
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {getCommandSuggestionDescription(command)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                const nextContent = e.target.value;
                setContent(nextContent);
                refreshInputSuggestions(nextContent, e.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onPaste={handlePaste}
              onSelect={(e) => {
                refreshInputSuggestions(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart,
                );
              }}
              onBlur={() => {
                if (mentionCloseTimerRef.current) {
                  clearTimeout(mentionCloseTimerRef.current);
                }
                mentionCloseTimerRef.current = setTimeout(() => {
                  closeMention();
                  closeCommand();
                }, 120);
              }}
              onFocus={(e) => {
                if (mentionCloseTimerRef.current) {
                  clearTimeout(mentionCloseTimerRef.current);
                  mentionCloseTimerRef.current = null;
                }
                refreshInputSuggestions(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart,
                );
              }}
              placeholder={inputPlaceholder}
              disabled={disabled}
              className="w-full text-[15px] leading-6 resize-none focus:outline-none placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed bg-transparent"
              rows={1}
              style={{ minHeight: '28px', maxHeight: '144px' }}
            />
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center px-2 pb-2.5">
            {/* Left: action icons */}
            <div className="flex items-center gap-0.5">
              {groupJid && (
                <button
                  type="button"
                  onClick={() => setShowActions(!showActions)}
                  disabled={uploading}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all cursor-pointer ${
                    showActions
                      ? 'bg-brand-50 text-primary'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  } ${uploading ? 'opacity-40 pointer-events-none' : ''}`}
                  title={t('chat.messageInput.actions.attachFiles')}
                  aria-label={t('chat.messageInput.actions.attachFiles')}
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              )}
              {onResetSession && (
                <button
                  type="button"
                  onClick={onResetSession}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-amber-50 hover:text-amber-600 cursor-pointer"
                  title={t('chat.messageInput.actions.clearContext')}
                >
                  <Brush className="w-4 h-4" />
                </button>
              )}
              {onToggleTerminal && (
                <button
                  type="button"
                  onClick={onToggleTerminal}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-brand-50 hover:text-primary cursor-pointer"
                  title={t('chat.messageInput.actions.terminal')}
                  aria-label={t('chat.messageInput.actions.terminal')}
                >
                  <TerminalSquare className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Right: send button */}
            <button
              onClick={handleSend}
              disabled={!canSend || disabled}
              className={`flex h-8 w-8 items-center justify-center rounded-[10px] transition-all cursor-pointer active:scale-90 ${
                canSend && !disabled
                  ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_8px_18px_rgba(15,107,255,0.24)]'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              <ArrowUp className="w-4.5 h-4.5" />
            </button>
          </div>

          <div className="border-t border-border/70 px-3 pb-2.5 pt-2">
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              <div className="flex min-w-0 items-center">
                <Select
                  value={selectedRuntime}
                  onValueChange={(value) => setSelectedRuntime(value as ProviderId)}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-[84px] rounded-[10px] border-border/70 bg-muted/20 px-2 text-[11px] sm:min-w-[112px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="top"
                    align="start"
                    className="min-w-[130px] sm:min-w-[160px]"
                  >
                    {PROVIDER_OPTIONS.map((provider) => (
                      <SelectItem key={`runtime-${provider}`} value={provider} className="text-xs">
                        {getMessageProviderLabel(provider) ?? provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {runtimeSupportsModelOverride && (
                <div className="flex min-w-0 items-center">
                  <Select
                    value={modelSelectValue}
                    onValueChange={(value) => {
                      setModelOverrideByProvider((prev) => ({
                        ...prev,
                        [activePermissionProvider]:
                          value === MODEL_AUTO_OPTION_VALUE ? '' : value,
                      }));
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-7 min-w-[120px] rounded-[10px] border-border/70 bg-muted/20 px-2 text-[11px] sm:min-w-[150px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="top"
                      align="start"
                      className="min-w-[160px] sm:min-w-[220px]"
                    >
                      <SelectItem value={MODEL_AUTO_OPTION_VALUE} className="text-xs">
                        Auto ({activeRuntimeDefinition.defaultModel})
                      </SelectItem>
                      {modelOptions.map((model) => (
                        <SelectItem key={`model-${activePermissionProvider}-${model}`} value={model} className="text-xs">
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {runtimeSupportsReasoningEffort && (
                <div className="flex min-w-0 items-center">
                  <Select
                    value={activeReasoningEffort}
                    onValueChange={(value) => {
                      setReasoningEffortByProvider((prev) => ({
                        ...prev,
                        [activePermissionProvider]: value as ReasoningEffort,
                      }));
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-7 min-w-[82px] rounded-[10px] border-border/70 bg-muted/20 px-2 text-[11px] sm:min-w-[96px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      side="top"
                      align="start"
                      className="min-w-[120px] sm:min-w-[140px]"
                    >
                      {REASONING_EFFORT_OPTIONS.map((level) => (
                        <SelectItem key={`reasoning-${level}`} value={level} className="text-xs">
                          {level === 'low'
                            ? '低'
                            : level === 'medium'
                              ? '中'
                              : level === 'high'
                                ? '高'
                                : '超高'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex min-w-0 items-center">
                <Select
                  value={selectedPermissionMode}
                  onValueChange={(value) => {
                    setPermissionModeByProvider((prev) => ({
                      ...prev,
                      [activePermissionProvider]: getResolvedPermissionMode(
                        activePermissionProvider,
                        value as OperationPermissionMode,
                      ),
                    }));
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-[96px] rounded-[10px] border-border/70 bg-muted/20 px-2 text-[11px] sm:min-w-[118px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="top"
                    align="start"
                    className="min-w-[150px] sm:min-w-[180px]"
                  >
                    {permissionModeOptions.map((option) => (
                      <SelectItem
                        key={`${activePermissionProvider}-${option.value}`}
                        value={option.value}
                        className="text-xs"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
              {selectedPermissionModeOption?.hint}
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleImageSelect}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        onChange={handleFolderSelect}
        className="hidden"
        disabled={uploading}
      />
    </div>
  );
}
