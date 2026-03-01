export type AgentRuntimeId = 'claude' | 'codex' | 'gemini';

export const KNOWN_RUNTIME_MEMORY_FILE_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
] as const;

type RuntimeMemoryFileName = (typeof KNOWN_RUNTIME_MEMORY_FILE_NAMES)[number];

export interface RuntimeMemoryMigrationHint {
  sourceFileNames: RuntimeMemoryFileName[];
  strategy: 'newest_wins';
}

export interface RuntimeMemoryProfilePlugin {
  runtime: AgentRuntimeId;
  primaryFileName: RuntimeMemoryFileName;
  compatibleFileNames: RuntimeMemoryFileName[];
  migrationHint: RuntimeMemoryMigrationHint;
}

const RUNTIME_MEMORY_PROFILE_PLUGINS: RuntimeMemoryProfilePlugin[] = [
  {
    runtime: 'claude',
    primaryFileName: 'CLAUDE.md',
    compatibleFileNames: ['AGENTS.md', 'GEMINI.md'],
    migrationHint: {
      sourceFileNames: ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'],
      strategy: 'newest_wins',
    },
  },
  {
    runtime: 'codex',
    primaryFileName: 'AGENTS.md',
    compatibleFileNames: ['CLAUDE.md', 'GEMINI.md'],
    migrationHint: {
      sourceFileNames: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'],
      strategy: 'newest_wins',
    },
  },
  {
    runtime: 'gemini',
    primaryFileName: 'GEMINI.md',
    compatibleFileNames: ['AGENTS.md', 'CLAUDE.md'],
    migrationHint: {
      sourceFileNames: ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md'],
      strategy: 'newest_wins',
    },
  },
];

const RUNTIME_MEMORY_PROFILE_TABLE = new Map<
  AgentRuntimeId,
  RuntimeMemoryProfilePlugin
>(
  RUNTIME_MEMORY_PROFILE_PLUGINS.map((plugin) => [plugin.runtime, plugin]),
);

export function getRuntimeMemoryProfilePlugin(
  runtime: AgentRuntimeId,
): RuntimeMemoryProfilePlugin {
  const plugin = RUNTIME_MEMORY_PROFILE_TABLE.get(runtime);
  if (!plugin) {
    throw new Error(`Missing runtime memory profile plugin: ${runtime}`);
  }
  return plugin;
}

export function getPrimaryMemoryFileName(
  runtime: AgentRuntimeId,
): RuntimeMemoryFileName {
  return getRuntimeMemoryProfilePlugin(runtime).primaryFileName;
}
