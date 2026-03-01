import type { AgentProvider } from './agent-providers.js';

export interface ProviderRuntime {
  id: AgentProvider;
  skillInstallAgent: string;
  globalSkillsDirName: string;
  supportsSkillsInstall: boolean;
  primaryMemoryFileName: string;
}

const PROVIDER_RUNTIME_TABLE: Record<AgentProvider, ProviderRuntime> = {
  claude: {
    id: 'claude',
    skillInstallAgent: 'claude-code',
    globalSkillsDirName: '.claude/skills',
    supportsSkillsInstall: true,
    primaryMemoryFileName: 'CLAUDE.md',
  },
  codex: {
    id: 'codex',
    skillInstallAgent: 'codex',
    globalSkillsDirName: '.agents/skills',
    supportsSkillsInstall: true,
    primaryMemoryFileName: 'AGENTS.md',
  },
  gemini: {
    id: 'gemini',
    skillInstallAgent: 'gemini-cli',
    globalSkillsDirName: '.gemini/skills',
    supportsSkillsInstall: false,
    primaryMemoryFileName: 'AGENTS.md',
  },
};

export function getProviderRuntime(provider: AgentProvider): ProviderRuntime {
  return PROVIDER_RUNTIME_TABLE[provider];
}
