import type {
  AccessLinkRequest,
  RemoteAccessLinkPreferences,
} from './types.js';

const REMOTE_ACCESS_REQUEST_PATTERNS = [
  /(?:远程访问|远程链接|访问链接|外网访问|内网穿透)/i,
  /\bremote\s*access\b/i,
  /\baccess\s*link\b/i,
  /\btunnel\b/i,
];

export function looksLikeRemoteAccessLinkRequest(text: string): boolean {
  const input = text.trim();
  if (!input) return false;
  return REMOTE_ACCESS_REQUEST_PATTERNS.some((pattern) => pattern.test(input));
}

export function buildWorkspaceChatPath(folder: string): string {
  const normalized = folder.trim();
  if (!normalized) return '/chat';
  return `/chat/${encodeURIComponent(normalized)}`;
}

export function buildWorkspacePublicEntryPath(folder: string): string {
  return buildWorkspaceChatPath(folder);
}

export function buildWorkspaceAccessLinkRequest(
  folder: string,
  preferences: RemoteAccessLinkPreferences,
): AccessLinkRequest {
  const path = buildWorkspacePublicEntryPath(folder);
  if (preferences.mode === 'public') {
    return {
      mode: 'public',
      path,
    };
  }
  return {
    mode: 'token',
    ttlSeconds: preferences.ttlSeconds,
    oneTime: preferences.oneTime,
    path,
  };
}
