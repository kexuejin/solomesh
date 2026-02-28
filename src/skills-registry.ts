import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const SKILL_ID_RE = /^[\w-]+$/;

function listEnabledSkillIdsFromRoot(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillId = entry.name;
      if (!SKILL_ID_RE.test(skillId)) continue;
      const skillMdPath = path.join(rootDir, skillId, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;
      ids.push(skillId);
    }
    return ids;
  } catch {
    return [];
  }
}

export function getProjectSkillsDir(): string {
  return path.resolve(process.cwd(), 'container', 'skills');
}

export function getUserSkillsDir(userId: string): string {
  return path.join(DATA_DIR, 'skills', userId);
}

export function listProjectSkillIds(): string[] {
  return listEnabledSkillIdsFromRoot(getProjectSkillsDir());
}

export function listUserSkillIds(userId: string): string[] {
  return listEnabledSkillIdsFromRoot(getUserSkillsDir(userId));
}

export interface WorkflowSkillDependencyCheckOptions {
  scope: 'global' | 'user';
  ownerUserId?: string | null;
}

export interface WorkflowSkillDependencyCheckResult {
  invalidSkillRefs: string[];
  missingSkillRefs: string[];
  availableSkillRefs: string[];
}

export function checkWorkflowSkillDependencies(
  skillRefs: string[],
  options: WorkflowSkillDependencyCheckOptions,
): WorkflowSkillDependencyCheckResult {
  const dedupedRefs: string[] = [];
  const seen = new Set<string>();
  for (const raw of skillRefs) {
    const ref = raw.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    dedupedRefs.push(ref);
  }

  const invalidSkillRefs = dedupedRefs.filter((ref) => !SKILL_ID_RE.test(ref));

  const projectSkills = new Set(listProjectSkillIds());
  const availableSkillRefs = new Set<string>(projectSkills);

  if (options.scope === 'user' && options.ownerUserId) {
    for (const userSkillId of listUserSkillIds(options.ownerUserId)) {
      availableSkillRefs.add(userSkillId);
    }
  }

  const missingSkillRefs = dedupedRefs.filter(
    (ref) => !invalidSkillRefs.includes(ref) && !availableSkillRefs.has(ref),
  );

  return {
    invalidSkillRefs,
    missingSkillRefs,
    availableSkillRefs: Array.from(availableSkillRefs).sort((a, b) => a.localeCompare(b)),
  };
}
