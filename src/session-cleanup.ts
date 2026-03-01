import path from 'node:path';

export interface SessionCleanupTarget {
  dir: string;
  preserve: Set<string>;
}

export function listSessionCleanupTargets(sessionRoot: string): string[] {
  return [
    path.join(sessionRoot, '.claude'),
    path.join(sessionRoot, '.codex'),
    path.join(sessionRoot, '.gemini'),
  ];
}

export function listSessionCleanupPlan(sessionRoot: string): SessionCleanupTarget[] {
  return [
    {
      dir: path.join(sessionRoot, '.claude'),
      preserve: new Set(['settings.json']),
    },
    {
      dir: path.join(sessionRoot, '.codex'),
      preserve: new Set<string>(),
    },
    {
      dir: path.join(sessionRoot, '.gemini'),
      preserve: new Set<string>(),
    },
  ];
}
