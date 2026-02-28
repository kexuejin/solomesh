import type { RegisteredGroup, UserRole } from './types.js';
import { parseImChannelFromJid } from './im-channel.js';

export interface MessageQueryGroup extends RegisteredGroup {
  jid: string;
}

interface ViewerRef {
  id: string;
  role: UserRole;
}

interface ResolveMergedMessageQueryJidsInput {
  target: MessageQueryGroup;
  viewer: ViewerRef;
  siblings: MessageQueryGroup[];
  canAccess: (group: MessageQueryGroup) => boolean;
}

/**
 * Resolve message query scope for one chat view.
 *
 * Rules:
 * - IM chats query only themselves.
 * - Home workspace keeps the existing owner-scoped sibling merge behavior.
 * - Non-home web workspace merges accessible IM siblings in the same folder.
 */
export function resolveMergedMessageQueryJids(
  input: ResolveMergedMessageQueryJidsInput,
): string[] {
  const { target, viewer, siblings, canAccess } = input;
  const result: string[] = [target.jid];

  if (!target.jid.startsWith('web:')) {
    return result;
  }

  for (const sibling of siblings) {
    if (sibling.jid === target.jid) continue;
    if (!canAccess(sibling)) continue;

    if (target.is_home) {
      const ownerMatch =
        !!target.created_by && sibling.created_by === target.created_by;
      const adminSelfMatch =
        viewer.role === 'admin' && sibling.created_by === viewer.id;
      if (!ownerMatch && !adminSelfMatch) continue;
      result.push(sibling.jid);
      continue;
    }

    if (!parseImChannelFromJid(sibling.jid)) continue;
    result.push(sibling.jid);
  }

  return result;
}
