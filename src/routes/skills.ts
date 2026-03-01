// Skills management routes

import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Variables } from '../web-context.js';
import type { AuthUser } from '../types.js';
import { authMiddleware } from '../middleware/auth.js';
import { DATA_DIR } from '../config.js';
import {
  AGENT_PROVIDER_IDS,
  type AgentProvider,
  normalizeAgentProvider,
} from '../agent-providers.js';
import {
  buildSkillsInstallArgs,
  getGlobalSkillsDirForProvider,
} from '../skills-provider.js';
import { getProviderRuntime } from '../provider-runtime.js';
import { parseSkillsSearchOutput } from '../skills-search-parser.js';

const execFileAsync = promisify(execFile);
let skillInstallLock: Promise<void> = Promise.resolve();

const skillsRoutes = new Hono<{ Variables: Variables }>();

// --- Types ---

interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'project';
  enabled: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
}

interface SkillDetail extends Skill {
  content: string;
}

// --- Utility Functions ---

function getUserSkillsDir(userId: string): string {
  return path.join(DATA_DIR, 'skills', userId);
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return (
    typeof value === 'string'
    && (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

async function resolveInstallProvider(requested?: unknown): Promise<AgentProvider> {
  if (isAgentProvider(requested)) return normalizeAgentProvider(requested);
  try {
    const runtimeConfig = await import('../runtime-config.js');
    const normalized = normalizeAgentProvider(runtimeConfig.getRuntimeProviderConfig().agentRuntime);
    return getProviderRuntime(normalized).supportsSkillsInstall
      ? normalized
      : 'claude';
  } catch {
    return 'claude';
  }
}

function getProjectSkillsDir(): string {
  return path.resolve(process.cwd(), 'container', 'skills');
}

function validateSkillId(id: string): boolean {
  return /^[\w\-]+$/.test(id);
}

function validateSkillPath(skillsRoot: string, skillDir: string): boolean {
  try {
    const realSkillsRoot = fs.realpathSync(skillsRoot);
    const realSkillDir = fs.realpathSync(skillDir);
    const relative = path.relative(realSkillsRoot, realSkillDir);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};

  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex === -1) return {};

  const frontmatterLines = lines.slice(1, endIndex + 1);
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let multilineMode: 'folded' | 'literal' | null = null;

  for (const line of frontmatterLines) {
    const keyMatch = line.match(/^([\w\-]+):\s*(.*)$/);
    if (keyMatch) {
      // Save previous key if exists
      if (currentKey) {
        result[currentKey] = currentValue.join(
          multilineMode === 'literal' ? '\n' : ' ',
        );
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      if (value === '>') {
        multilineMode = 'folded';
        currentValue = [];
      } else if (value === '|') {
        multilineMode = 'literal';
        currentValue = [];
      } else {
        result[currentKey] = value;
        currentKey = null;
        currentValue = [];
        multilineMode = null;
      }
    } else if (currentKey && multilineMode) {
      const trimmedLine = line.trimStart();
      if (trimmedLine) {
        currentValue.push(trimmedLine);
      }
    }
  }

  // Save last key
  if (currentKey) {
    result[currentKey] = currentValue.join(
      multilineMode === 'literal' ? '\n' : ' ',
    );
  }

  return result;
}

function listFiles(
  dir: string,
): Array<{ name: string; type: 'file' | 'directory'; size: number }> {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        const stats = fs.statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isDirectory() ? 0 : stats.size,
        };
      });
  } catch {
    return [];
  }
}

function scanDirectory(
  rootDir: string,
  source: 'user' | 'project',
): Skill[] {
  const skills: Skill[] = [];
  if (!fs.existsSync(rootDir)) return skills;

  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(rootDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const skillMdDisabledPath = path.join(skillDir, 'SKILL.md.disabled');

      let enabled = false;
      let skillFilePath: string | null = null;

      if (fs.existsSync(skillMdPath)) {
        enabled = true;
        skillFilePath = skillMdPath;
      } else if (fs.existsSync(skillMdDisabledPath)) {
        enabled = false;
        skillFilePath = skillMdDisabledPath;
      } else {
        continue;
      }

      try {
        const content = fs.readFileSync(skillFilePath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const stats = fs.statSync(skillDir);

        skills.push({
          id: entry.name,
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          source,
          enabled,
          userInvocable:
            frontmatter['user-invocable'] === undefined
              ? true
              : frontmatter['user-invocable'] !== 'false',
          allowedTools: frontmatter['allowed-tools']
            ? frontmatter['allowed-tools'].split(',').map((t) => t.trim())
            : [],
          argumentHint: frontmatter['argument-hint'] || null,
          updatedAt: stats.mtime.toISOString(),
          files: listFiles(skillDir),
        });
      } catch {
        // Skip malformed skills
      }
    }
  } catch {
    // Skip if directory is not readable
  }

  return skills;
}

function discoverSkills(userId: string): Skill[] {
  const userDir = getUserSkillsDir(userId);
  const projectDir = getProjectSkillsDir();

  const userSkills = scanDirectory(userDir, 'user');
  const projectSkills = scanDirectory(projectDir, 'project');

  return [...userSkills, ...projectSkills];
}

function getSkillDetail(skillId: string, userId: string): SkillDetail | null {
  if (!validateSkillId(skillId)) return null;

  const userDir = getUserSkillsDir(userId);
  const projectDir = getProjectSkillsDir();

  for (const { rootDir, source } of [
    { rootDir: userDir, source: 'user' as const },
    { rootDir: projectDir, source: 'project' as const },
  ]) {
    const skillDir = path.join(rootDir, skillId);
    if (!fs.existsSync(skillDir)) continue;

    if (!validateSkillPath(rootDir, skillDir)) continue;

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const skillMdDisabledPath = path.join(skillDir, 'SKILL.md.disabled');

    let enabled = false;
    let skillFilePath: string | null = null;

    if (fs.existsSync(skillMdPath)) {
      enabled = true;
      skillFilePath = skillMdPath;
    } else if (fs.existsSync(skillMdDisabledPath)) {
      enabled = false;
      skillFilePath = skillMdDisabledPath;
    } else {
      continue;
    }

    try {
      const content = fs.readFileSync(skillFilePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      const stats = fs.statSync(skillDir);

      return {
        id: skillId,
        name: frontmatter.name || skillId,
        description: frontmatter.description || '',
        source,
        enabled,
        userInvocable:
          frontmatter['user-invocable'] === undefined
            ? true
            : frontmatter['user-invocable'] !== 'false',
        allowedTools: frontmatter['allowed-tools']
          ? frontmatter['allowed-tools'].split(',').map((t) => t.trim())
          : [],
        argumentHint: frontmatter['argument-hint'] || null,
        updatedAt: stats.mtime.toISOString(),
        files: listFiles(skillDir),
        content,
      };
    } catch {
      // Skip malformed skill
    }
  }

  return null;
}

/**
 * Find skill entries under a path that were modified after the given timestamp.
 * Handles both real directories and symlinks (skills CLI creates symlinks in
 * ~/.claude/skills/ pointing to ~/.agents/skills/).
 * Returns entry names.
 */
function findModifiedEntries(dir: string, afterMs: number): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        // Use lstat for symlinks, stat (follows symlink) for mtime of real target
        const lstat = fs.lstatSync(fullPath);

        if (lstat.isSymbolicLink()) {
          // Symlink: check both the symlink creation time and target mtime
          if (lstat.mtimeMs >= afterMs) {
            result.push(entry.name);
            continue;
          }
          // Also check the resolved target's mtime
          const realStat = fs.statSync(fullPath);
          if (realStat.mtimeMs >= afterMs) {
            result.push(entry.name);
          }
        } else if (lstat.isDirectory()) {
          if (lstat.mtimeMs >= afterMs) {
            result.push(entry.name);
          }
        }
      } catch {
        // skip broken symlinks etc.
      }
    }
  } catch {
    // ignore
  }
  return result;
}

/**
 * Copy a skill entry (directory or symlink target) to dest.
 * Resolves symlinks and copies the real content so the copy is self-contained.
 */
function copySkillToUser(src: string, dest: string): void {
  // Resolve symlink to get the real directory
  let realSrc = src;
  try {
    const lstat = fs.lstatSync(src);
    if (lstat.isSymbolicLink()) {
      realSrc = fs.realpathSync(src);
    }
  } catch {
    // use src as-is
  }

  fs.cpSync(realSrc, dest, { recursive: true });
}

function listSyncableSkillEntries(dir: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(dir)) return result;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        const realPath = fs.realpathSync(fullPath);
        const hasSkillFile =
          fs.existsSync(path.join(realPath, 'SKILL.md'))
          || fs.existsSync(path.join(realPath, 'SKILL.md.disabled'));
        if (hasSkillFile) result.push(entry.name);
      } catch {
        // skip broken symlink
      }
    }
  } catch {
    // ignore unreadable dir
  }

  return result;
}

async function withSkillInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = skillInstallLock.catch(() => undefined);
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  skillInstallLock = previous.then(() => current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// --- Routes ---

skillsRoutes.get('/', authMiddleware, (c) => {
  const authUser = c.get('user') as AuthUser;
  const skills = discoverSkills(authUser.id);
  return c.json({ skills });
});

skillsRoutes.get('/search', authMiddleware, async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) {
    return c.json({ results: [] });
  }

  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['-y', 'skills', 'find', query],
      { timeout: 30_000 },
    );
    const results = parseSkillsSearchOutput(stdout);
    return c.json({ results });
  } catch (error) {
    // npx skills find may exit non-zero when no results found
    if (error && typeof error === 'object' && 'stdout' in error) {
      const results = parseSkillsSearchOutput((error as any).stdout || '');
      if (results.length > 0) {
        return c.json({ results });
      }
    }
    return c.json({ results: [] });
  }
});

skillsRoutes.get('/search/detail', authMiddleware, async (c) => {
  const url = c.req.query('url')?.trim();
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'skills.sh' || parsed.protocol !== 'https:') {
      return c.json({ error: 'Invalid skills.sh URL' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid skills.sh URL' }, 400);
  }

  try {
    const resp = await fetch(url!, {
      headers: { 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return c.json({ detail: null });
    }
    const html = await resp.text();

    // 从页面 <h1> 提取 skill 标题作为描述
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const description = h1Match?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x26;/g, '&')
      .trim() || '';

    return c.json({
      detail: {
        description,
        installs: '',
        age: '',
        features: [],
      },
    });
  } catch {
    return c.json({ detail: null });
  }
});

skillsRoutes.get('/:id', authMiddleware, (c) => {
  const id = c.req.param('id');
  const authUser = c.get('user') as AuthUser;
  const skill = getSkillDetail(id, authUser.id);

  if (!skill) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  return c.json({ skill });
});

// Skills are read-only: host-level and project-level skills
// cannot be modified through the Web UI.
skillsRoutes.patch('/:id', authMiddleware, (c) => {
  return c.json({ error: 'Skills are read-only and cannot be toggled from the Web UI' }, 403);
});

/**
 * Delete a user-level skill by ID.
 * Reusable by both the HTTP route and IPC handler.
 */
function deleteSkillForUser(
  userId: string,
  skillId: string,
): { success: boolean; error?: string } {
  if (!validateSkillId(skillId)) {
    return { success: false, error: 'Invalid skill ID' };
  }

  const userDir = getUserSkillsDir(userId);
  const skillDir = path.join(userDir, skillId);

  if (!fs.existsSync(skillDir)) {
    return { success: false, error: 'Skill not found or is a project-level skill' };
  }

  if (!validateSkillPath(userDir, skillDir)) {
    return { success: false, error: 'Invalid skill path' };
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

skillsRoutes.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const authUser = c.get('user') as AuthUser;
  const result = deleteSkillForUser(authUser.id, id);

  if (!result.success) {
    const status = result.error === 'Invalid skill ID' || result.error === 'Invalid skill path' ? 400
      : result.error?.includes('not found') ? 404 : 500;
    return c.json({ error: result.error }, status);
  }

  return c.json({ success: true });
});

// Sync host-level skills to admin's user-level directory.
skillsRoutes.post('/sync-host', authMiddleware, async (c) => {
  const authUser = c.get('user') as AuthUser;
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can sync host skills' }, 403);
  }

  return withSkillInstallLock(async () => {
    const provider = await resolveInstallProvider();
    const hostDir = getGlobalSkillsDirForProvider(provider);
    const userDir = getUserSkillsDir(authUser.id);
    fs.mkdirSync(userDir, { recursive: true });

    const hostSkillNames = listSyncableSkillEntries(hostDir);
    const stats = { added: 0, updated: 0, deleted: 0, skipped: 0 };

    for (const name of hostSkillNames) {
      const src = path.join(hostDir, name);
      const dest = path.join(userDir, name);
      try {
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
          stats.updated++;
        } else {
          stats.added++;
        }
        copySkillToUser(src, dest);
      } catch {
        stats.skipped++;
      }
    }

    return c.json({ stats, total: hostSkillNames.length });
  });
});

/**
 * Install a skill package for a specific user.
 * Reusable by both the HTTP route and IPC handler.
 */
async function installSkillForUser(
  userId: string,
  pkg: string,
  provider?: AgentProvider,
): Promise<{ success: boolean; installed?: string[]; error?: string }> {
  if (!/^[\w\-]+\/[\w\-.]+(?:[@#][\w\-.\/]+)?$/.test(pkg)) {
    return { success: false, error: 'Invalid package name format' };
  }
  const installProvider = provider || (await resolveInstallProvider());
  if (!getProviderRuntime(installProvider).supportsSkillsInstall) {
    return {
      success: false,
      error: `${installProvider} runtime does not support skills install`,
    };
  }

  return withSkillInstallLock(async () => {
    const globalDir = getGlobalSkillsDirForProvider(installProvider);
    fs.mkdirSync(globalDir, { recursive: true });

    // 记录安装前时间戳，用于检测新增/修改的目录（减 1s 避免文件系统时间精度问题）
    const beforeTime = Date.now() - 1000;

    try {
      await execFileAsync(
        'npx',
        buildSkillsInstallArgs(pkg, installProvider),
        { timeout: 60_000 },
      );

      // Find entries modified during install (handles symlinks and real dirs)
      const modifiedEntries = findModifiedEntries(globalDir, beforeTime);

      // Copy resolved skill content to per-user directory
      const userDir = getUserSkillsDir(userId);
      fs.mkdirSync(userDir, { recursive: true });

      for (const name of modifiedEntries) {
        const src = path.join(globalDir, name);
        const dest = path.join(userDir, name);
        // Remove existing if present (reinstall)
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        copySkillToUser(src, dest);
      }

      return { success: true, installed: modifiedEntries };
    } catch (error) {
      // Even on error, clean up any modified entries from global
      try {
        const modifiedEntries = findModifiedEntries(globalDir, beforeTime);
        for (const name of modifiedEntries) {
          fs.rmSync(path.join(globalDir, name), { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}

skillsRoutes.post(
  '/install',
  authMiddleware,
  async (c) => {
    const authUser = c.get('user') as AuthUser;
    const body = await c.req.json().catch(() => ({}));

    if (typeof body.package !== 'string') {
      return c.json({ error: 'package field must be string' }, 400);
    }
    if (body.agentRuntime !== undefined && !isAgentProvider(body.agentRuntime)) {
      return c.json({ error: 'agentRuntime must be "claude", "codex", or "gemini"' }, 400);
    }

    const pkg = body.package.trim();
    const provider = await resolveInstallProvider(body.agentRuntime);
    if (!getProviderRuntime(provider).supportsSkillsInstall) {
      return c.json(
        { error: `${provider} runtime does not support skills install` },
        400,
      );
    }
    const result = await installSkillForUser(authUser.id, pkg, provider);

    if (!result.success) {
      return c.json(
        { error: 'Failed to install skill', details: result.error },
        result.error === 'Invalid package name format' ? 400 : 500,
      );
    }

    return c.json({ success: true, installed: result.installed });
  },
);

export {
  getUserSkillsDir,
  installSkillForUser,
  deleteSkillForUser,
  buildSkillsInstallArgs,
  getGlobalSkillsDirForProvider,
};
export default skillsRoutes;
