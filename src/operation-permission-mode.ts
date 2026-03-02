export type OperationPermissionMode = 'default' | 'bypass';
export type OperationPermissionRuntime = 'claude' | 'codex' | 'gemini';

const chatRequestedOperationPermissionModes = new Map<string, OperationPermissionMode>();
const DEFAULT_OPERATION_PERMISSION_MODE_BY_RUNTIME: Record<
  OperationPermissionRuntime,
  OperationPermissionMode
> = {
  claude: 'bypass',
  codex: 'default',
  gemini: 'default',
};

export function normalizeOperationPermissionMode(
  value: unknown,
): OperationPermissionMode | undefined {
  if (value === 'default' || value === 'bypass') return value;
  return undefined;
}

export function setChatRequestedOperationPermissionMode(
  chatJid: string,
  mode: OperationPermissionMode | undefined,
): void {
  if (!chatJid) return;
  if (!mode) {
    chatRequestedOperationPermissionModes.delete(chatJid);
    return;
  }
  chatRequestedOperationPermissionModes.set(chatJid, mode);
}

export function getChatRequestedOperationPermissionMode(
  chatJid: string,
): OperationPermissionMode | undefined {
  if (!chatJid) return undefined;
  return chatRequestedOperationPermissionModes.get(chatJid);
}

export function resolveOperationPermissionModeForRuntime(
  runtime: OperationPermissionRuntime,
  requested: OperationPermissionMode | undefined,
): OperationPermissionMode {
  if (requested === 'default' || requested === 'bypass') {
    return requested;
  }
  return DEFAULT_OPERATION_PERMISSION_MODE_BY_RUNTIME[runtime];
}

export function mapClaudePermissionMode(
  mode: OperationPermissionMode,
): 'default' | 'bypassPermissions' {
  return mode === 'default' ? 'default' : 'bypassPermissions';
}
