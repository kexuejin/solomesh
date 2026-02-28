import type { ExecutionMode, RegisteredGroup } from './types.js';

export type GroupWithJid = RegisteredGroup & { jid: string };

function pickExecutionSource(
  target: GroupWithJid,
  candidates: GroupWithJid[],
): GroupWithJid {
  const sameFolder = candidates.filter((item) => item.folder === target.folder);
  if (sameFolder.length === 0) return target;

  const homeSibling = sameFolder.find((item) => !!item.is_home);
  if (homeSibling) return homeSibling;

  const webSibling = sameFolder.find((item) => item.jid.startsWith('web:'));
  if (webSibling) return webSibling;

  return target;
}

export function resolveExecutionModeForGroup(
  target: GroupWithJid,
  candidates: GroupWithJid[],
): ExecutionMode {
  const source = pickExecutionSource(target, candidates);
  return source.executionMode || target.executionMode || 'container';
}

export function resolveEffectiveGroupForExecution(
  target: GroupWithJid,
  candidates: GroupWithJid[],
): RegisteredGroup {
  const source = pickExecutionSource(target, candidates);
  if (source.jid === target.jid) return target;
  return {
    ...target,
    executionMode: source.executionMode || target.executionMode,
    customCwd: source.customCwd || target.customCwd,
    // Keep explicit IM owner first; fallback to workspace owner.
    created_by: target.created_by || source.created_by,
    // Only home sibling should elevate to home semantics.
    is_home: source.is_home ? true : target.is_home,
  };
}
