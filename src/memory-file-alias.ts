import type { AgentProvider } from './agent-providers.js';
import {
  KNOWN_RUNTIME_MEMORY_FILE_NAMES,
  getPrimaryMemoryFileName as getPrimaryMemoryFileNameFromProfile,
  isRuntimeMemoryFileName,
  listCompanionRuntimeMemoryFileNames,
  listRuntimeMemoryFileNames,
  type RuntimeMemoryFileName,
} from './runtime-memory-profile.js';

export const RUNTIME_PRIMARY_MEMORY_FILE_NAMES = KNOWN_RUNTIME_MEMORY_FILE_NAMES;

export type RuntimePrimaryMemoryFileName = RuntimeMemoryFileName;

export function getPrimaryMemoryFileName(provider: AgentProvider): string {
  return getPrimaryMemoryFileNameFromProfile(provider);
}

export function listRuntimePrimaryMemoryFileNames(
  preferredProvider?: AgentProvider,
): RuntimePrimaryMemoryFileName[] {
  return listRuntimeMemoryFileNames(preferredProvider);
}

export function isRuntimePrimaryMemoryFileName(
  fileName: string,
): fileName is RuntimePrimaryMemoryFileName {
  return isRuntimeMemoryFileName(fileName);
}

export function listCompanionPrimaryMemoryFileNames(
  fileName: RuntimePrimaryMemoryFileName,
): RuntimePrimaryMemoryFileName[] {
  return listCompanionRuntimeMemoryFileNames(fileName);
}
