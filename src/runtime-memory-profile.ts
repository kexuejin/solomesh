import type { AgentProvider } from './agent-providers.js';

export const KNOWN_RUNTIME_MEMORY_FILE_NAMES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
] as const;

export type RuntimeMemoryFileName =
  (typeof KNOWN_RUNTIME_MEMORY_FILE_NAMES)[number];

export interface RuntimeMemoryMigrationHint {
  sourceFileNames: RuntimeMemoryFileName[];
  strategy: 'newest_wins';
}

export interface RuntimeMemoryProfilePlugin {
  runtime: AgentProvider;
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
  AgentProvider,
  RuntimeMemoryProfilePlugin
>(
  RUNTIME_MEMORY_PROFILE_PLUGINS.map((plugin) => [plugin.runtime, plugin]),
);

const KNOWN_RUNTIME_MEMORY_FILE_NAME_SET = new Set<string>(
  KNOWN_RUNTIME_MEMORY_FILE_NAMES,
);

export function getRuntimeMemoryProfilePlugin(
  runtime: AgentProvider,
): RuntimeMemoryProfilePlugin {
  const plugin = RUNTIME_MEMORY_PROFILE_TABLE.get(runtime);
  if (!plugin) {
    throw new Error(`Missing runtime memory profile plugin: ${runtime}`);
  }
  return plugin;
}

export function listRuntimeMemoryProfilePlugins(): RuntimeMemoryProfilePlugin[] {
  return [...RUNTIME_MEMORY_PROFILE_PLUGINS];
}

export function getPrimaryMemoryFileName(
  provider: AgentProvider,
): RuntimeMemoryFileName {
  return getRuntimeMemoryProfilePlugin(provider).primaryFileName;
}

export function listRuntimeMemoryFileNames(
  provider?: AgentProvider,
): RuntimeMemoryFileName[] {
  if (!provider) return [...KNOWN_RUNTIME_MEMORY_FILE_NAMES];
  const plugin = getRuntimeMemoryProfilePlugin(provider);
  return [plugin.primaryFileName, ...plugin.compatibleFileNames];
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
