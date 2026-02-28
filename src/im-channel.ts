import type { ImChannel } from './types.js';

export interface ImChannelDefinition {
  id: ImChannel;
  prefix: string;
  displayName: string;
  supportsTyping: boolean;
}

const CHANNEL_DEFINITIONS: ImChannelDefinition[] = [
  {
    id: 'feishu',
    prefix: 'feishu:',
    displayName: 'Feishu',
    supportsTyping: true,
  },
  {
    id: 'telegram',
    prefix: 'telegram:',
    displayName: 'Telegram',
    supportsTyping: false,
  },
];

export function listImChannelDefinitions(): ImChannelDefinition[] {
  return CHANNEL_DEFINITIONS.slice();
}

export function parseImChannelFromJid(chatJid: string): ImChannel | null {
  const normalized = chatJid.trim();
  for (const def of CHANNEL_DEFINITIONS) {
    if (normalized.startsWith(def.prefix)) return def.id;
  }
  return null;
}

export function stripImChannelPrefix(chatJid: string): { channel: ImChannel; chatId: string } | null {
  const normalized = chatJid.trim();
  for (const def of CHANNEL_DEFINITIONS) {
    if (!normalized.startsWith(def.prefix)) continue;
    return {
      channel: def.id,
      chatId: normalized.slice(def.prefix.length),
    };
  }
  return null;
}

