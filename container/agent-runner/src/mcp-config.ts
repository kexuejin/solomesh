import fs from 'fs';
import path from 'path';

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface NormalizedMcpServer {
  id: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export type NormalizedMcpServers = Record<string, NormalizedMcpServer>;

const RESERVED_SERVER_ID = 'solomesh';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') return undefined;
    result[k] = v;
  }
  return result;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    out.push(item);
  }
  return out;
}

function resolveSettingsPath(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.HOME || '/home/node', '.claude');
  return path.join(configDir, 'settings.json');
}

/** Read raw MCP server config from Claude settings.json. */
export function loadRawUserMcpServers(): Record<string, unknown> {
  const settingsFile = resolveSettingsPath();

  try {
    if (!fs.existsSync(settingsFile)) return {};
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) as unknown;
    if (!isRecord(parsed)) return {};

    const rawServers = parsed.mcpServers;
    if (!isRecord(rawServers)) return {};

    return rawServers;
  } catch {
    return {};
  }
}

/** Normalize raw settings into provider-neutral structure. Invalid entries are dropped. */
export function normalizeUserMcpServers(
  raw: Record<string, unknown>,
): NormalizedMcpServers {
  const normalized: NormalizedMcpServers = {};

  for (const [id, candidate] of Object.entries(raw)) {
    if (!id || !isRecord(candidate)) continue;

    if (candidate.enabled === false) continue;

    const type = candidate.type;
    const isHttpLike = type === 'http' || type === 'sse';

    if (isHttpLike) {
      const url = candidate.url;
      if (typeof url !== 'string' || !url.trim()) continue;

      let headers: Record<string, string> | undefined;
      if (candidate.headers !== undefined) {
        headers = toStringMap(candidate.headers);
        if (!headers) continue;
      }

      normalized[id] = {
        id,
        transport: type,
        enabled: true,
        url,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      };
      continue;
    }

    const command = candidate.command;
    if (typeof command !== 'string' || !command.trim()) continue;

    let args: string[] | undefined;
    if (candidate.args !== undefined) {
      args = toStringArray(candidate.args);
      if (!args) continue;
    }

    let env: Record<string, string> | undefined;
    if (candidate.env !== undefined) {
      env = toStringMap(candidate.env);
      if (!env) continue;
    }

    normalized[id] = {
      id,
      transport: 'stdio',
      enabled: true,
      command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return normalized;
}

/** Build Claude SDK mcpServers object from normalized entries + built-in solomesh. */
export function buildClaudeMcpServers(
  normalized: NormalizedMcpServers,
  builtInSolomesh: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [id, server] of Object.entries(normalized)) {
    if (id === RESERVED_SERVER_ID) continue;

    if (server.transport === 'stdio') {
      const item: Record<string, unknown> = {
        command: server.command,
      };
      if (server.args && server.args.length > 0) item.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) item.env = server.env;
      out[id] = item;
      continue;
    }

    const item: Record<string, unknown> = {
      type: server.transport,
      url: server.url,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      item.headers = server.headers;
    }
    out[id] = item;
  }

  out[RESERVED_SERVER_ID] = builtInSolomesh;
  return out;
}

/** Build Codex config.mcp_servers object from normalized entries + built-in solomesh. */
export function buildCodexMcpServers(
  normalized: NormalizedMcpServers,
  builtInSolomesh: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [id, server] of Object.entries(normalized)) {
    if (id === RESERVED_SERVER_ID) continue;

    if (server.transport === 'stdio') {
      const item: Record<string, unknown> = {
        command: server.command,
        enabled: true,
      };
      if (server.args && server.args.length > 0) item.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) item.env = server.env;
      out[id] = item;
      continue;
    }

    const item: Record<string, unknown> = {
      url: server.url,
      enabled: true,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      item.http_headers = server.headers;
    }
    out[id] = item;
  }

  out[RESERVED_SERVER_ID] = builtInSolomesh;
  return out;
}

/** Build Gemini settings.mcpServers object from normalized entries + built-in solomesh. */
export function buildGeminiMcpServers(
  normalized: NormalizedMcpServers,
  builtInSolomesh: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [id, server] of Object.entries(normalized)) {
    if (id === RESERVED_SERVER_ID) continue;

    if (server.transport === 'stdio') {
      const item: Record<string, unknown> = {
        command: server.command,
      };
      if (server.args && server.args.length > 0) item.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) item.env = server.env;
      out[id] = item;
      continue;
    }

    const item: Record<string, unknown> = {
      type: server.transport,
      url: server.url,
    };
    if (server.headers && Object.keys(server.headers).length > 0) {
      item.headers = server.headers;
    }
    out[id] = item;
  }

  out[RESERVED_SERVER_ID] = builtInSolomesh;
  return out;
}
