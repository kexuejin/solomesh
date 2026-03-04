import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR, GROUPS_DIR } from './config.js';
import {
  AgentKind,
  AgentStatus,
  AuthAuditLog,
  AuthEventType,
  ExecutionMode,
  GroupMember,
  InviteCode,
  InviteCodeWithCreator,
  ImChannel,
  NewMessage,
  MessageCursor,
  RegisteredGroup,
  ChannelSessionBinding,
  ScheduledTask,
  SubAgent,
  TaskConfig,
  TaskState,
  TaskRunLog,
  DecisionItem,
  DecisionItemStatus,
  DecisionItemScopeLevel,
  RadarCadence,
  RadarSourceTemplate,
  RadarSourceType,
  RadarUserCustomFeed,
  RadarUserSourceOverride,
  Todo,
  TodoPriority,
  TodoSourceEvent,
  TodoSourceType,
  TodoStatus,
  TodoTriggerMode,
  User,
  UserPublic,
  UserStatus,
  UserRole,
  UserSession,
  UserSessionWithUser,
  Permission,
  PermissionTemplateKey,
} from './types.js';
import { AGENT_PROVIDER_IDS, type AgentProvider } from './agent-providers.js';
import { getDefaultPermissions, normalizePermissions } from './permissions.js';
import { listRuntimePrimaryMemoryFileNames } from './memory-file-alias.js';
import { parseMessageProvider } from './message-provider.js';
import { getRuntimeProviderConfig } from './runtime-config.js';
import {
  listImChannelDefinitions,
  parseImChannelFromJid as parseImChannelFromJidInternal,
} from './im-channel.js';

let db: Database.Database;

function hasColumn(tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(
  tableName: string,
  columnName: string,
  sqlTypeWithDefault: string,
): void {
  if (hasColumn(tableName, columnName)) return;
  db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeWithDefault}`,
  );
}

function assertSchema(
  tableName: string,
  requiredColumns: string[],
  forbiddenColumns: string[] = [],
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((c) => c.name));

  const missing = requiredColumns.filter((c) => !names.has(c));
  const forbidden = forbiddenColumns.filter((c) => names.has(c));

  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(
      `Incompatible DB schema in table "${tableName}". Missing: [${missing.join(', ')}], forbidden: [${forbidden.join(', ')}]. ` +
        'Please remove data/db/messages.db (or legacy store/messages.db) and restart.',
    );
  }
}

/** Internal helper — reads router_state before initDatabase exports are available. */
function getRouterStateInternal(key: string): string | undefined {
  try {
    const row = db
      .prepare('SELECT value FROM router_state WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined; // Table may not exist yet on first run
  }
}

const DEFAULT_RADAR_SOURCE_TEMPLATES: Array<{
  id: string;
  name: string;
  type: RadarSourceType;
  url: string;
  default_enabled: boolean;
  default_cadence: RadarCadence;
  tags: string[];
}> = [
  {
    id: 'default-github-trending',
    name: 'GitHub Trending',
    type: 'github_trending',
    url: 'https://github.com/trending?since=daily',
    default_enabled: true,
    default_cadence: 'both',
    tags: ['agent', 'coding', 'tools'],
  },
  {
    id: 'default-producthunt-ai',
    name: 'Product Hunt AI',
    type: 'producthunt',
    url: 'https://www.producthunt.com/topics/artificial-intelligence',
    default_enabled: true,
    default_cadence: 'both',
    tags: ['launch', 'tools'],
  },
  {
    id: 'default-hn-show',
    name: 'Hacker News Show',
    type: 'hn',
    url: 'https://news.ycombinator.com/show',
    default_enabled: true,
    default_cadence: 'daily',
    tags: ['launch', 'discussion'],
  },
  {
    id: 'default-hf-papers',
    name: 'Hugging Face Papers',
    type: 'hf_papers',
    url: 'https://huggingface.co/papers',
    default_enabled: true,
    default_cadence: 'both',
    tags: ['research', 'models'],
  },
  {
    id: 'default-reddit-localllama',
    name: 'Reddit /r/LocalLLaMA',
    type: 'reddit',
    url: 'https://www.reddit.com/r/LocalLLaMA/new/.rss',
    default_enabled: true,
    default_cadence: 'daily',
    tags: ['community', 'oss'],
  },
  {
    id: 'default-reddit-chatgpt',
    name: 'Reddit /r/ChatGPT',
    type: 'reddit',
    url: 'https://www.reddit.com/r/ChatGPT/new/.rss',
    default_enabled: true,
    default_cadence: 'weekly',
    tags: ['community', 'apps'],
  },
];

function seedRadarSourceTemplates(): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `
    INSERT OR IGNORE INTO radar_source_templates (
      id, name, type, url, default_enabled, default_cadence, tags, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `,
  );

  for (const template of DEFAULT_RADAR_SOURCE_TEMPLATES) {
    stmt.run(
      template.id,
      template.name,
      template.type,
      template.url,
      template.default_enabled ? 1 : 0,
      template.default_cadence,
      JSON.stringify(template.tags),
      now,
      now,
    );
  }
}

export function buildImJidSqlPredicate(
  columnName = 'jid',
): { sql: string; params: string[] } {
  const normalizedColumn = columnName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedColumn)) {
    throw new Error(`Invalid SQL column name: ${columnName}`);
  }

  const patterns = listImChannelDefinitions().map((def) => `${def.prefix}%`);
  if (patterns.length === 0) {
    return { sql: '1=0', params: [] };
  }

  const clauses = patterns.map(() => `${normalizedColumn} LIKE ?`).join(' OR ');
  return {
    sql: `(${clauses})`,
    params: patterns,
  };
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency and performance
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      attachments TEXT,
      provider TEXT,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(chat_jid, timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      context_mode TEXT DEFAULT 'isolated',
      operation_permission_mode TEXT DEFAULT 'default',
      agent_runtime_override TEXT,
      execution_environment TEXT DEFAULT 'local',
      execution_type TEXT DEFAULT 'agent',
      script_command TEXT,
      task_config TEXT,
      task_state TEXT,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT,
      dedupe_key TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_todos_status_priority_last_seen
      ON todos(status, priority, last_seen_at);

    CREATE TABLE IF NOT EXISTS todo_source_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_run_id TEXT,
      trigger_mode TEXT,
      action TEXT NOT NULL,
      evidence TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (todo_id) REFERENCES todos(id)
    );
    CREATE INDEX IF NOT EXISTS idx_todo_source_events_todo_created_at
      ON todo_source_events(todo_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_todo_source_events_source_lookup
      ON todo_source_events(source_type, source_id, created_at);

    CREATE TABLE IF NOT EXISTS decision_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      scope_level TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      priority TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_run_id TEXT,
      evidence TEXT,
      suggested_todo_title TEXT,
      suggested_todo_description TEXT,
      suggested_todo_priority TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      accepted_todo_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decision_items_status_created_at
      ON decision_items(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_decision_items_source
      ON decision_items(source_type, source_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_decision_items_scope
      ON decision_items(scope_level, scope_id, created_at);

    CREATE TABLE IF NOT EXISTS radar_source_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      default_enabled INTEGER NOT NULL DEFAULT 1,
      default_cadence TEXT NOT NULL DEFAULT 'both',
      tags TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_radar_source_templates_active
      ON radar_source_templates(active);

    CREATE TABLE IF NOT EXISTS radar_user_source_overrides (
      user_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      enabled_override INTEGER,
      cadence_override TEXT,
      include_keywords TEXT NOT NULL DEFAULT '[]',
      exclude_keywords TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, template_id)
    );
    CREATE INDEX IF NOT EXISTS idx_radar_overrides_user
      ON radar_user_source_overrides(user_id);

    CREATE TABLE IF NOT EXISTS radar_user_custom_feeds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rss_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cadence TEXT NOT NULL DEFAULT 'both',
      tags TEXT NOT NULL DEFAULT '[]',
      include_keywords TEXT NOT NULL DEFAULT '[]',
      exclude_keywords TEXT NOT NULL DEFAULT '[]',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT,
      last_error_at TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_radar_custom_feeds_user
      ON radar_user_custom_feeds(user_id);
  `);

  // State tables (replacing JSON files)
  db.exec(`
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (group_folder, agent_id)
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      created_by TEXT,
      is_home INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS channel_session_bindings (
      chat_jid TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      target_folder TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_session_bindings_owner
      ON channel_session_bindings(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_channel_session_bindings_target
      ON channel_session_bindings(target_folder);
  `);

  // Auth tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      permissions TEXT NOT NULL DEFAULT '[]',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      disable_reason TEXT,
      notes TEXT,
      avatar_emoji TEXT,
      avatar_color TEXT,
      ai_name TEXT,
      ai_avatar_emoji TEXT,
      ai_avatar_color TEXT,
      ai_avatar_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      permission_template TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      username TEXT NOT NULL,
      actor_username TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_status_role ON users(status, role);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    CREATE INDEX IF NOT EXISTS idx_invites_created_at ON invite_codes(created_at);
  `);

  // Group members table for shared workspaces
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_folder TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      added_at TEXT NOT NULL,
      added_by TEXT,
      PRIMARY KEY (group_folder, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
  `);

  // Sub-agents table for multi-agent parallel execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_by TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      result_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agents_group ON agents(group_folder);
    CREATE INDEX IF NOT EXISTS idx_agents_jid ON agents(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  `);

  // Lightweight migrations for existing DBs
  ensureColumn('users', 'permissions', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'disable_reason', 'TEXT');
  ensureColumn('users', 'notes', 'TEXT');
  ensureColumn('users', 'deleted_at', 'TEXT');
  ensureColumn('invite_codes', 'permission_template', 'TEXT');
  ensureColumn('invite_codes', 'permissions', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('users', 'avatar_emoji', 'TEXT');
  ensureColumn('users', 'avatar_color', 'TEXT');
  ensureColumn('registered_groups', 'execution_mode', "TEXT DEFAULT 'container'");
  ensureColumn('registered_groups', 'custom_cwd', 'TEXT');
  ensureColumn('registered_groups', 'init_source_path', 'TEXT');
  ensureColumn('registered_groups', 'init_git_url', 'TEXT');
  ensureColumn('messages', 'attachments', 'TEXT');
  ensureColumn('registered_groups', 'created_by', 'TEXT');
  ensureColumn('registered_groups', 'is_home', 'INTEGER DEFAULT 0');
  ensureColumn('messages', 'provider', 'TEXT');
  ensureColumn('users', 'ai_name', 'TEXT');
  ensureColumn('users', 'ai_avatar_emoji', 'TEXT');
  ensureColumn('users', 'ai_avatar_color', 'TEXT');
  ensureColumn('users', 'ai_avatar_url', 'TEXT');
  ensureColumn('scheduled_tasks', 'created_by', 'TEXT');
  ensureColumn('scheduled_tasks', 'execution_type', "TEXT DEFAULT 'agent'");
  ensureColumn('scheduled_tasks', 'script_command', 'TEXT');
  ensureColumn('scheduled_tasks', 'operation_permission_mode', "TEXT DEFAULT 'default'");
  ensureColumn('scheduled_tasks', 'agent_runtime_override', 'TEXT');
  ensureColumn('scheduled_tasks', 'execution_environment', "TEXT DEFAULT 'local'");
  ensureColumn('scheduled_tasks', 'task_config', 'TEXT');
  ensureColumn('scheduled_tasks', 'task_state', 'TEXT');
  ensureColumn('decision_items', 'scope_level', "TEXT NOT NULL DEFAULT 'global'");
  ensureColumn('decision_items', 'scope_id', 'TEXT');
  ensureColumn('registered_groups', 'selected_skills', 'TEXT');
  ensureColumn('sessions', 'agent_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('agents', 'kind', "TEXT NOT NULL DEFAULT 'task'");

  // Migration: remove UNIQUE constraint from registered_groups.folder
  // Multiple groups (web:main + feishu chats) share folder='main' by design.
  // The old UNIQUE constraint caused INSERT OR REPLACE to silently delete
  // the conflicting row, making web:main and feishu groups mutually exclusive.
  const hasUniqueFolder = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM sqlite_master
         WHERE type='index' AND tbl_name='registered_groups'
         AND name='sqlite_autoindex_registered_groups_2'`,
      )
      .get() as { cnt: number }
  ).cnt > 0;
  if (hasUniqueFolder) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE registered_groups_new (
          jid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folder TEXT NOT NULL,
          added_at TEXT NOT NULL,
          container_config TEXT,
          execution_mode TEXT DEFAULT 'container',
          custom_cwd TEXT,
          init_source_path TEXT,
          init_git_url TEXT,
          created_by TEXT,
          is_home INTEGER DEFAULT 0
        );
        INSERT INTO registered_groups_new SELECT jid, name, folder, added_at, container_config, execution_mode, custom_cwd, NULL, NULL, NULL, 0 FROM registered_groups;
        DROP TABLE registered_groups;
        ALTER TABLE registered_groups_new RENAME TO registered_groups;
      `);
    })();
  }

  assertSchema('messages', [
    'id',
    'chat_jid',
    'sender',
    'sender_name',
    'content',
    'timestamp',
    'is_from_me',
    'attachments',
    'provider',
  ]);
  assertSchema('scheduled_tasks', [
    'id',
    'group_folder',
    'chat_jid',
    'prompt',
    'schedule_type',
    'schedule_value',
    'context_mode',
    'operation_permission_mode',
    'agent_runtime_override',
    'execution_environment',
    'execution_type',
    'script_command',
    'task_config',
    'task_state',
    'next_run',
    'last_run',
    'last_result',
    'status',
    'created_at',
    'created_by',
  ]);
  assertSchema('todos', [
    'id',
    'title',
    'description',
    'status',
    'priority',
    'dedupe_key',
    'occurrence_count',
    'first_seen_at',
    'last_seen_at',
    'created_by',
    'created_at',
    'updated_at',
  ]);
  assertSchema('todo_source_events', [
    'id',
    'todo_id',
    'source_type',
    'source_id',
    'source_run_id',
    'trigger_mode',
    'action',
    'evidence',
    'created_at',
  ]);
  assertSchema('radar_source_templates', [
    'id',
    'name',
    'type',
    'url',
    'default_enabled',
    'default_cadence',
    'tags',
    'active',
    'created_at',
    'updated_at',
  ]);
  assertSchema('radar_user_source_overrides', [
    'user_id',
    'template_id',
    'enabled_override',
    'cadence_override',
    'include_keywords',
    'exclude_keywords',
    'updated_at',
  ]);
  assertSchema('radar_user_custom_feeds', [
    'id',
    'user_id',
    'name',
    'rss_url',
    'enabled',
    'cadence',
    'tags',
    'include_keywords',
    'exclude_keywords',
    'consecutive_failures',
    'last_success_at',
    'last_error_at',
    'last_error_message',
    'created_at',
    'updated_at',
  ]);
  assertSchema(
    'registered_groups',
    [
      'jid',
      'name',
      'folder',
      'added_at',
      'container_config',
      'execution_mode',
      'custom_cwd',
      'init_source_path',
      'init_git_url',
      'created_by',
      'is_home',
      'selected_skills',
    ],
    ['trigger_pattern', 'requires_trigger'],
  );
  assertSchema('channel_session_bindings', [
    'chat_jid',
    'channel',
    'target_folder',
    'owner_user_id',
    'enabled',
    'created_at',
    'updated_at',
    'created_by',
    'updated_by',
  ]);

  assertSchema('users', [
    'id',
    'username',
    'password_hash',
    'display_name',
    'role',
    'status',
    'permissions',
    'must_change_password',
    'disable_reason',
    'notes',
    'avatar_emoji',
    'avatar_color',
    'ai_name',
    'ai_avatar_emoji',
    'ai_avatar_color',
    'ai_avatar_url',
    'created_at',
    'updated_at',
    'last_login_at',
    'deleted_at',
  ]);
  assertSchema('user_sessions', [
    'id',
    'user_id',
    'ip_address',
    'user_agent',
    'created_at',
    'expires_at',
    'last_active_at',
  ]);
  assertSchema('invite_codes', [
    'code',
    'created_by',
    'role',
    'permission_template',
    'permissions',
    'max_uses',
    'used_count',
    'expires_at',
    'created_at',
  ]);
  assertSchema('auth_audit_log', [
    'id',
    'event_type',
    'username',
    'actor_username',
    'ip_address',
    'user_agent',
    'details',
    'created_at',
  ]);

  // Store schema version after all migrations complete
  // Migrate existing web groups: assign to first admin
  db.exec(`
    UPDATE registered_groups SET created_by = (
      SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1
    ) WHERE jid LIKE 'web:%' AND folder != 'main' AND created_by IS NULL
  `);

  // Backfill owner for legacy web:main if missing.
  db.exec(`
    UPDATE registered_groups SET created_by = (
      SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1
    ) WHERE jid = 'web:main' AND created_by IS NULL
  `);

  // Backfill created_by for IM channel groups by matching sibling groups in the same folder.
  // Only backfill when the folder has exactly one distinct owner; otherwise keep NULL
  // to avoid misrouting in ambiguous folders (e.g., shared admin main).
  const imJidPredicate = buildImJidSqlPredicate('jid');
  db.prepare(`
    UPDATE registered_groups
    SET created_by = (
      SELECT MIN(rg2.created_by)
      FROM registered_groups rg2
      WHERE rg2.folder = registered_groups.folder
        AND rg2.created_by IS NOT NULL
    )
    WHERE ${imJidPredicate.sql}
      AND created_by IS NULL
      AND (
        SELECT COUNT(DISTINCT rg3.created_by)
        FROM registered_groups rg3
        WHERE rg3.folder = registered_groups.folder
          AND rg3.created_by IS NOT NULL
      ) = 1
  `).run(...imJidPredicate.params);

  // v13 migration: mark existing web:main group as is_home=1
  db.exec(`
    UPDATE registered_groups SET is_home = 1
    WHERE jid = 'web:main' AND folder = 'main' AND is_home = 0
  `);

  // v15 migration: backfill group_members for existing web groups
  const currentVersion = getRouterStateInternal('schema_version');
  if (!currentVersion || parseInt(currentVersion, 10) < 15) {
    db.transaction(() => {
      // Backfill owner records for all web groups with created_by set
      const webGroups = db
        .prepare(
          "SELECT DISTINCT folder, created_by FROM registered_groups WHERE jid LIKE 'web:%' AND created_by IS NOT NULL",
        )
        .all() as Array<{ folder: string; created_by: string }>;
      for (const g of webGroups) {
        db.prepare(
          `INSERT OR IGNORE INTO group_members (group_folder, user_id, role, added_at, added_by)
           VALUES (?, ?, 'owner', ?, ?)`,
        ).run(g.folder, g.created_by, new Date().toISOString(), g.created_by);
      }
    })();
  }

  // v16→v17 migration: rebuild sessions table with composite primary key
  // Old PK was (group_folder), which cannot store multiple agent sessions per folder.
  // New PK is (group_folder, COALESCE(agent_id, '')) to support per-agent sessions.
  const curVer = getRouterStateInternal('schema_version');
  if (curVer && parseInt(curVer, 10) < 17) {
    db.transaction(() => {
      // Check if the old table has single-column PK by inspecting table_info
      const pkCols = (db.prepare("PRAGMA table_info('sessions')").all() as Array<{ name: string; pk: number }>)
        .filter(c => c.pk > 0);
      // Old schema: single PK column 'group_folder'. New schema: composite PK needs rebuild.
      if (pkCols.length === 1 && pkCols[0].name === 'group_folder') {
        db.exec(`
          CREATE TABLE sessions_new (
            group_folder TEXT NOT NULL,
            session_id TEXT NOT NULL,
            agent_id TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (group_folder, agent_id)
          );
          INSERT OR IGNORE INTO sessions_new (group_folder, session_id, agent_id)
            SELECT group_folder, session_id, COALESCE(agent_id, '') FROM sessions;
          DROP TABLE sessions;
          ALTER TABLE sessions_new RENAME TO sessions;
        `);
      }
    })();
  }

  seedRadarSourceTemplates();

  const SCHEMA_VERSION = '20';
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run('schema_version', SCHEMA_VERSION);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Ensure a chat row exists in the chats table (avoids FK violation on messages insert).
 */
export function ensureChatExists(chatJid: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`,
  ).run(chatJid, chatJid, new Date().toISOString());
}

/**
 * Store a message with full content (channel-agnostic).
 * Only call this for registered groups where message history is needed.
 */
export function storeMessageDirect(
  msgId: string,
  chatJid: string,
  sender: string,
  senderName: string,
  content: string,
  timestamp: string,
  isFromMe: boolean,
  attachments?: string,
  provider?: AgentProvider | null,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msgId,
    chatJid,
    sender,
    senderName,
    content,
    timestamp,
    isFromMe ? 1 : 0,
    attachments ?? null,
    provider ?? null,
  );
}

export function getNewMessages(
  jids: string[],
  cursor: MessageCursor,
): { messages: NewMessage[]; newCursor: MessageCursor } {
  if (jids.length === 0) return { messages: [], newCursor: cursor };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out assistant outputs.
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, attachments, provider
    FROM messages
    WHERE
      (timestamp > ? OR (timestamp = ? AND id > ?))
      AND chat_jid IN (${placeholders})
      AND is_from_me = 0
    ORDER BY timestamp ASC, id ASC
  `;

  const rows = (db
    .prepare(sql)
    .all(
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      ...jids,
    ) as Array<NewMessage & { provider?: unknown }>).map((row) => ({
      ...row,
      provider: parseMessageProvider(row.provider),
    }));
  const last = rows[rows.length - 1];
  return {
    messages: rows,
    newCursor: last
      ? { timestamp: last.timestamp, id: last.id }
      : cursor,
  };
}

export function getMessagesSince(
  chatJid: string,
  cursor: MessageCursor,
): NewMessage[] {
  // Filter out assistant outputs.
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, attachments, provider
    FROM messages
    WHERE
      chat_jid = ?
      AND (timestamp > ? OR (timestamp = ? AND id > ?))
      AND is_from_me = 0
    ORDER BY timestamp ASC, id ASC
  `;
  return db
    .prepare(sql)
    .all(chatJid, cursor.timestamp, cursor.timestamp, cursor.id)
    .map((row) => ({
      ...(row as NewMessage & { provider?: unknown }),
      provider: parseMessageProvider((row as { provider?: unknown }).provider),
    }));
}

function parseTaskJson(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function parseTaskOperationPermissionMode(raw: unknown): 'default' | 'bypass' {
  return raw === 'bypass' ? 'bypass' : 'default';
}

function parseTaskRuntimeOverride(raw: unknown): AgentProvider | null {
  if (typeof raw !== 'string') return null;
  return AGENT_PROVIDER_IDS.includes(raw as AgentProvider)
    ? (raw as AgentProvider)
    : null;
}

function parseTaskExecutionEnvironment(raw: unknown): 'local' | 'worktree' {
  return raw === 'worktree' ? 'worktree' : 'local';
}

function parseScheduledTaskRow(row: Record<string, unknown>): ScheduledTask {
  return {
    ...(row as unknown as ScheduledTask),
    operation_permission_mode: parseTaskOperationPermissionMode(
      row.operation_permission_mode,
    ),
    agent_runtime_override: parseTaskRuntimeOverride(row.agent_runtime_override),
    execution_environment: parseTaskExecutionEnvironment(row.execution_environment),
    task_config: parseTaskJson(row.task_config) as TaskConfig | null,
    task_state: parseTaskJson(row.task_state) as TaskState | null,
  };
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (
      id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
      context_mode, operation_permission_mode, agent_runtime_override, execution_environment,
      execution_type, script_command, task_config, task_state,
      next_run, status, created_at, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.operation_permission_mode === 'bypass' ? 'bypass' : 'default',
    task.agent_runtime_override ?? null,
    task.execution_environment === 'worktree' ? 'worktree' : 'local',
    task.execution_type || 'agent',
    task.script_command ?? null,
    task.task_config ? JSON.stringify(task.task_config) : null,
    task.task_state ? JSON.stringify(task.task_state) : null,
    task.next_run,
    task.status,
    task.created_at,
    task.created_by ?? null,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? parseScheduledTaskRow(row) : undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  const rows = db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as Record<string, unknown>[];
  return rows.map((row) => parseScheduledTaskRow(row));
}

export function getAllTasks(): ScheduledTask[] {
  const rows = db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((row) => parseScheduledTaskRow(row));
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'prompt'
      | 'schedule_type'
      | 'schedule_value'
      | 'context_mode'
      | 'operation_permission_mode'
      | 'agent_runtime_override'
      | 'execution_environment'
      | 'execution_type'
      | 'script_command'
      | 'task_config'
      | 'task_state'
      | 'next_run'
      | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.context_mode !== undefined) {
    fields.push('context_mode = ?');
    values.push(updates.context_mode);
  }
  if (updates.operation_permission_mode !== undefined) {
    fields.push('operation_permission_mode = ?');
    values.push(updates.operation_permission_mode === 'bypass' ? 'bypass' : 'default');
  }
  if (updates.agent_runtime_override !== undefined) {
    fields.push('agent_runtime_override = ?');
    values.push(updates.agent_runtime_override ?? null);
  }
  if (updates.execution_environment !== undefined) {
    fields.push('execution_environment = ?');
    values.push(updates.execution_environment === 'worktree' ? 'worktree' : 'local');
  }
  if (updates.execution_type !== undefined) {
    fields.push('execution_type = ?');
    values.push(updates.execution_type);
  }
  if (updates.script_command !== undefined) {
    fields.push('script_command = ?');
    values.push(updates.script_command);
  }
  if (updates.task_config !== undefined) {
    fields.push('task_config = ?');
    values.push(
      updates.task_config ? JSON.stringify(updates.task_config) : null,
    );
  }
  if (updates.task_state !== undefined) {
    fields.push('task_state = ?');
    values.push(
      updates.task_state ? JSON.stringify(updates.task_state) : null,
    );
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function deleteTasksForGroup(groupFolder: string): void {
  const tx = db.transaction((folder: string) => {
    db.prepare(
      `
      DELETE FROM task_run_logs
      WHERE task_id IN (
        SELECT id FROM scheduled_tasks WHERE group_folder = ?
      )
      `,
    ).run(folder);
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(
      folder,
    );
  });
  tx(groupFolder);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as Record<string, unknown>[];
  return rows.map((row) => parseScheduledTaskRow(row));
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function updateTaskAfterManualRun(
  id: string,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET last_run = ?, last_result = ?
    WHERE id = ?
  `,
  ).run(now, lastResult, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function cleanupOldTaskRunLogs(retentionDays = 30): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    `DELETE FROM task_run_logs WHERE run_at < ?`,
  ).run(cutoff);
  return result.changes;
}

export interface TodoListFilters {
  status?: TodoStatus;
  priority?: TodoPriority;
  source_type?: TodoSourceType;
  source_id?: string;
  source_run_id?: string;
  trigger_mode?: TodoTriggerMode;
  limit?: number;
  cursor?: string;
}

export interface TodoMetricsFilters {
  source_type?: TodoSourceType;
  source_id?: string;
  source_run_id?: string;
  trigger_mode?: TodoTriggerMode;
  date_from?: string;
  date_to?: string;
}

export interface DecisionItemListFilters {
  status?: DecisionItemStatus;
  scope_level?: DecisionItemScopeLevel;
  scope_id?: string;
  source_type?: TodoSourceType;
  source_id?: string;
  limit?: number;
  cursor?: string;
}

export interface TodoIngestMetrics {
  total: number;
  created: number;
  merged: number;
  ignored: number;
  create_rate: number;
  merge_rate: number;
  ignored_rate: number;
  by_source_type: Record<
    TodoSourceType,
    {
      total: number;
      created: number;
      merged: number;
      ignored: number;
    }
  >;
}

type TodoMergePatch = Pick<
  Todo,
  'occurrence_count' | 'last_seen_at' | 'priority' | 'updated_at'
>;

export function withTransaction<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

function parseTodoRow(row: Record<string, unknown>): Todo {
  return {
    id: String(row.id),
    title: String(row.title),
    description:
      typeof row.description === 'string' ? row.description : null,
    status: row.status as TodoStatus,
    priority:
      row.priority === null || row.priority === undefined
        ? null
        : (row.priority as TodoPriority),
    dedupe_key: String(row.dedupe_key),
    occurrence_count: Number(row.occurrence_count ?? 1),
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
    created_by:
      typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function parseDecisionItemRow(row: Record<string, unknown>): DecisionItem {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: typeof row.summary === 'string' ? row.summary : null,
    status: row.status as DecisionItemStatus,
    scope_level:
      row.scope_level === 'workspace'
        ? 'workspace'
        : 'global',
    scope_id: typeof row.scope_id === 'string' ? row.scope_id : null,
    priority:
      row.priority === null || row.priority === undefined
        ? null
        : (row.priority as TodoPriority),
    source_type: row.source_type as TodoSourceType,
    source_id: String(row.source_id),
    source_run_id:
      typeof row.source_run_id === 'string' ? row.source_run_id : null,
    evidence: typeof row.evidence === 'string' ? row.evidence : null,
    suggested_todo_title:
      typeof row.suggested_todo_title === 'string'
        ? row.suggested_todo_title
        : null,
    suggested_todo_description:
      typeof row.suggested_todo_description === 'string'
        ? row.suggested_todo_description
        : null,
    suggested_todo_priority:
      row.suggested_todo_priority === null
      || row.suggested_todo_priority === undefined
        ? null
        : (row.suggested_todo_priority as TodoPriority),
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    decided_at: typeof row.decided_at === 'string' ? row.decided_at : null,
    decided_by: typeof row.decided_by === 'string' ? row.decided_by : null,
    accepted_todo_id:
      typeof row.accepted_todo_id === 'string' ? row.accepted_todo_id : null,
  };
}

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

function parseRadarSourceTemplateRow(row: Record<string, unknown>): RadarSourceTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as RadarSourceType,
    url: String(row.url),
    default_enabled: Number(row.default_enabled ?? 0) === 1,
    default_cadence: row.default_cadence as RadarCadence,
    tags: parseJsonStringArray(row.tags),
    active: Number(row.active ?? 0) === 1,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function parseRadarUserSourceOverrideRow(
  row: Record<string, unknown>,
): RadarUserSourceOverride {
  return {
    user_id: String(row.user_id),
    template_id: String(row.template_id),
    enabled_override:
      row.enabled_override === null || row.enabled_override === undefined
        ? null
        : Number(row.enabled_override) === 1,
    cadence_override:
      row.cadence_override === null || row.cadence_override === undefined
        ? null
        : (row.cadence_override as RadarCadence),
    include_keywords: parseJsonStringArray(row.include_keywords),
    exclude_keywords: parseJsonStringArray(row.exclude_keywords),
    updated_at: String(row.updated_at),
  };
}

function parseRadarUserCustomFeedRow(
  row: Record<string, unknown>,
): RadarUserCustomFeed {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    rss_url: String(row.rss_url),
    enabled: Number(row.enabled ?? 0) === 1,
    cadence: row.cadence as RadarCadence,
    tags: parseJsonStringArray(row.tags),
    include_keywords: parseJsonStringArray(row.include_keywords),
    exclude_keywords: parseJsonStringArray(row.exclude_keywords),
    consecutive_failures: Number(row.consecutive_failures ?? 0),
    last_success_at:
      typeof row.last_success_at === 'string' ? row.last_success_at : null,
    last_error_at:
      typeof row.last_error_at === 'string' ? row.last_error_at : null,
    last_error_message:
      typeof row.last_error_message === 'string'
        ? row.last_error_message
        : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function listRadarSourceTemplates(
  options: { activeOnly?: boolean } = {},
): RadarSourceTemplate[] {
  const activeOnly = options.activeOnly !== false;
  const rows = activeOnly
    ? (db
        .prepare(
          `
      SELECT *
      FROM radar_source_templates
      WHERE active = 1
      ORDER BY created_at ASC, id ASC
    `,
        )
        .all() as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `
      SELECT *
      FROM radar_source_templates
      ORDER BY created_at ASC, id ASC
    `,
        )
        .all() as Array<Record<string, unknown>>);
  return rows.map(parseRadarSourceTemplateRow);
}

export function getRadarSourceTemplateById(
  id: string,
): RadarSourceTemplate | undefined {
  const row = db
    .prepare('SELECT * FROM radar_source_templates WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? parseRadarSourceTemplateRow(row) : undefined;
}

export function listRadarUserSourceOverrides(
  userId: string,
): RadarUserSourceOverride[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM radar_user_source_overrides
      WHERE user_id = ?
      ORDER BY template_id ASC
    `,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(parseRadarUserSourceOverrideRow);
}

export function getRadarUserSourceOverride(
  userId: string,
  templateId: string,
): RadarUserSourceOverride | undefined {
  const row = db
    .prepare(
      `
      SELECT *
      FROM radar_user_source_overrides
      WHERE user_id = ? AND template_id = ?
    `,
    )
    .get(userId, templateId) as Record<string, unknown> | undefined;
  return row ? parseRadarUserSourceOverrideRow(row) : undefined;
}

export function updateRadarUserSourceOverride(
  override: RadarUserSourceOverride,
): void {
  db.prepare(
    `
    INSERT INTO radar_user_source_overrides (
      user_id, template_id, enabled_override, cadence_override, include_keywords, exclude_keywords, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, template_id) DO UPDATE SET
      enabled_override = excluded.enabled_override,
      cadence_override = excluded.cadence_override,
      include_keywords = excluded.include_keywords,
      exclude_keywords = excluded.exclude_keywords,
      updated_at = excluded.updated_at
  `,
  ).run(
    override.user_id,
    override.template_id,
    override.enabled_override === null
      ? null
      : (override.enabled_override ? 1 : 0),
    override.cadence_override,
    JSON.stringify(override.include_keywords),
    JSON.stringify(override.exclude_keywords),
    override.updated_at,
  );
}

export function listRadarUserCustomFeeds(
  userId: string,
): RadarUserCustomFeed[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM radar_user_custom_feeds
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(parseRadarUserCustomFeedRow);
}

export function createRadarUserCustomFeed(feed: RadarUserCustomFeed): void {
  db.prepare(
    `
    INSERT INTO radar_user_custom_feeds (
      id, user_id, name, rss_url, enabled, cadence, tags,
      include_keywords, exclude_keywords, consecutive_failures,
      last_success_at, last_error_at, last_error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    feed.id,
    feed.user_id,
    feed.name,
    feed.rss_url,
    feed.enabled ? 1 : 0,
    feed.cadence,
    JSON.stringify(feed.tags),
    JSON.stringify(feed.include_keywords),
    JSON.stringify(feed.exclude_keywords),
    feed.consecutive_failures,
    feed.last_success_at,
    feed.last_error_at,
    feed.last_error_message,
    feed.created_at,
    feed.updated_at,
  );
}

export function getRadarUserCustomFeedById(
  userId: string,
  id: string,
): RadarUserCustomFeed | undefined {
  const row = db
    .prepare(
      `
      SELECT *
      FROM radar_user_custom_feeds
      WHERE user_id = ? AND id = ?
    `,
    )
    .get(userId, id) as Record<string, unknown> | undefined;
  return row ? parseRadarUserCustomFeedRow(row) : undefined;
}

export function updateRadarUserCustomFeed(
  userId: string,
  id: string,
  patch: Partial<
    Pick<
      RadarUserCustomFeed,
      | 'name'
      | 'rss_url'
      | 'enabled'
      | 'cadence'
      | 'tags'
      | 'include_keywords'
      | 'exclude_keywords'
      | 'consecutive_failures'
      | 'last_success_at'
      | 'last_error_at'
      | 'last_error_message'
      | 'updated_at'
    >
  >,
): boolean {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    params.push(patch.name);
  }
  if (patch.rss_url !== undefined) {
    fields.push('rss_url = ?');
    params.push(patch.rss_url);
  }
  if (patch.enabled !== undefined) {
    fields.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.cadence !== undefined) {
    fields.push('cadence = ?');
    params.push(patch.cadence);
  }
  if (patch.tags !== undefined) {
    fields.push('tags = ?');
    params.push(JSON.stringify(patch.tags));
  }
  if (patch.include_keywords !== undefined) {
    fields.push('include_keywords = ?');
    params.push(JSON.stringify(patch.include_keywords));
  }
  if (patch.exclude_keywords !== undefined) {
    fields.push('exclude_keywords = ?');
    params.push(JSON.stringify(patch.exclude_keywords));
  }
  if (patch.consecutive_failures !== undefined) {
    fields.push('consecutive_failures = ?');
    params.push(patch.consecutive_failures);
  }
  if (patch.last_success_at !== undefined) {
    fields.push('last_success_at = ?');
    params.push(patch.last_success_at);
  }
  if (patch.last_error_at !== undefined) {
    fields.push('last_error_at = ?');
    params.push(patch.last_error_at);
  }
  if (patch.last_error_message !== undefined) {
    fields.push('last_error_message = ?');
    params.push(patch.last_error_message);
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  params.push(patch.updated_at ?? new Date().toISOString());
  params.push(userId, id);

  const result = db
    .prepare(
      `
      UPDATE radar_user_custom_feeds
      SET ${fields.join(', ')}
      WHERE user_id = ? AND id = ?
    `,
    )
    .run(...params);

  return result.changes > 0;
}

export function deleteRadarUserCustomFeed(userId: string, id: string): boolean {
  const result = db
    .prepare(
      `
      DELETE FROM radar_user_custom_feeds
      WHERE user_id = ? AND id = ?
    `,
    )
    .run(userId, id);
  return result.changes > 0;
}

export function getTodoById(id: string): Todo | undefined {
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? parseTodoRow(row) : undefined;
}

export function getTodoByDedupeKey(dedupeKey: string): Todo | undefined {
  const row = db
    .prepare('SELECT * FROM todos WHERE dedupe_key = ?')
    .get(dedupeKey) as Record<string, unknown> | undefined;
  return row ? parseTodoRow(row) : undefined;
}

export function insertTodo(todo: Todo): void {
  db.prepare(
    `
    INSERT INTO todos (
      id, title, description, status, priority, dedupe_key, occurrence_count,
      first_seen_at, last_seen_at, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    todo.id,
    todo.title,
    todo.description,
    todo.status,
    todo.priority,
    todo.dedupe_key,
    todo.occurrence_count,
    todo.first_seen_at,
    todo.last_seen_at,
    todo.created_by,
    todo.created_at,
    todo.updated_at,
  );
}

export function updateTodoMerge(todoId: string, patch: TodoMergePatch): void {
  db.prepare(
    `
    UPDATE todos
    SET occurrence_count = ?, last_seen_at = ?, priority = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    patch.occurrence_count,
    patch.last_seen_at,
    patch.priority,
    patch.updated_at,
    todoId,
  );
}

export function getDecisionItemById(id: string): DecisionItem | undefined {
  const row = db
    .prepare('SELECT * FROM decision_items WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? parseDecisionItemRow(row) : undefined;
}

function extractDecisionEvidenceFingerprint(
  evidenceRaw: string | null,
): string | null {
  if (!evidenceRaw) return null;
  try {
    const parsed = JSON.parse(evidenceRaw) as unknown;
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && typeof (parsed as { __dedupe_fingerprint?: unknown }).__dedupe_fingerprint === 'string'
    ) {
      return (parsed as { __dedupe_fingerprint: string }).__dedupe_fingerprint;
    }
  } catch {
    return null;
  }
  return null;
}

export function findRecentPendingDecisionItemByFingerprint(
  filters: {
    source_type: TodoSourceType;
    source_id: string;
    scope_level: DecisionItemScopeLevel;
    scope_id?: string | null;
    fingerprint: string;
    since: string;
    limit?: number;
  },
): DecisionItem | undefined {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const scopeId = filters.scope_level === 'workspace' ? (filters.scope_id ?? null) : null;
  const rows = db
    .prepare(
      `
      SELECT *
      FROM decision_items d
      WHERE d.status = 'pending'
        AND d.source_type = ?
        AND d.source_id = ?
        AND d.scope_level = ?
        AND (
          (d.scope_id IS NULL AND ? IS NULL)
          OR d.scope_id = ?
        )
        AND d.created_at >= ?
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ?
    `,
    )
    .all(
      filters.source_type,
      filters.source_id,
      filters.scope_level,
      scopeId,
      scopeId,
      filters.since,
      limit,
    ) as Array<Record<string, unknown>>;

  for (const row of rows) {
    const item = parseDecisionItemRow(row);
    if (extractDecisionEvidenceFingerprint(item.evidence) === filters.fingerprint) {
      return item;
    }
  }
  return undefined;
}

export function insertDecisionItem(item: DecisionItem): void {
  db.prepare(
    `
    INSERT INTO decision_items (
      id, title, summary, status, scope_level, scope_id, priority, source_type, source_id, source_run_id, evidence,
      suggested_todo_title, suggested_todo_description, suggested_todo_priority,
      created_by, created_at, updated_at, decided_at, decided_by, accepted_todo_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    item.id,
    item.title,
    item.summary,
    item.status,
    item.scope_level,
    item.scope_id,
    item.priority,
    item.source_type,
    item.source_id,
    item.source_run_id,
    item.evidence,
    item.suggested_todo_title,
    item.suggested_todo_description,
    item.suggested_todo_priority,
    item.created_by,
    item.created_at,
    item.updated_at,
    item.decided_at,
    item.decided_by,
    item.accepted_todo_id,
  );
}

export function updateDecisionItemDecision(
  id: string,
  patch: {
    status: Extract<DecisionItemStatus, 'accepted' | 'ignored'>;
    decided_at: string;
    decided_by: string;
    accepted_todo_id?: string | null;
  },
): void {
  db.prepare(
    `
    UPDATE decision_items
    SET status = ?,
        decided_at = ?,
        decided_by = ?,
        accepted_todo_id = ?,
        updated_at = ?
    WHERE id = ?
  `,
  ).run(
    patch.status,
    patch.decided_at,
    patch.decided_by,
    patch.accepted_todo_id ?? null,
    patch.decided_at,
    id,
  );
}

export function updateDecisionItemPendingMerge(
  id: string,
  patch: {
    title: string;
    summary: string | null;
    priority: TodoPriority | null;
    source_run_id: string | null;
    evidence: string | null;
    suggested_todo_title: string | null;
    suggested_todo_description: string | null;
    suggested_todo_priority: TodoPriority | null;
    updated_at: string;
  },
): void {
  db.prepare(
    `
    UPDATE decision_items
    SET title = ?,
        summary = ?,
        priority = ?,
        source_run_id = ?,
        evidence = ?,
        suggested_todo_title = ?,
        suggested_todo_description = ?,
        suggested_todo_priority = ?,
        updated_at = ?
    WHERE id = ? AND status = 'pending'
  `,
  ).run(
    patch.title,
    patch.summary,
    patch.priority,
    patch.source_run_id,
    patch.evidence,
    patch.suggested_todo_title,
    patch.suggested_todo_description,
    patch.suggested_todo_priority,
    patch.updated_at,
    id,
  );
}

export function insertTodoSourceEvent(event: TodoSourceEvent): void {
  db.prepare(
    `
    INSERT INTO todo_source_events (
      todo_id, source_type, source_id, source_run_id, trigger_mode, action, evidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    event.todo_id,
    event.source_type,
    event.source_id,
    event.source_run_id,
    event.trigger_mode,
    event.action,
    event.evidence,
    event.created_at,
  );
}

export function listTodoSourceEvents(todoId: string): TodoSourceEvent[] {
  const rows = db
    .prepare(
      `
      SELECT id, todo_id, source_type, source_id, source_run_id, trigger_mode, action, evidence, created_at
      FROM todo_source_events
      WHERE todo_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(todoId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: Number(row.id),
    todo_id: String(row.todo_id),
    source_type: row.source_type as TodoSourceType,
    source_id: String(row.source_id),
    source_run_id:
      typeof row.source_run_id === 'string' ? row.source_run_id : null,
    trigger_mode:
      row.trigger_mode === null || row.trigger_mode === undefined
        ? null
        : (row.trigger_mode as TodoTriggerMode),
    action: row.action as TodoSourceEvent['action'],
    evidence: typeof row.evidence === 'string' ? row.evidence : null,
    created_at: String(row.created_at),
  }));
}

export function listTodos(filters: TodoListFilters = {}): Todo[] {
  const clauses: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.status) {
    clauses.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.priority) {
    clauses.push('t.priority = ?');
    params.push(filters.priority);
  }
  if (filters.source_type) {
    clauses.push(
      'EXISTS (SELECT 1 FROM todo_source_events e WHERE e.todo_id = t.id AND e.source_type = ?)',
    );
    params.push(filters.source_type);
  }
  if (filters.source_id) {
    clauses.push(
      'EXISTS (SELECT 1 FROM todo_source_events e WHERE e.todo_id = t.id AND e.source_id = ?)',
    );
    params.push(filters.source_id);
  }
  if (filters.source_run_id) {
    clauses.push(
      'EXISTS (SELECT 1 FROM todo_source_events e WHERE e.todo_id = t.id AND e.source_run_id = ?)',
    );
    params.push(filters.source_run_id);
  }
  if (filters.trigger_mode) {
    clauses.push(
      'EXISTS (SELECT 1 FROM todo_source_events e WHERE e.todo_id = t.id AND e.trigger_mode = ?)',
    );
    params.push(filters.trigger_mode);
  }
  if (filters.cursor) {
    const cursor = filters.cursor.trim();
    const dividerIdx = cursor.lastIndexOf('|');
    if (dividerIdx > 0) {
      const cursorTs = cursor.slice(0, dividerIdx);
      const cursorId = cursor.slice(dividerIdx + 1);
      if (cursorTs && cursorId) {
        clauses.push('(t.last_seen_at < ? OR (t.last_seen_at = ? AND t.id < ?))');
        params.push(cursorTs, cursorTs, cursorId);
      }
    }
  }

  const limit = Math.max(1, Math.min(filters.limit ?? 20, 200));
  const rows = db
    .prepare(
      `
      SELECT t.*
      FROM todos t
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.last_seen_at DESC, t.id DESC
      LIMIT ?
    `,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(parseTodoRow);
}

export function listDecisionItems(
  filters: DecisionItemListFilters = {},
): DecisionItem[] {
  const clauses: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.status) {
    clauses.push('d.status = ?');
    params.push(filters.status);
  }
  if (filters.scope_level) {
    clauses.push('d.scope_level = ?');
    params.push(filters.scope_level);
  }
  if (filters.scope_id) {
    clauses.push('d.scope_id = ?');
    params.push(filters.scope_id);
  }
  if (filters.source_type) {
    clauses.push('d.source_type = ?');
    params.push(filters.source_type);
  }
  if (filters.source_id) {
    clauses.push('d.source_id = ?');
    params.push(filters.source_id);
  }
  if (filters.cursor) {
    const cursor = filters.cursor.trim();
    const dividerIdx = cursor.lastIndexOf('|');
    if (dividerIdx > 0) {
      const cursorTs = cursor.slice(0, dividerIdx);
      const cursorId = cursor.slice(dividerIdx + 1);
      if (cursorTs && cursorId) {
        clauses.push('(d.created_at < ? OR (d.created_at = ? AND d.id < ?))');
        params.push(cursorTs, cursorTs, cursorId);
      }
    }
  }

  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const rows = db
    .prepare(
      `
      SELECT d.*
      FROM decision_items d
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ?
    `,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(parseDecisionItemRow);
}

export function getTodoIngestMetrics(
  filters: TodoMetricsFilters = {},
): TodoIngestMetrics {
  const clauses: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.source_type) {
    clauses.push('e.source_type = ?');
    params.push(filters.source_type);
  }
  if (filters.source_id) {
    clauses.push('e.source_id = ?');
    params.push(filters.source_id);
  }
  if (filters.source_run_id) {
    clauses.push('e.source_run_id = ?');
    params.push(filters.source_run_id);
  }
  if (filters.trigger_mode) {
    clauses.push('e.trigger_mode = ?');
    params.push(filters.trigger_mode);
  }
  if (filters.date_from) {
    clauses.push('e.created_at >= ?');
    params.push(`${filters.date_from}T00:00:00.000Z`);
  }
  if (filters.date_to) {
    const end = new Date(`${filters.date_to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    clauses.push('e.created_at < ?');
    params.push(end.toISOString());
  }

  const whereSql = clauses.join(' AND ');
  const byActionRows = db
    .prepare(
      `
      SELECT action, COUNT(*) AS total
      FROM todo_source_events e
      WHERE ${whereSql}
      GROUP BY action
    `,
    )
    .all(...params) as Array<{ action: string; total: number }>;

  let total = 0;
  let created = 0;
  let merged = 0;
  let ignored = 0;
  for (const row of byActionRows) {
    const count = Number(row.total ?? 0);
    total += count;
    if (row.action === 'created') created += count;
    else if (row.action === 'merged') merged += count;
    else if (row.action === 'ignored') ignored += count;
  }

  const bySourceType: TodoIngestMetrics['by_source_type'] = {
    manual: { total: 0, created: 0, merged: 0, ignored: 0 },
    automation: { total: 0, created: 0, merged: 0, ignored: 0 },
    plugin: { total: 0, created: 0, merged: 0, ignored: 0 },
    workflow: { total: 0, created: 0, merged: 0, ignored: 0 },
  };

  const bySourceRows = db
    .prepare(
      `
      SELECT source_type, action, COUNT(*) AS total
      FROM todo_source_events e
      WHERE ${whereSql}
      GROUP BY source_type, action
    `,
    )
    .all(...params) as Array<{
      source_type: TodoSourceType;
      action: string;
      total: number;
    }>;

  for (const row of bySourceRows) {
    const sourceBucket = bySourceType[row.source_type];
    if (!sourceBucket) continue;
    const count = Number(row.total ?? 0);
    sourceBucket.total += count;
    if (row.action === 'created') sourceBucket.created += count;
    else if (row.action === 'merged') sourceBucket.merged += count;
    else if (row.action === 'ignored') sourceBucket.ignored += count;
  }

  const safeRate = (count: number): number => {
    if (total <= 0) return 0;
    return Number((count / total).toFixed(4));
  };

  return {
    total,
    created,
    merged,
    ignored,
    create_rate: safeRate(created),
    merge_rate: safeRate(merged),
    ignored_rate: safeRate(ignored),
    by_source_type: bySourceType,
  };
}

export function countTodoEventsForSourceOnDate(
  sourceType: TodoSourceType,
  sourceId: string,
  isoDate: string,
): number {
  const likePattern = `${isoDate}%`;
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM todo_source_events
      WHERE source_type = ? AND source_id = ? AND created_at LIKE ?
    `,
    )
    .get(sourceType, sourceId, likePattern) as { total?: number } | undefined;
  return Number(row?.total ?? 0);
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string, agentId?: string | null): string | undefined {
  const effectiveAgentId = agentId || '';
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ? AND agent_id = ?')
    .get(groupFolder, effectiveAgentId) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string, agentId?: string | null): void {
  const effectiveAgentId = agentId || '';
  db.prepare(
    `INSERT INTO sessions (group_folder, session_id, agent_id) VALUES (?, ?, ?)
     ON CONFLICT(group_folder, agent_id) DO UPDATE SET session_id = excluded.session_id`,
  ).run(groupFolder, sessionId, effectiveAgentId);
}

export function deleteSession(groupFolder: string, agentId?: string | null): void {
  const effectiveAgentId = agentId || '';
  db.prepare('DELETE FROM sessions WHERE group_folder = ? AND agent_id = ?').run(groupFolder, effectiveAgentId);
}

export function deleteAgentSessions(groupFolder: string, agentId: string): void {
  db.prepare(
    'DELETE FROM sessions WHERE group_folder = ? AND (agent_id = ? OR agent_id LIKE ?)',
  ).run(groupFolder, agentId, `${agentId}@%`);
}

export function deleteAllSessionsForFolder(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare("SELECT group_folder, session_id FROM sessions WHERE agent_id = ''")
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

function parseExecutionMode(raw: string | null, context: string): ExecutionMode {
  if (raw === 'container' || raw === 'host') return raw;
  if (raw !== null && raw !== '') {
    console.warn(
      `Invalid execution_mode "${raw}" for ${context}, falling back to "container"`,
    );
  }
  return 'container';
}

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        added_at: string;
        container_config: string | null;
        execution_mode: string | null;
        custom_cwd: string | null;
        init_source_path: string | null;
        init_git_url: string | null;
        created_by: string | null;
        is_home: number;
        selected_skills: string | null;
      }
    | undefined;
  if (!row) return undefined;

  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    executionMode: parseExecutionMode(row.execution_mode, `group ${jid}`),
    customCwd: row.custom_cwd ?? undefined,
    initSourcePath: row.init_source_path ?? undefined,
    initGitUrl: row.init_git_url ?? undefined,
    created_by: row.created_by ?? undefined,
    is_home: row.is_home === 1,
    selected_skills: row.selected_skills ? JSON.parse(row.selected_skills) : null,
  };
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, added_at, container_config, execution_mode, custom_cwd, init_source_path, init_git_url, created_by, is_home, selected_skills)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.executionMode ?? 'container',
    group.customCwd ?? null,
    group.initSourcePath ?? null,
    group.initGitUrl ?? null,
    group.created_by ?? null,
    group.is_home ? 1 : 0,
    group.selected_skills ? JSON.stringify(group.selected_skills) : null,
  );
}

export function deleteRegisteredGroup(jid: string): void {
  db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
}

/** Get all JIDs that share the same folder (e.g., all JIDs with folder='main'). */
export function getJidsByFolder(folder: string): string[] {
  const rows = db
    .prepare('SELECT jid FROM registered_groups WHERE folder = ?')
    .all(folder) as Array<{ jid: string }>;
  return rows.map((r) => r.jid);
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    added_at: string;
    container_config: string | null;
    execution_mode: string | null;
    custom_cwd: string | null;
    init_source_path: string | null;
    init_git_url: string | null;
    created_by: string | null;
    is_home: number;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      executionMode: parseExecutionMode(row.execution_mode, `group ${row.jid}`),
      customCwd: row.custom_cwd ?? undefined,
      initSourcePath: row.init_source_path ?? undefined,
      initGitUrl: row.init_git_url ?? undefined,
      created_by: row.created_by ?? undefined,
      is_home: row.is_home === 1,
    };
  }
  return result;
}

function mapChannelSessionBindingRow(
  row: {
    chat_jid: string;
    channel: string;
    target_folder: string;
    owner_user_id: string;
    enabled: number;
    created_at: string;
    updated_at: string;
    created_by: string;
    updated_by: string;
  },
): ChannelSessionBinding {
  return {
    chat_jid: row.chat_jid,
    channel: row.channel as ImChannel,
    target_folder: row.target_folder,
    owner_user_id: row.owner_user_id,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
  };
}

export function parseImChannelFromJid(chatJid: string): ImChannel | null {
  return parseImChannelFromJidInternal(chatJid);
}

export function getChannelSessionBinding(
  chatJid: string,
): ChannelSessionBinding | undefined {
  const row = db
    .prepare('SELECT * FROM channel_session_bindings WHERE chat_jid = ?')
    .get(chatJid) as
    | {
        chat_jid: string;
        channel: string;
        target_folder: string;
        owner_user_id: string;
        enabled: number;
        created_at: string;
        updated_at: string;
        created_by: string;
        updated_by: string;
      }
    | undefined;
  if (!row) return undefined;
  return mapChannelSessionBindingRow(row);
}

export function getEnabledChannelSessionBinding(
  chatJid: string,
): ChannelSessionBinding | undefined {
  const binding = getChannelSessionBinding(chatJid);
  if (!binding || !binding.enabled) return undefined;
  return binding;
}

export interface ListChannelSessionBindingsOptions {
  ownerUserId?: string;
  channel?: ImChannel;
  enabledOnly?: boolean;
}

export function listChannelSessionBindings(
  options: ListChannelSessionBindingsOptions = {},
): ChannelSessionBinding[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.ownerUserId) {
    where.push('owner_user_id = ?');
    params.push(options.ownerUserId);
  }
  if (options.channel) {
    where.push('channel = ?');
    params.push(options.channel);
  }
  if (options.enabledOnly) {
    where.push('enabled = 1');
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM channel_session_bindings ${whereSql} ORDER BY updated_at DESC`,
    )
    .all(...params) as Array<{
    chat_jid: string;
    channel: string;
    target_folder: string;
    owner_user_id: string;
    enabled: number;
    created_at: string;
    updated_at: string;
    created_by: string;
    updated_by: string;
  }>;

  return rows.map((row) => mapChannelSessionBindingRow(row));
}

export interface UpsertChannelSessionBindingInput {
  chat_jid: string;
  target_folder: string;
  owner_user_id: string;
  enabled?: boolean;
  actor_user_id: string;
}

export function upsertChannelSessionBinding(
  input: UpsertChannelSessionBindingInput,
): ChannelSessionBinding {
  const channel = parseImChannelFromJid(input.chat_jid);
  if (!channel) {
    throw new Error('chat_jid must be a supported IM session');
  }

  const chatJid = input.chat_jid.trim();
  const targetFolder = input.target_folder.trim();
  const ownerUserId = input.owner_user_id.trim();
  const actorUserId = input.actor_user_id.trim();
  if (!chatJid || !targetFolder || !ownerUserId || !actorUserId) {
    throw new Error('chat_jid, target_folder, owner_user_id, actor_user_id are required');
  }

  const now = new Date().toISOString();
  const enabled = input.enabled === false ? 0 : 1;

  db.prepare(
    `INSERT INTO channel_session_bindings (
      chat_jid, channel, target_folder, owner_user_id, enabled,
      created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_jid) DO UPDATE SET
      channel = excluded.channel,
      target_folder = excluded.target_folder,
      owner_user_id = excluded.owner_user_id,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by`,
  ).run(
    chatJid,
    channel,
    targetFolder,
    ownerUserId,
    enabled,
    now,
    now,
    actorUserId,
    actorUserId,
  );

  const updated = getChannelSessionBinding(chatJid);
  if (!updated) {
    throw new Error('Failed to read channel session binding after upsert');
  }
  return updated;
}

export function deleteChannelSessionBinding(chatJid: string): void {
  db
    .prepare('DELETE FROM channel_session_bindings WHERE chat_jid = ?')
    .run(chatJid);
}

/**
 * Find a user's home group (is_home=1 + created_by=userId).
 * For admin users, also matches web:main even if created_by differs
 * (all admins share folder=main).
 */
export function getUserHomeGroup(
  userId: string,
): (RegisteredGroup & { jid: string }) | undefined {
  // First try exact match: is_home=1 AND created_by=userId
  let row = db
    .prepare(
      'SELECT * FROM registered_groups WHERE is_home = 1 AND created_by = ?',
    )
    .get(userId) as
    | {
        jid: string;
        name: string;
        folder: string;
        added_at: string;
        container_config: string | null;
        execution_mode: string | null;
        custom_cwd: string | null;
        init_source_path: string | null;
        init_git_url: string | null;
        created_by: string | null;
        is_home: number;
      }
    | undefined;

  // Fallback for admin users: all admins share web:main (folder=main).
  // If no exact match, check if the user is an admin and web:main exists.
  if (!row) {
    const user = db
      .prepare("SELECT role FROM users WHERE id = ? AND status = 'active'")
      .get(userId) as { role: string } | undefined;
    if (user?.role === 'admin') {
      row = db
        .prepare(
          "SELECT * FROM registered_groups WHERE jid = 'web:main' AND is_home = 1",
        )
        .get() as typeof row | undefined;
    }
  }

  if (!row) return undefined;

  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    executionMode: parseExecutionMode(row.execution_mode, `group ${row.jid}`),
    customCwd: row.custom_cwd ?? undefined,
    initSourcePath: row.init_source_path ?? undefined,
    initGitUrl: row.init_git_url ?? undefined,
    created_by: row.created_by ?? undefined,
    is_home: row.is_home === 1,
  };
}

/**
 * Ensure a user has a home group. If not, create one.
 * Admin gets folder='main' with executionMode='host'.
 * Member gets folder='home-{userId}' with executionMode='container'.
 * Returns the JID of the home group.
 */
export function ensureUserHomeGroup(
  userId: string,
  role: 'admin' | 'member',
  username?: string,
): string {
  const existing = getUserHomeGroup(userId);
  if (existing) return existing.jid;

  const now = new Date().toISOString();
  const isAdmin = role === 'admin';
  const jid = isAdmin ? 'web:main' : `web:home-${userId}`;
  const folder = isAdmin ? 'main' : `home-${userId}`;

  // For admin: check if web:main already exists (created by another admin)
  // In that case, reuse it rather than overwriting created_by
  if (isAdmin) {
    const existingMain = getRegisteredGroup(jid);
    if (existingMain) {
      // web:main already exists.
      // Ensure is_home, created_by, and executionMode are correct for owner-based routing.
      const patched = { ...existingMain };
      let changed = false;
      if (!patched.is_home) {
        patched.is_home = true;
        changed = true;
      }
      if (!patched.created_by) {
        patched.created_by = userId;
        changed = true;
      }
      // Admin home container must use host mode
      if (patched.executionMode !== 'host') {
        patched.executionMode = 'host';
        changed = true;
      }
      if (changed) {
        setRegisteredGroup(jid, patched);
      }
      ensureChatExists(jid);
      return jid;
    }
  }

  const name = username ? `${username} Home` : (isAdmin ? 'Main' : 'Home');

  const group: RegisteredGroup = {
    name,
    folder,
    added_at: now,
    executionMode: isAdmin ? 'host' : 'container',
    created_by: userId,
    is_home: true,
  };

  setRegisteredGroup(jid, group);

  // Ensure chat row exists
  ensureChatExists(jid);

  // Create user-global memory directory and initialize runtime primary memory files
  const userGlobalDir = path.join(GROUPS_DIR, 'user-global', userId);
  fs.mkdirSync(userGlobalDir, { recursive: true });
  const primaryMemoryFileNames = listRuntimePrimaryMemoryFileNames(
    getRuntimeProviderConfig().agentRuntime,
  );
  const templatePath = path.resolve(
    process.cwd(),
    'config',
    'global-memory-template.md',
  );
  const templateContent = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf-8')
    : '';

  let seedContent = templateContent;
  for (const fileName of primaryMemoryFileNames) {
    const existingPath = path.join(userGlobalDir, fileName);
    if (fs.existsSync(existingPath)) {
      seedContent = fs.readFileSync(existingPath, 'utf-8');
      break;
    }
  }

  for (const fileName of primaryMemoryFileNames) {
    const userMemoryFile = path.join(userGlobalDir, fileName);
    if (fs.existsSync(userMemoryFile)) continue;
    try {
      fs.writeFileSync(userMemoryFile, seedContent, { flag: 'wx' });
    } catch {
      // EEXIST race or read error — ignore
    }
  }

  return jid;
}

export function deleteChatHistory(chatJid: string): void {
  const tx = db.transaction((jid: string) => {
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
  });
  tx(chatJid);
}

export function deleteGroupData(jid: string, folder: string): void {
  const tx = db.transaction(() => {
    // 1. 删除定时任务运行日志 + 定时任务
    db.prepare(
      'DELETE FROM task_run_logs WHERE task_id IN (SELECT id FROM scheduled_tasks WHERE group_folder = ?)',
    ).run(folder);
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(folder);
    // 2. 删除成员记录
    db.prepare('DELETE FROM group_members WHERE group_folder = ?').run(folder);
    // 3. 删除注册信息
    db.prepare('DELETE FROM registered_groups WHERE jid = ?').run(jid);
    // 4. 删除会话
    db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(folder);
    // 5. 删除聊天记录
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(jid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(jid);
  });
  tx();
}

// --- Web API accessors ---

/**
 * Get paginated messages for a chat, cursor-based pagination.
 * Returns messages in descending timestamp order (newest first).
 */
export function getMessagesPage(
  chatJid: string,
  before?: string,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  const sql = before
    ? `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
      FROM messages
      WHERE chat_jid = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `
    : `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `;

  const params = before ? [chatJid, before, limit] : [chatJid, limit];
  const rows = db.prepare(sql).all(...params) as Array<
    NewMessage & { is_from_me: number; provider?: unknown }
  >;

  return rows.map((row) => ({
    ...row,
    is_from_me: row.is_from_me === 1,
    provider: parseMessageProvider(row.provider),
  }));
}

/**
 * Get messages after a given timestamp (for polling new messages).
 * Returns in ASC order (oldest first).
 */
export function getMessagesAfter(
  chatJid: string,
  after: string,
  limit = 50,
  afterId?: string,
): Array<NewMessage & { is_from_me: boolean }> {
  const useCursorId = typeof afterId === 'string' && afterId.length > 0;
  const rows = (useCursorId
    ? db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
         FROM messages
         WHERE chat_jid = ?
           AND (
             timestamp > ?
             OR (
               timestamp = ?
               AND rowid > COALESCE((SELECT rowid FROM messages WHERE id = ?), -1)
             )
           )
         ORDER BY timestamp ASC, rowid ASC
         LIMIT ?`,
      )
      .all(chatJid, after, after, afterId, limit)
    : db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
         FROM messages
         WHERE chat_jid = ? AND timestamp > ?
         ORDER BY timestamp ASC, rowid ASC
         LIMIT ?`,
      )
      .all(chatJid, after, limit)) as Array<
      NewMessage & { is_from_me: number; provider?: unknown }
    >;

  return rows.map((row) => ({
    ...row,
    is_from_me: row.is_from_me === 1,
    provider: parseMessageProvider(row.provider),
  }));
}

/**
 * 多 JID 分页查询（用于主容器合并 web:main + feishu:xxx 消息）。
 */
export function getMessagesPageMulti(
  chatJids: string[],
  before?: string,
  limit = 50,
): Array<NewMessage & { is_from_me: boolean }> {
  if (chatJids.length === 0) return [];
  if (chatJids.length === 1) return getMessagesPage(chatJids[0], before, limit);

  const placeholders = chatJids.map(() => '?').join(',');
  const sql = before
    ? `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
       FROM messages
       WHERE chat_jid IN (${placeholders}) AND timestamp < ?
       ORDER BY timestamp DESC
       LIMIT ?`
    : `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
       FROM messages
       WHERE chat_jid IN (${placeholders})
       ORDER BY timestamp DESC
       LIMIT ?`;

  const params = before
    ? [...chatJids, before, limit]
    : [...chatJids, limit];
  const rows = db.prepare(sql).all(...params) as Array<
    NewMessage & { is_from_me: number; provider?: unknown }
  >;

  return rows.map((row) => ({
    ...row,
    is_from_me: row.is_from_me === 1,
    provider: parseMessageProvider(row.provider),
  }));
}

/**
 * 多 JID 增量查询（用于主容器轮询合并消息）。
 */
export function getMessagesAfterMulti(
  chatJids: string[],
  after: string,
  limit = 50,
  afterId?: string,
): Array<NewMessage & { is_from_me: boolean }> {
  if (chatJids.length === 0) return [];
  if (chatJids.length === 1) return getMessagesAfter(chatJids[0], after, limit, afterId);

  const placeholders = chatJids.map(() => '?').join(',');
  const useCursorId = typeof afterId === 'string' && afterId.length > 0;
  const rows = (useCursorId
    ? db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
         FROM messages
         WHERE chat_jid IN (${placeholders})
           AND (
             timestamp > ?
             OR (
               timestamp = ?
               AND rowid > COALESCE((SELECT rowid FROM messages WHERE id = ?), -1)
             )
           )
         ORDER BY timestamp ASC, rowid ASC
         LIMIT ?`,
      )
      .all(...chatJids, after, after, afterId, limit)
    : db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments, provider
         FROM messages
         WHERE chat_jid IN (${placeholders}) AND timestamp > ?
         ORDER BY timestamp ASC, rowid ASC
         LIMIT ?`,
      )
      .all(...chatJids, after, limit)) as Array<
      NewMessage & { is_from_me: number; provider?: unknown }
    >;

  return rows.map((row) => ({
    ...row,
    is_from_me: row.is_from_me === 1,
    provider: parseMessageProvider(row.provider),
  }));
}

/**
 * Get task run logs for a specific task, ordered by most recent first.
 */
export function getTaskRunLogs(taskId: string, limit = 20): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT id, task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

// ===================== Daily Summary Queries =====================

/**
 * Get messages for a chat within a time range, ordered by timestamp ASC.
 */
export function getMessagesByTimeRange(
  chatJid: string,
  startTs: number,
  endTs: number,
  limit = 500,
): Array<NewMessage & { is_from_me: boolean }> {
  const startIso = new Date(startTs).toISOString();
  const endIso = new Date(endTs).toISOString();
  const rows = db
    .prepare(
      `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, attachments
       FROM messages
       WHERE chat_jid = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(chatJid, startIso, endIso, limit) as Array<
    NewMessage & { is_from_me: number }
  >;

  return rows.map((row) => ({
    ...row,
    is_from_me: row.is_from_me === 1,
  }));
}

/**
 * Get all registered groups owned by a specific user.
 */
export function getGroupsByOwner(userId: string): Array<RegisteredGroup & { jid: string }> {
  const rows = db
    .prepare('SELECT * FROM registered_groups WHERE created_by = ?')
    .all(userId) as Array<{
    jid: string;
    name: string;
    folder: string;
    added_at: string;
    container_config: string | null;
    execution_mode: string | null;
    custom_cwd: string | null;
    init_source_path: string | null;
    init_git_url: string | null;
    created_by: string | null;
    is_home: number;
    selected_skills: string | null;
  }>;

  return rows.map((row) => ({
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    executionMode: parseExecutionMode(row.execution_mode, `group ${row.jid}`),
    customCwd: row.custom_cwd ?? undefined,
    initSourcePath: row.init_source_path ?? undefined,
    initGitUrl: row.init_git_url ?? undefined,
    created_by: row.created_by ?? undefined,
    is_home: row.is_home === 1,
    selected_skills: row.selected_skills ? JSON.parse(row.selected_skills) : null,
  }));
}

// ===================== Auth CRUD =====================

function parseUserRole(value: unknown): UserRole {
  return value === 'admin' ? 'admin' : 'member';
}

function parseUserStatus(value: unknown): UserStatus {
  if (value === 'deleted') return 'deleted';
  if (value === 'disabled') return 'disabled';
  return 'active';
}

function parsePermissionsFromDb(raw: unknown, role: UserRole): Permission[] {
  if (typeof raw === 'string') {
    try {
      const parsed = normalizePermissions(JSON.parse(raw));
      if (parsed.length > 0) return parsed;
    } catch {
      // ignore and fall back to role defaults
    }
  }
  return getDefaultPermissions(role);
}

function parseJsonDetails(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapUserRow(row: Record<string, unknown>): User {
  const role = parseUserRole(row.role);
  const status = parseUserStatus(row.status);
  return {
    id: String(row.id),
    username: String(row.username),
    password_hash: String(row.password_hash),
    display_name: String(row.display_name ?? ''),
    role,
    status,
    permissions: parsePermissionsFromDb(row.permissions, role),
    must_change_password: !!row.must_change_password,
    disable_reason:
      typeof row.disable_reason === 'string' ? row.disable_reason : null,
    notes: typeof row.notes === 'string' ? row.notes : null,
    avatar_emoji:
      typeof row.avatar_emoji === 'string' ? row.avatar_emoji : null,
    avatar_color:
      typeof row.avatar_color === 'string' ? row.avatar_color : null,
    ai_name:
      typeof row.ai_name === 'string' ? row.ai_name : null,
    ai_avatar_emoji:
      typeof row.ai_avatar_emoji === 'string' ? row.ai_avatar_emoji : null,
    ai_avatar_color:
      typeof row.ai_avatar_color === 'string' ? row.ai_avatar_color : null,
    ai_avatar_url:
      typeof row.ai_avatar_url === 'string' ? row.ai_avatar_url : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_login_at:
      typeof row.last_login_at === 'string' ? row.last_login_at : null,
    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  };
}

function toUserPublic(user: User, lastActiveAt: string | null): UserPublic {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    must_change_password: user.must_change_password,
    disable_reason: user.disable_reason,
    notes: user.notes,
    avatar_emoji: user.avatar_emoji,
    avatar_color: user.avatar_color,
    ai_name: user.ai_name,
    ai_avatar_emoji: user.ai_avatar_emoji,
    ai_avatar_color: user.ai_avatar_color,
    ai_avatar_url: user.ai_avatar_url,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    last_active_at: lastActiveAt,
    deleted_at: user.deleted_at,
  };
}

// --- Users ---

export interface CreateUserInput {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  permissions?: Permission[];
  must_change_password?: boolean;
  disable_reason?: string | null;
  notes?: string | null;
  last_login_at?: string | null;
  deleted_at?: string | null;
}

export function createUser(user: CreateUserInput): void {
  const permissions = normalizePermissions(
    user.permissions ?? getDefaultPermissions(user.role),
  );
  db.prepare(
    `INSERT INTO users (
      id, username, password_hash, display_name, role, status, permissions, must_change_password,
      disable_reason, notes, created_at, updated_at, last_login_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    user.id,
    user.username,
    user.password_hash,
    user.display_name,
    user.role,
    user.status,
    JSON.stringify(permissions),
    user.must_change_password ? 1 : 0,
    user.disable_reason ?? null,
    user.notes ?? null,
    user.created_at,
    user.updated_at,
    user.last_login_at ?? null,
    user.deleted_at ?? null,
  );
}

export type CreateInitialAdminResult =
  | { ok: true }
  | { ok: false; reason: 'already_initialized' | 'username_taken' };

export function createInitialAdminUser(
  user: CreateUserInput,
): CreateInitialAdminResult {
  const tx = db.transaction((input: CreateUserInput): CreateInitialAdminResult => {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as {
      count: number;
    };
    if (row.count > 0) return { ok: false, reason: 'already_initialized' };
    createUser(input);
    return { ok: true };
  });

  try {
    return tx(user);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed: users.username')
    ) {
      return { ok: false, reason: 'username_taken' };
    }
    throw err;
  }
}

export function getUserById(id: string): User | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUserRow(row) : undefined;
}

export function getUserByUsername(username: string): User | undefined {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as Record<string, unknown> | undefined;
  return row ? mapUserRow(row) : undefined;
}

export interface ListUsersOptions {
  query?: string;
  role?: UserRole | 'all';
  status?: UserStatus | 'all';
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  users: UserPublic[];
  total: number;
  page: number;
  pageSize: number;
}

export function listUsers(options: ListUsersOptions = {}): ListUsersResult {
  const role = options.role && options.role !== 'all' ? options.role : null;
  const status =
    options.status && options.status !== 'all' ? options.status : null;
  const query = options.query?.trim() || '';
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.min(
    200,
    Math.max(1, Math.floor(options.pageSize || 50)),
  );
  const offset = (page - 1) * pageSize;

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (role) {
    whereParts.push('u.role = ?');
    params.push(role);
  }
  if (status) {
    whereParts.push('u.status = ?');
    params.push(status);
  }
  if (query) {
    whereParts.push(
      "(u.username LIKE ? OR u.display_name LIKE ? OR COALESCE(u.notes, '') LIKE ?)",
    );
    const like = `%${query}%`;
    params.push(like, like, like);
  }

  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM users u ${whereClause}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `
      SELECT u.*, MAX(s.last_active_at) AS last_active_at
      FROM users u
      LEFT JOIN user_sessions s ON s.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY
        CASE u.status
          WHEN 'active' THEN 0
          WHEN 'disabled' THEN 1
          ELSE 2
        END,
        u.created_at DESC
      LIMIT ? OFFSET ?
      `,
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  return {
    users: rows.map((row) => {
      const user = mapUserRow(row);
      const lastActiveAt =
        typeof row.last_active_at === 'string' ? row.last_active_at : null;
      return toUserPublic(user, lastActiveAt);
    }),
    total: totalRow.count,
    page,
    pageSize,
  };
}

export function getAllUsers(): UserPublic[] {
  return listUsers({ role: 'all', status: 'all', page: 1, pageSize: 1000 })
    .users;
}

export function getUserCount(includeDeleted = false): number {
  const row = includeDeleted
    ? (db.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      })
    : (db
        .prepare('SELECT COUNT(*) as count FROM users WHERE status != ?')
        .get('deleted') as { count: number });
  return row.count;
}

export function getActiveAdminCount(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM users
       WHERE role = 'admin' AND status = 'active'`,
    )
    .get() as { count: number };
  return row.count;
}

export function updateUserFields(
  id: string,
  updates: Partial<
    Pick<
      User,
      | 'username'
      | 'display_name'
      | 'role'
      | 'status'
      | 'password_hash'
      | 'last_login_at'
      | 'permissions'
      | 'must_change_password'
      | 'disable_reason'
      | 'notes'
      | 'avatar_emoji'
      | 'avatar_color'
      | 'ai_name'
      | 'ai_avatar_emoji'
      | 'ai_avatar_color'
      | 'ai_avatar_url'
      | 'deleted_at'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.username !== undefined) {
    fields.push('username = ?');
    values.push(updates.username);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.password_hash !== undefined) {
    fields.push('password_hash = ?');
    values.push(updates.password_hash);
  }
  if (updates.last_login_at !== undefined) {
    fields.push('last_login_at = ?');
    values.push(updates.last_login_at);
  }
  if (updates.permissions !== undefined) {
    fields.push('permissions = ?');
    values.push(JSON.stringify(normalizePermissions(updates.permissions)));
  }
  if (updates.must_change_password !== undefined) {
    fields.push('must_change_password = ?');
    values.push(updates.must_change_password ? 1 : 0);
  }
  if (updates.disable_reason !== undefined) {
    fields.push('disable_reason = ?');
    values.push(updates.disable_reason);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }
  if (updates.avatar_emoji !== undefined) {
    fields.push('avatar_emoji = ?');
    values.push(updates.avatar_emoji);
  }
  if (updates.avatar_color !== undefined) {
    fields.push('avatar_color = ?');
    values.push(updates.avatar_color);
  }
  if (updates.ai_name !== undefined) {
    fields.push('ai_name = ?');
    values.push(updates.ai_name);
  }
  if (updates.ai_avatar_emoji !== undefined) {
    fields.push('ai_avatar_emoji = ?');
    values.push(updates.ai_avatar_emoji);
  }
  if (updates.ai_avatar_color !== undefined) {
    fields.push('ai_avatar_color = ?');
    values.push(updates.ai_avatar_color);
  }
  if (updates.ai_avatar_url !== undefined) {
    fields.push('ai_avatar_url = ?');
    values.push(updates.ai_avatar_url);
  }
  if (updates.deleted_at !== undefined) {
    fields.push('deleted_at = ?');
    values.push(updates.deleted_at);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

export function deleteUser(id: string): void {
  const now = new Date().toISOString();
  const tx = db.transaction((userId: string) => {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
    db.prepare(
      `UPDATE users
       SET status = 'deleted', deleted_at = ?, disable_reason = COALESCE(disable_reason, 'deleted_by_admin'), updated_at = ?
       WHERE id = ?`,
    ).run(now, now, userId);
  });
  tx(id);
}

export function restoreUser(id: string): void {
  db.prepare(
    `UPDATE users
     SET status = 'disabled', deleted_at = NULL, disable_reason = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), id);
}

// --- User Sessions ---

export function createUserSession(session: UserSession): void {
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.user_id,
    session.ip_address,
    session.user_agent,
    session.created_at,
    session.expires_at,
    session.last_active_at,
  );
}

export function getSessionWithUser(
  sessionId: string,
): UserSessionWithUser | undefined {
  const row = db
    .prepare(
      `SELECT s.*, u.username, u.role, u.status, u.display_name, u.permissions, u.must_change_password
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const role = parseUserRole(row.role);
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
    last_active_at: String(row.last_active_at),
    username: String(row.username),
    role,
    status: parseUserStatus(row.status),
    display_name: String(row.display_name ?? ''),
    permissions: parsePermissionsFromDb(row.permissions, role),
    must_change_password: !!row.must_change_password,
  };
}

export function getUserSessions(userId: string): UserSession[] {
  return db
    .prepare(
      `SELECT * FROM user_sessions WHERE user_id = ? ORDER BY last_active_at DESC`,
    )
    .all(userId) as UserSession[];
}

export function deleteUserSession(sessionId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE id = ?').run(sessionId);
}

export function deleteUserSessionsByUserId(userId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

export function updateSessionLastActive(sessionId: string): void {
  db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    sessionId,
  );
}

export function deleteExpiredSessions(): number {
  const now = new Date().toISOString();
  const result = db
    .prepare('DELETE FROM user_sessions WHERE expires_at < ?')
    .run(now);
  return result.changes;
}

// --- Invite Codes ---

export function createInviteCode(invite: InviteCode): void {
  const permissions = normalizePermissions(invite.permissions);
  db.prepare(
    `INSERT INTO invite_codes (code, created_by, role, permission_template, permissions, max_uses, used_count, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    invite.code,
    invite.created_by,
    invite.role,
    invite.permission_template ?? null,
    JSON.stringify(permissions),
    invite.max_uses,
    invite.used_count,
    invite.expires_at,
    invite.created_at,
  );
}

export function getInviteCode(code: string): InviteCode | undefined {
  const row = db
    .prepare('SELECT * FROM invite_codes WHERE code = ?')
    .get(code) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const role = parseUserRole(row.role);
  return {
    code: String(row.code),
    created_by: String(row.created_by),
    role,
    permission_template:
      typeof row.permission_template === 'string'
        ? (row.permission_template as PermissionTemplateKey)
        : null,
    permissions: parsePermissionsFromDb(row.permissions, role),
    max_uses: Number(row.max_uses),
    used_count: Number(row.used_count),
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    created_at: String(row.created_at),
  };
}

export type RegisterUserWithInviteResult =
  | { ok: true; role: UserRole; permissions: Permission[] }
  | {
      ok: false;
      reason:
        | 'invalid_or_expired_invite'
        | 'invite_exhausted'
        | 'username_taken';
    };

export function registerUserWithInvite(input: {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}): RegisterUserWithInviteResult {
  const tx = db.transaction(
    (params: typeof input): RegisterUserWithInviteResult => {
      const inviteRow = db
        .prepare(
          `SELECT code, role, permissions, max_uses, expires_at
         FROM invite_codes
         WHERE code = ?`,
        )
        .get(params.invite_code) as Record<string, unknown> | undefined;

      if (!inviteRow) return { ok: false, reason: 'invalid_or_expired_invite' };
      const inviteRole = parseUserRole(inviteRow.role);
      const invitePermissions = parsePermissionsFromDb(
        inviteRow.permissions,
        inviteRole,
      );
      const inviteExpiresAt =
        typeof inviteRow.expires_at === 'string' ? inviteRow.expires_at : null;

      if (inviteExpiresAt) {
        const expiresAt = Date.parse(inviteExpiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
          return { ok: false, reason: 'invalid_or_expired_invite' };
        }
      }

      const existing = db
        .prepare('SELECT id FROM users WHERE username = ?')
        .get(params.username) as { id: string } | undefined;
      if (existing) return { ok: false, reason: 'username_taken' };

      const inviteUsage = db
        .prepare(
          `UPDATE invite_codes
         SET used_count = used_count + 1
         WHERE code = ?
           AND (max_uses = 0 OR used_count < max_uses)`,
        )
        .run(params.invite_code);
      if (inviteUsage.changes === 0) {
        return { ok: false, reason: 'invite_exhausted' };
      }

      const permissions = normalizePermissions(invitePermissions);
      db.prepare(
        `INSERT INTO users (
        id, username, password_hash, display_name, role, status, permissions, must_change_password,
        disable_reason, notes, created_at, updated_at, last_login_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        params.id,
        params.username,
        params.password_hash,
        params.display_name,
        inviteRole,
        'active',
        JSON.stringify(permissions),
        0,
        null,
        null,
        params.created_at,
        params.updated_at,
        null,
        null,
      );

      return { ok: true, role: inviteRole, permissions };
    },
  );

  try {
    return tx(input);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed: users.username')
    ) {
      return { ok: false, reason: 'username_taken' };
    }
    throw err;
  }
}

export type RegisterUserWithoutInviteResult =
  | { ok: true; role: UserRole; permissions: Permission[] }
  | { ok: false; reason: 'username_taken' };

export function registerUserWithoutInvite(input: {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}): RegisterUserWithoutInviteResult {
  const role: UserRole = 'member';
  const permissions: Permission[] = [];

  try {
    db.prepare(
      `INSERT INTO users (
        id, username, password_hash, display_name, role, status, permissions, must_change_password,
        disable_reason, notes, created_at, updated_at, last_login_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.username,
      input.password_hash,
      input.display_name,
      role,
      'active',
      JSON.stringify(permissions),
      0,
      null,
      null,
      input.created_at,
      input.updated_at,
      null,
      null,
    );
    return { ok: true, role, permissions };
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed: users.username')
    ) {
      return { ok: false, reason: 'username_taken' };
    }
    throw err;
  }
}

export function getAllInviteCodes(): InviteCodeWithCreator[] {
  const rows = db
    .prepare(
      `SELECT i.*, u.username as creator_username
       FROM invite_codes i
       JOIN users u ON i.created_by = u.id
       ORDER BY i.created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const role = parseUserRole(row.role);
    return {
      code: String(row.code),
      created_by: String(row.created_by),
      creator_username: String(row.creator_username),
      role,
      permission_template:
        typeof row.permission_template === 'string'
          ? (row.permission_template as PermissionTemplateKey)
          : null,
      permissions: parsePermissionsFromDb(row.permissions, role),
      max_uses: Number(row.max_uses),
      used_count: Number(row.used_count),
      expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
      created_at: String(row.created_at),
    };
  });
}

export function deleteInviteCode(code: string): void {
  db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code);
}

// --- Auth Audit Log ---

export function logAuthEvent(event: {
  event_type: AuthEventType;
  username: string;
  actor_username?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown> | null;
}): void {
  db.prepare(
    `INSERT INTO auth_audit_log (event_type, username, actor_username, ip_address, user_agent, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.event_type,
    event.username,
    event.actor_username ?? null,
    event.ip_address ?? null,
    event.user_agent ?? null,
    event.details ? JSON.stringify(event.details) : null,
    new Date().toISOString(),
  );
}

export interface AuthAuditLogQuery {
  limit?: number;
  offset?: number;
  event_type?: AuthEventType | 'all';
  username?: string;
  actor_username?: string;
  from?: string;
  to?: string;
}

export interface AuthAuditLogPage {
  logs: AuthAuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export function queryAuthAuditLogs(
  query: AuthAuditLogQuery = {},
): AuthAuditLogPage {
  const limit = Math.min(500, Math.max(1, Math.floor(query.limit || 100)));
  const offset = Math.max(0, Math.floor(query.offset || 0));

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (query.event_type && query.event_type !== 'all') {
    whereParts.push('event_type = ?');
    params.push(query.event_type);
  }
  if (query.username?.trim()) {
    whereParts.push('username LIKE ?');
    params.push(`%${query.username.trim()}%`);
  }
  if (query.actor_username?.trim()) {
    whereParts.push('actor_username LIKE ?');
    params.push(`%${query.actor_username.trim()}%`);
  }
  if (query.from) {
    whereParts.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    whereParts.push('created_at <= ?');
    params.push(query.to);
  }
  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM auth_audit_log ${whereClause}`)
      .get(...params) as {
      count: number;
    }
  ).count;

  const rows = db
    .prepare(
      `SELECT * FROM auth_audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const logs = rows.map((row) => ({
    id: Number(row.id),
    event_type: row.event_type as AuthEventType,
    username: String(row.username),
    actor_username:
      typeof row.actor_username === 'string' ? row.actor_username : null,
    ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
    user_agent: typeof row.user_agent === 'string' ? row.user_agent : null,
    details: parseJsonDetails(row.details),
    created_at: String(row.created_at),
  }));

  return { logs, total, limit, offset };
}

export function getAuthAuditLogs(limit = 100, offset = 0): AuthAuditLog[] {
  return queryAuthAuditLogs({ limit, offset }).logs;
}

export function checkLoginRateLimitFromAudit(
  username: string,
  ip: string,
  maxAttempts: number,
  lockoutMinutes: number,
): { allowed: boolean; retryAfterSeconds?: number; attempts: number } {
  if (maxAttempts <= 0) return { allowed: true, attempts: 0 };
  const windowStart = new Date(
    Date.now() - lockoutMinutes * 60 * 1000,
  ).toISOString();
  const rows = db
    .prepare(
      `
      SELECT created_at
      FROM auth_audit_log
      WHERE event_type = 'login_failed'
        AND username = ?
        AND ip_address = ?
        AND created_at >= ?
        AND (details IS NULL OR details NOT LIKE '%"reason":"rate_limited"%')
      ORDER BY created_at ASC
      `,
    )
    .all(username, ip, windowStart) as Array<{ created_at: string }>;

  const attempts = rows.length;
  if (attempts < maxAttempts) return { allowed: true, attempts };

  const oldest = rows[0]?.created_at;
  const oldestTs = oldest ? Date.parse(oldest) : Date.now();
  const retryAt = oldestTs + lockoutMinutes * 60 * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((retryAt - Date.now()) / 1000),
  );
  return { allowed: false, retryAfterSeconds, attempts };
}

// ===================== Group Members =====================

export function addGroupMember(
  groupFolder: string,
  userId: string,
  role: 'owner' | 'member',
  addedBy?: string,
): void {
  db.prepare(
    `INSERT INTO group_members (group_folder, user_id, role, added_at, added_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_folder, user_id) DO UPDATE SET
       role = CASE WHEN excluded.role = 'owner' THEN 'owner'
                   WHEN group_members.role = 'owner' THEN 'owner'
                   ELSE excluded.role END,
       added_by = COALESCE(excluded.added_by, group_members.added_by)`,
  ).run(groupFolder, userId, role, new Date().toISOString(), addedBy ?? null);
}

export function removeGroupMember(
  groupFolder: string,
  userId: string,
): void {
  db.prepare(
    'DELETE FROM group_members WHERE group_folder = ? AND user_id = ?',
  ).run(groupFolder, userId);
}

export function getGroupMembers(groupFolder: string): GroupMember[] {
  const rows = db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.added_at, gm.added_by,
              u.username, COALESCE(u.display_name, '') as display_name
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_folder = ?
       ORDER BY gm.role DESC, gm.added_at ASC`,
    )
    .all(groupFolder) as Array<{
    user_id: string;
    role: string;
    added_at: string;
    added_by: string | null;
    username: string;
    display_name: string;
  }>;
  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role as 'owner' | 'member',
    added_at: r.added_at,
    added_by: r.added_by ?? undefined,
    username: r.username,
    display_name: r.display_name,
  }));
}

export function getGroupMemberRole(
  groupFolder: string,
  userId: string,
): 'owner' | 'member' | null {
  const row = db
    .prepare(
      'SELECT role FROM group_members WHERE group_folder = ? AND user_id = ?',
    )
    .get(groupFolder, userId) as { role: string } | undefined;
  if (!row) return null;
  return row.role as 'owner' | 'member';
}

export function getUserMemberFolders(
  userId: string,
): Array<{ group_folder: string; role: 'owner' | 'member' }> {
  const rows = db
    .prepare(
      'SELECT group_folder, role FROM group_members WHERE user_id = ?',
    )
    .all(userId) as Array<{ group_folder: string; role: string }>;
  return rows.map((r) => ({
    group_folder: r.group_folder,
    role: r.role as 'owner' | 'member',
  }));
}

// ===================== Sub-Agent CRUD =====================

export function createAgent(agent: SubAgent): void {
  db.prepare(
    `INSERT INTO agents (id, group_folder, chat_jid, name, prompt, status, kind, created_by, created_at, completed_at, result_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    agent.group_folder,
    agent.chat_jid,
    agent.name,
    agent.prompt,
    agent.status,
    agent.kind || 'task',
    agent.created_by ?? null,
    agent.created_at,
    agent.completed_at ?? null,
    agent.result_summary ?? null,
  );
}

export function getAgent(id: string): SubAgent | undefined {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapAgentRow(row);
}

export function listAgentsByFolder(folder: string): SubAgent[] {
  const rows = db
    .prepare('SELECT * FROM agents WHERE group_folder = ? ORDER BY created_at DESC')
    .all(folder) as Array<Record<string, unknown>>;
  return rows.map(mapAgentRow);
}

export function listAgentsByJid(chatJid: string): SubAgent[] {
  const rows = db
    .prepare('SELECT * FROM agents WHERE chat_jid = ? ORDER BY created_at DESC')
    .all(chatJid) as Array<Record<string, unknown>>;
  return rows.map(mapAgentRow);
}

export function updateAgentStatus(
  id: string,
  status: AgentStatus,
  resultSummary?: string,
): void {
  const completedAt = (status !== 'running' && status !== 'idle') ? new Date().toISOString() : null;
  db.prepare(
    'UPDATE agents SET status = ?, completed_at = ?, result_summary = ? WHERE id = ?',
  ).run(status, completedAt, resultSummary ?? null, id);
}

export function updateAgentInfo(id: string, name: string, prompt: string): void {
  db.prepare('UPDATE agents SET name = ?, prompt = ? WHERE id = ?').run(name, prompt, id);
}

export function deleteCompletedTaskAgents(beforeTimestamp: string): number {
  const result = db.prepare(
    "DELETE FROM agents WHERE kind = 'task' AND status IN ('completed', 'error') AND completed_at IS NOT NULL AND completed_at < ?",
  ).run(beforeTimestamp);
  return result.changes;
}

export function markRunningTaskAgentsAsError(chatJid: string): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    "UPDATE agents SET status = 'error', completed_at = ? WHERE chat_jid = ? AND kind = 'task' AND status = 'running'",
  ).run(now, chatJid);
  return result.changes;
}

export function markAllRunningTaskAgentsAsError(summary = '进程重启，任务中断'): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    "UPDATE agents SET status = 'error', completed_at = ?, result_summary = COALESCE(result_summary, ?) WHERE kind = 'task' AND status = 'running'",
  ).run(now, summary);
  return result.changes;
}

export function deleteAgent(id: string): void {
  // Delete associated session
  db.prepare("DELETE FROM sessions WHERE agent_id = ?").run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

function mapAgentRow(row: Record<string, unknown>): SubAgent {
  return {
    id: String(row.id),
    group_folder: String(row.group_folder),
    chat_jid: String(row.chat_jid),
    name: String(row.name),
    prompt: String(row.prompt),
    status: (row.status as AgentStatus) || 'running',
    kind: (row.kind as AgentKind) || 'task',
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at),
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : null,
    result_summary: typeof row.result_summary === 'string' ? row.result_summary : null,
  };
}

export function deleteMessagesForChatJid(chatJid: string): void {
  db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
  db.prepare('DELETE FROM chats WHERE jid = ?').run(chatJid);
}

export function isGroupShared(groupFolder: string): boolean {
  const row = db
    .prepare(
      'SELECT COUNT(*) as cnt FROM group_members WHERE group_folder = ?',
    )
    .get(groupFolder) as { cnt: number };
  return row.cnt > 1;
}

/**
 * Close the database connection.
 * Should be called during graceful shutdown.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
