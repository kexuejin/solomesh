import type { AgentProvider } from './agent-providers.js';
import { getProviderRuntime } from './provider-runtime.js';

export const RUNTIME_PRIMARY_MEMORY_FILE_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
] as const;

export type RuntimePrimaryMemoryFileName =
  (typeof RUNTIME_PRIMARY_MEMORY_FILE_NAMES)[number];

const PRIMARY_MEMORY_FILE_NAME_SET = new Set<string>(
  RUNTIME_PRIMARY_MEMORY_FILE_NAMES,
);

export function getPrimaryMemoryFileName(provider: AgentProvider): string {
  return getProviderRuntime(provider).primaryMemoryFileName;
}

export function listRuntimePrimaryMemoryFileNames(
  preferredProvider?: AgentProvider,
): RuntimePrimaryMemoryFileName[] {
  if (!preferredProvider) return [...RUNTIME_PRIMARY_MEMORY_FILE_NAMES];
  const preferred = getPrimaryMemoryFileName(
    preferredProvider,
  ) as RuntimePrimaryMemoryFileName;
  if (preferred === 'AGENTS.md') return ['AGENTS.md', 'CLAUDE.md'];
  return ['CLAUDE.md', 'AGENTS.md'];
}

export function isRuntimePrimaryMemoryFileName(
  fileName: string,
): fileName is RuntimePrimaryMemoryFileName {
  return PRIMARY_MEMORY_FILE_NAME_SET.has(fileName);
}

export function getCompanionPrimaryMemoryFileName(
  fileName: RuntimePrimaryMemoryFileName,
): RuntimePrimaryMemoryFileName {
  return fileName === 'CLAUDE.md' ? 'AGENTS.md' : 'CLAUDE.md';
}
