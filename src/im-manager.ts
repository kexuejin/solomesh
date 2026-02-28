/**
 * IM Connection Pool Manager
 *
 * Manages per-user IM connections.
 * Each user can have independent IM connections that route messages
 * to their home container.
 */
import { createFeishuConnection, FeishuConnection } from './feishu.js';
import { createTelegramConnection, TelegramConnection } from './telegram.js';
import {
  getEnabledChannelSessionBinding,
  getRegisteredGroup,
  getJidsByFolder,
} from './db.js';
import { logger } from './logger.js';
import {
  listImChannelDefinitions,
  parseImChannelFromJid,
  stripImChannelPrefix,
} from './im-channel.js';
import {
  isImChannelSendAllowed,
  type ImChannelSendOptions,
} from './im-channel-send-policy.js';
import type { ImChannel } from './types.js';

export interface FeishuConnectConfig {
  appId: string;
  appSecret: string;
  enabled?: boolean;
}

export interface TelegramConnectConfig {
  botToken: string;
  enabled?: boolean;
}

export type ImChannelConnectConfigMap = {
  feishu: FeishuConnectConfig;
  telegram: TelegramConnectConfig;
};

type ChannelConnectionMap = {
  feishu: FeishuConnection;
  telegram: TelegramConnection;
};

type ImChannelConfig<C extends ImChannel> = ImChannelConnectConfigMap[C];
type ImChannelConnection<C extends ImChannel> = ChannelConnectionMap[C];

export interface UserIMConnection {
  userId: string;
  channels: Partial<ChannelConnectionMap>;
}

export type ImChannelStatusMap = Record<ImChannel, boolean>;

interface ChannelConnectContext {
  userId: string;
  onNewChat: (chatJid: string, chatName: string) => void;
  ignoreMessagesBefore?: number;
}

interface ChannelConnectionAdapter<C extends ImChannel> {
  channel: C;
  supportsTyping: boolean;
  canConnect: (config: ImChannelConfig<C> | null | undefined) => boolean;
  connect: (
    config: ImChannelConfig<C>,
    context: ChannelConnectContext,
  ) => Promise<ImChannelConnection<C> | null>;
  disconnect: (conn: ImChannelConnection<C>) => Promise<void>;
  isConnected: (conn: ImChannelConnection<C>) => boolean;
  send: (
    conn: ImChannelConnection<C>,
    chatId: string,
    text: string,
  ) => Promise<void>;
  setTyping?: (
    conn: ImChannelConnection<C>,
    chatId: string,
    isTyping: boolean,
  ) => Promise<void>;
  syncGroups?: (conn: ImChannelConnection<C>) => Promise<void>;
}

const FEISHU_CHANNEL_ADAPTER: ChannelConnectionAdapter<'feishu'> = {
  channel: 'feishu',
  supportsTyping: true,
  canConnect: (config) =>
    !!config && config.enabled !== false && !!config.appId && !!config.appSecret,
  connect: async (config, context) => {
    const feishu = createFeishuConnection({
      appId: config.appId,
      appSecret: config.appSecret,
    });
    const connected = await feishu.connect({
      onReady: () => {
        logger.info(
          { userId: context.userId },
          'User Feishu WebSocket connected',
        );
      },
      onNewChat: context.onNewChat,
      ignoreMessagesBefore: context.ignoreMessagesBefore,
    });
    return connected ? feishu : null;
  },
  disconnect: async (conn) => {
    await conn.stop();
  },
  isConnected: (conn) => conn.isConnected(),
  send: async (conn, chatId, text) => {
    await conn.sendMessage(chatId, text);
  },
  setTyping: async (conn, chatId, isTyping) => {
    await conn.sendReaction(chatId, isTyping);
  },
  syncGroups: async (conn) => {
    await conn.syncGroups();
  },
};

const TELEGRAM_CHANNEL_ADAPTER: ChannelConnectionAdapter<'telegram'> = {
  channel: 'telegram',
  supportsTyping: false,
  canConnect: (config) =>
    !!config && config.enabled !== false && !!config.botToken,
  connect: async (config, context) => {
    const telegram = createTelegramConnection({
      botToken: config.botToken,
    });
    await telegram.connect({
      onReady: () => {
        logger.info({ userId: context.userId }, 'User Telegram bot connected');
      },
      onNewChat: context.onNewChat,
      isChatAuthorized: (jid) => {
        const binding = getEnabledChannelSessionBinding(jid);
        return !!binding && binding.owner_user_id === context.userId;
      },
    });
    return telegram.isConnected() ? telegram : null;
  },
  disconnect: async (conn) => {
    await conn.disconnect();
  },
  isConnected: (conn) => conn.isConnected(),
  send: async (conn, chatId, text) => {
    await conn.sendMessage(chatId, text);
  },
};

function createEmptyChannelStatusMap(): ImChannelStatusMap {
  const status = {} as ImChannelStatusMap;
  for (const def of listImChannelDefinitions()) {
    status[def.id] = false;
  }
  return status;
}

class IMConnectionManager {
  private connections = new Map<string, UserIMConnection>();
  private adminUserIds = new Set<string>();
  private channelAdapters = new Map<ImChannel, ChannelConnectionAdapter<ImChannel>>();

  constructor() {
    this.registerChannelAdapter(FEISHU_CHANNEL_ADAPTER);
    this.registerChannelAdapter(TELEGRAM_CHANNEL_ADAPTER);
  }

  registerChannelAdapter<C extends ImChannel>(
    adapter: ChannelConnectionAdapter<C>,
  ): void {
    this.channelAdapters.set(
      adapter.channel,
      adapter as unknown as ChannelConnectionAdapter<ImChannel>,
    );
  }

  private getChannelAdapter<C extends ImChannel>(
    channel: C,
  ): ChannelConnectionAdapter<C> | null {
    const adapter = this.channelAdapters.get(channel);
    return (adapter as ChannelConnectionAdapter<C> | undefined) || null;
  }

  private getChannelConnection<C extends ImChannel>(
    conn: UserIMConnection,
    channel: C,
  ): ImChannelConnection<C> | null {
    const raw = conn.channels[channel];
    if (!raw) return null;
    return raw as ImChannelConnection<C>;
  }

  private isChannelConnected(conn: UserIMConnection, channel: ImChannel): boolean {
    const adapter = this.getChannelAdapter(channel);
    if (!adapter) return false;
    const channelConn = this.getChannelConnection(conn, channel);
    if (!channelConn) return false;
    return adapter.isConnected(channelConn);
  }

  private hasAnyConnectedChannel(conn: UserIMConnection): boolean {
    for (const channel of this.channelAdapters.keys()) {
      if (this.isChannelConnected(conn, channel)) return true;
    }
    return false;
  }

  private resolveChannelConnection<C extends ImChannel>(
    chatJid: string,
    channel: C,
  ): {
    userId: string;
    conn: UserIMConnection;
    channelConn: ImChannelConnection<C>;
    viaSibling: boolean;
    folder: string | null;
  } | null {
    const group = getRegisteredGroup(chatJid);

    // First try direct owner of this chat group
    if (group?.created_by) {
      const conn = this.connections.get(group.created_by);
      if (conn && this.isChannelConnected(conn, channel)) {
        const channelConn = this.getChannelConnection(conn, channel);
        if (!channelConn) return null;
        return {
          userId: group.created_by,
          conn,
          channelConn,
          viaSibling: false,
          folder: group.folder,
        };
      }
    }

    // Fallback: owner from sibling groups in the same folder
    if (group) {
      const siblingJids = getJidsByFolder(group.folder);
      for (const sibJid of siblingJids) {
        if (sibJid === chatJid) continue;
        const sibling = getRegisteredGroup(sibJid);
        if (!sibling?.created_by) continue;
        const conn = this.connections.get(sibling.created_by);
        if (!conn || !this.isChannelConnected(conn, channel)) continue;
        const channelConn = this.getChannelConnection(conn, channel);
        if (!channelConn) continue;
        return {
          userId: sibling.created_by,
          conn,
          channelConn,
          viaSibling: true,
          folder: group.folder,
        };
      }
    }

    return null;
  }

  /** Register a user ID as admin (for fallback routing) */
  registerAdminUser(userId: string): void {
    this.adminUserIds.add(userId);
  }

  private getOrCreate(userId: string): UserIMConnection {
    let conn = this.connections.get(userId);
    if (!conn) {
      conn = {
        userId,
        channels: {},
      };
      this.connections.set(userId, conn);
    }
    return conn;
  }

  /**
   * Connect one IM channel for a specific user.
   */
  async connectUserChannel<C extends ImChannel>(
    userId: string,
    channel: C,
    config: ImChannelConfig<C>,
    onNewChat: (chatJid: string, chatName: string) => void,
    options: { ignoreMessagesBefore?: number } = {},
  ): Promise<boolean> {
    const adapter = this.getChannelAdapter(channel);
    if (!adapter) {
      logger.warn({ userId, channel }, 'No channel adapter registered');
      return false;
    }
    if (!adapter.canConnect(config)) {
      logger.info({ userId, channel }, 'IM config empty or disabled, skipping connection');
      return false;
    }

    // Stop existing connection if any
    await this.disconnectUserChannel(userId, channel);

    const conn = this.getOrCreate(userId);
    try {
      const channelConn = await adapter.connect(config, {
        userId,
        onNewChat,
        ignoreMessagesBefore: options.ignoreMessagesBefore,
      });
      if (!channelConn || !adapter.isConnected(channelConn)) {
        return false;
      }
      conn.channels[channel] = channelConn as ChannelConnectionMap[C];
      logger.info({ userId, channel }, 'User IM channel connection established');
      return true;
    } catch (err) {
      logger.error({ userId, channel, err }, 'Failed to connect user IM channel');
      return false;
    }
  }

  /**
   * Disconnect one IM channel for a specific user.
   */
  async disconnectUserChannel<C extends ImChannel>(
    userId: string,
    channel: C,
  ): Promise<void> {
    const adapter = this.getChannelAdapter(channel);
    if (!adapter) return;
    const conn = this.connections.get(userId);
    if (!conn) return;
    const channelConn = this.getChannelConnection(conn, channel);
    if (!channelConn) return;
    await adapter.disconnect(channelConn);
    delete conn.channels[channel];
    logger.info({ userId, channel }, 'User IM channel disconnected');
  }

  isUserChannelConnected(userId: string, channel: ImChannel): boolean {
    const conn = this.connections.get(userId);
    if (!conn) return false;
    return this.isChannelConnected(conn, channel);
  }

  getUserChannelStatuses(userId: string): ImChannelStatusMap {
    const statuses = createEmptyChannelStatusMap();
    for (const channel of this.channelAdapters.keys()) {
      statuses[channel] = this.isUserChannelConnected(userId, channel);
    }
    return statuses;
  }

  getAnyChannelStatuses(): ImChannelStatusMap {
    const statuses = createEmptyChannelStatusMap();
    for (const channel of this.channelAdapters.keys()) {
      statuses[channel] = this.isAnyChannelConnected(channel);
    }
    return statuses;
  }

  private async sendChannelMessage(
    chatJid: string,
    expectedChannel: ImChannel,
    text: string,
  ): Promise<void> {
    const parsed = stripImChannelPrefix(chatJid);
    if (!parsed || parsed.channel !== expectedChannel) {
      logger.warn({ chatJid, expectedChannel }, 'Invalid IM chat_jid for channel');
      return;
    }

    const adapter = this.getChannelAdapter(expectedChannel);
    if (!adapter) {
      logger.warn({ chatJid, channel: expectedChannel }, 'No outbound adapter registered for channel');
      return;
    }

    const resolved = this.resolveChannelConnection(chatJid, expectedChannel);
    if (!resolved) {
      logger.warn({ chatJid, channel: expectedChannel }, 'No IM connection available to send message');
      return;
    }

    if (resolved.viaSibling) {
      logger.warn(
        {
          chatJid,
          channel: expectedChannel,
          fallbackUserId: resolved.userId,
          folder: resolved.folder,
        },
        'IM message routed via sibling group owner connection',
      );
    }

    await adapter.send(resolved.channelConn, parsed.chatId, text);
  }

  private async setChannelTyping(
    chatJid: string,
    expectedChannel: ImChannel,
    isTyping: boolean,
  ): Promise<void> {
    const parsed = stripImChannelPrefix(chatJid);
    if (!parsed || parsed.channel !== expectedChannel) return;

    const adapter = this.getChannelAdapter(expectedChannel);
    if (!adapter || !adapter.supportsTyping || !adapter.setTyping) return;

    const resolved = this.resolveChannelConnection(chatJid, expectedChannel);
    if (!resolved) return;
    await adapter.setTyping(resolved.channelConn, parsed.chatId, isTyping);
  }

  async sendImMessage(
    chatJid: string,
    text: string,
    options: ImChannelSendOptions = {},
  ): Promise<void> {
    const channel = parseImChannelFromJid(chatJid);
    if (!channel) return;
    if (!isImChannelSendAllowed(channel, options)) return;
    await this.sendChannelMessage(chatJid, channel, text);
  }

  async setTyping(chatJid: string, isTyping: boolean): Promise<void> {
    const channel = parseImChannelFromJid(chatJid);
    if (!channel) return;
    await this.setChannelTyping(chatJid, channel, isTyping);
  }

  /**
   * Sync Feishu groups via a specific user's connection.
   */
  async syncUserChannelGroups(userId: string, channel: ImChannel): Promise<void> {
    const adapter = this.getChannelAdapter(channel);
    if (!adapter?.syncGroups) return;
    const conn = this.connections.get(userId);
    if (!conn) return;
    const channelConn = this.getChannelConnection(conn, channel);
    if (!channelConn || !adapter.isConnected(channelConn)) return;
    await adapter.syncGroups(channelConn);
  }

  /**
   * Sync one IM channel's group metadata via any connected user.
   * Returns true when a sync action is actually executed.
   */
  async syncChannelGroupsByAnyConnectedUser(channel: ImChannel): Promise<boolean> {
    for (const userId of this.getConnectedUserIds()) {
      if (!this.isUserChannelConnected(userId, channel)) continue;
      await this.syncUserChannelGroups(userId, channel);
      return true;
    }
    return false;
  }

  getConnectedChannels(userId: string): ImChannel[] {
    const conn = this.connections.get(userId);
    if (!conn) return [];
    const channels: ImChannel[] = [];
    for (const channel of this.channelAdapters.keys()) {
      if (this.isChannelConnected(conn, channel)) {
        channels.push(channel);
      }
    }
    return channels;
  }

  private isAnyChannelConnected(channel: ImChannel): boolean {
    for (const conn of this.connections.values()) {
      if (this.isChannelConnected(conn, channel)) return true;
    }
    return false;
  }

  /** Get all user IDs with active connections */
  getConnectedUserIds(): string[] {
    const ids: string[] = [];
    for (const [userId, conn] of this.connections.entries()) {
      if (this.hasAnyConnectedChannel(conn)) {
        ids.push(userId);
      }
    }
    return ids;
  }

  /**
   * Disconnect all IM connections for all users.
   * Called during graceful shutdown.
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [userId, conn] of this.connections.entries()) {
      for (const [channel, adapter] of this.channelAdapters.entries()) {
        const channelConn = this.getChannelConnection(conn, channel);
        if (!channelConn) continue;
        promises.push(
          adapter.disconnect(channelConn).catch((err) => {
            logger.warn(
              { userId, channel, err },
              'Error disconnecting IM channel',
            );
          }),
        );
      }
    }

    await Promise.allSettled(promises);
    this.connections.clear();
    logger.info('All IM connections disconnected');
  }
}

export const imManager = new IMConnectionManager();
