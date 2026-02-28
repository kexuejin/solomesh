import path from 'path';
import os from 'os';
import type { AgentProvider } from './agent-providers.js';
import { getProviderRuntime } from './provider-runtime.js';

export function getGlobalSkillsDirForProvider(provider: AgentProvider): string {
  const runtime = getProviderRuntime(provider);
  return path.join(os.homedir(), runtime.globalSkillsDirName);
}

export function buildSkillsInstallArgs(pkg: string, provider: AgentProvider): string[] {
  const runtime = getProviderRuntime(provider);
  return ['-y', 'skills', 'add', pkg, '--global', '--yes', '-a', runtime.skillInstallAgent];
}
