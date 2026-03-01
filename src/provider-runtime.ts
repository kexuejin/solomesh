import type { AgentProvider } from './agent-providers.js';
import { getPrimaryMemoryFileName } from './runtime-memory-profile.js';

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
    primaryMemoryFileName: getPrimaryMemoryFileName('claude'),
  },
  codex: {
    id: 'codex',
    skillInstallAgent: 'codex',
    globalSkillsDirName: '.agents/skills',
    supportsSkillsInstall: true,
    primaryMemoryFileName: getPrimaryMemoryFileName('codex'),
  },
  gemini: {
    id: 'gemini',
    skillInstallAgent: 'gemini-cli',
    globalSkillsDirName: '.gemini/skills',
    supportsSkillsInstall: false,
    primaryMemoryFileName: getPrimaryMemoryFileName('gemini'),
  },
};

export function getProviderRuntime(provider: AgentProvider): ProviderRuntime {
  return PROVIDER_RUNTIME_TABLE[provider];
}
