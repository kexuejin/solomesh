import type { AgentProvider } from './agent-providers.js';

export const KNOWN_RUNTIME_MEMORY_FILE_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
] as const;

export type RuntimeMemoryFileName =
  (typeof KNOWN_RUNTIME_MEMORY_FILE_NAMES)[number];

const KNOWN_RUNTIME_MEMORY_FILE_NAME_SET = new Set<string>(
  KNOWN_RUNTIME_MEMORY_FILE_NAMES,
);

const RUNTIME_MEMORY_PROFILE_TABLE: Record<
  AgentProvider,
  readonly RuntimeMemoryFileName[]
> = {
  claude: ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'],
  codex: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'],
  gemini: ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md'],
};

export function getPrimaryMemoryFileName(
  provider: AgentProvider,
): RuntimeMemoryFileName {
  return RUNTIME_MEMORY_PROFILE_TABLE[provider][0];
}

export function listRuntimeMemoryFileNames(
  provider?: AgentProvider,
): RuntimeMemoryFileName[] {
  if (!provider) return [...KNOWN_RUNTIME_MEMORY_FILE_NAMES];
  return [...RUNTIME_MEMORY_PROFILE_TABLE[provider]];
}

export function isRuntimeMemoryFileName(
  fileName: string,
): fileName is RuntimeMemoryFileName {
  return KNOWN_RUNTIME_MEMORY_FILE_NAME_SET.has(fileName);
}

export function listCompanionRuntimeMemoryFileNames(
  fileName: RuntimeMemoryFileName,
): RuntimeMemoryFileName[] {
  return KNOWN_RUNTIME_MEMORY_FILE_NAMES.filter((name) => name !== fileName);
}
