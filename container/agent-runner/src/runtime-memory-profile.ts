export type AgentRuntimeId = 'claude' | 'codex' | 'gemini';

export const KNOWN_RUNTIME_MEMORY_FILE_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
] as const;

type RuntimeMemoryFileName = (typeof KNOWN_RUNTIME_MEMORY_FILE_NAMES)[number];

const RUNTIME_MEMORY_PROFILE_TABLE: Record<
  AgentRuntimeId,
  readonly RuntimeMemoryFileName[]
> = {
  claude: ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'],
  codex: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'],
  gemini: ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md'],
};

export function getPrimaryMemoryFileName(
  runtime: AgentRuntimeId,
): RuntimeMemoryFileName {
  return RUNTIME_MEMORY_PROFILE_TABLE[runtime][0];
}
