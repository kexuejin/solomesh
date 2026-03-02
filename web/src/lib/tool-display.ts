function titleCaseSegment(segment: string): string {
  if (!segment) return segment;
  return segment[0].toUpperCase() + segment.slice(1);
}

function humanizeServerName(server: string): string {
  const parts = server
    .split(/[_-]+/g)
    .map((part) => part.trim())
    .filter((part) => !!part);
  if (parts.length === 0) return server;
  return parts.map((part) => titleCaseSegment(part)).join(' ');
}

export function formatToolDisplayName(
  toolName: string | null | undefined,
): string {
  const raw = (toolName || '').trim();
  if (!raw) return '';
  if (raw === 'Task' || raw === 'Skill') return raw;

  const match = /^mcp__([A-Za-z0-9_-]+)__(.+)$/.exec(raw);
  if (!match) return raw;

  const server = match[1];
  const tool = match[2];
  return `${humanizeServerName(server)} / ${tool}`;
}
