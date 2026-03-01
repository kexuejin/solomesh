import type { AgentRuntimeId } from '../../runtime-definitions';

interface ResolveRuntimeTabAfterConfigLoadInput {
  availableRuntimeIds: AgentRuntimeId[];
  savedRuntime: AgentRuntimeId;
  currentTab: AgentRuntimeId;
  preserveCurrentTab: boolean;
}

export function resolveRuntimeTabAfterConfigLoad(
  input: ResolveRuntimeTabAfterConfigLoadInput,
): AgentRuntimeId {
  const { availableRuntimeIds, savedRuntime, currentTab, preserveCurrentTab } = input;
  const available = new Set(availableRuntimeIds);

  if (preserveCurrentTab && available.has(currentTab)) {
    return currentTab;
  }
  if (available.has(savedRuntime)) {
    return savedRuntime;
  }
  return availableRuntimeIds[0] ?? 'claude';
}
