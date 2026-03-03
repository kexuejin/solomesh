import { randomUUID } from 'node:crypto';

import {
  findRecentPendingDecisionItemByFingerprint,
  getDecisionItemById,
  insertDecisionItem,
  updateDecisionItemDecision,
  updateDecisionItemPendingMerge,
  withTransaction,
} from './db.js';
import { ingestTodo, type TodoIngestResult } from './todo-core.js';
import type {
  DecisionItem,
  DecisionItemScopeLevel,
  TodoPriority,
  TodoSourceType,
  TodoTriggerMode,
} from './types.js';

const LINK_INSIGHT_SOURCE_ID_PREFIX = 'link-insight:';
const DECISION_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EVIDENCE_DEDUPE_FIELD = '__dedupe_fingerprint';

function normalizeText(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEvidenceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeInsightUrlForFingerprint(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    parsed.hash = '';
    const normalized = new URL(parsed.toString());
    const allowedParams = new URLSearchParams();
    for (const [key, paramValue] of normalized.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_')) continue;
      if (lowerKey === 'gclid' || lowerKey === 'fbclid') continue;
      allowedParams.append(lowerKey, paramValue);
    }
    normalized.search = allowedParams.toString();

    const pathname = normalized.pathname.replace(/\/+$|^$/g, '/');
    const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/g, '') : '/';
    return `${normalized.protocol}//${normalized.host.toLowerCase()}${normalizedPath}${normalized.search ? `?${normalized.searchParams.toString()}` : ''}`;
  } catch {
    return null;
  }
}

function buildDecisionDedupeFingerprint(
  input: DecisionItemIngestInput,
  scopeLevel: DecisionItemScopeLevel,
  scopeId: string | null,
): string | null {
  if (input.source_type !== 'manual') return null;
  if (!input.source_id.startsWith(LINK_INSIGHT_SOURCE_ID_PREFIX)) return null;

  const evidenceObject = parseEvidenceObject(input.evidence);
  const evidenceUrl =
    typeof evidenceObject?.url === 'string'
      ? evidenceObject.url
      : null;
  if (!evidenceUrl) return null;

  const normalizedUrl = normalizeInsightUrlForFingerprint(evidenceUrl);
  if (!normalizedUrl) return null;

  return [
    'link-insight',
    scopeLevel,
    scopeId ?? '-',
    input.source_type,
    input.source_id.trim(),
    normalizedUrl,
  ].join('|');
}

function withEvidenceFingerprint(
  evidence: unknown,
  fingerprint: string | null,
): unknown {
  if (!fingerprint) return evidence;

  const objectLike = parseEvidenceObject(evidence);
  if (objectLike) {
    return {
      ...objectLike,
      [EVIDENCE_DEDUPE_FIELD]: fingerprint,
    };
  }

  return {
    [EVIDENCE_DEDUPE_FIELD]: fingerprint,
    value: evidence ?? null,
  };
}

function serializeEvidenceValue(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function mapSourceToTriggerMode(sourceType: TodoSourceType): TodoTriggerMode {
  return sourceType === 'automation' ? 'automation' : 'manual';
}

export interface DecisionItemSuggestion {
  title?: string;
  description?: string;
  priority?: TodoPriority;
}

export interface DecisionItemIngestInput {
  title: string;
  summary?: string;
  scope_level?: DecisionItemScopeLevel;
  scope_id?: string;
  priority?: TodoPriority;
  source_type: TodoSourceType;
  source_id: string;
  source_run_id?: string;
  evidence?: unknown;
  suggested_todo?: DecisionItemSuggestion;
}

export interface DecisionItemIngestResult {
  decision_item_id: string;
  status: 'pending';
  result: 'created' | 'merged';
}

export interface DecisionItemAcceptOverrides {
  title?: string;
  description?: string;
  priority?: TodoPriority;
}

export type DecisionItemActionResult =
  | {
      ok: true;
      decision_item_id: string;
      status: 'accepted';
      todo: TodoIngestResult;
    }
  | {
      ok: true;
      decision_item_id: string;
      status: 'ignored';
    }
  | {
      ok: false;
      error: 'not_found' | 'already_decided';
      currentStatus?: 'accepted' | 'ignored';
    };

export function ingestDecisionItem(
  input: DecisionItemIngestInput,
  actor: string,
): DecisionItemIngestResult {
  const nowIso = new Date().toISOString();
  const itemId = randomUUID();
  const createdBy = actor.trim() || 'system';
  const requestedScopeId = normalizeText(input.scope_id);
  const scopeLevel =
    input.scope_level === 'workspace' && requestedScopeId
      ? 'workspace'
      : 'global';
  const scopeId = scopeLevel === 'workspace' ? requestedScopeId : null;

  const fingerprint = buildDecisionDedupeFingerprint(input, scopeLevel, scopeId);
  const evidencePayload = withEvidenceFingerprint(input.evidence, fingerprint);
  const serializedEvidence = serializeEvidenceValue(evidencePayload);

  const nextTitle = input.title.trim();
  const nextSummary = normalizeText(input.summary);
  const nextSourceRunId = normalizeText(input.source_run_id);
  const nextSuggestedTodoTitle = normalizeText(input.suggested_todo?.title);
  const nextSuggestedTodoDescription = normalizeText(input.suggested_todo?.description);
  const nextSuggestedTodoPriority = input.suggested_todo?.priority ?? null;

  if (fingerprint) {
    const sinceIso = new Date(Date.now() - DECISION_DEDUPE_WINDOW_MS).toISOString();
    const existing = findRecentPendingDecisionItemByFingerprint({
      source_type: input.source_type,
      source_id: input.source_id,
      scope_level: scopeLevel,
      scope_id: scopeId,
      fingerprint,
      since: sinceIso,
    });

    if (existing) {
      updateDecisionItemPendingMerge(existing.id, {
        title: nextTitle || existing.title,
        summary: nextSummary ?? existing.summary,
        priority: input.priority ?? existing.priority,
        source_run_id: nextSourceRunId ?? existing.source_run_id,
        evidence: serializedEvidence ?? existing.evidence,
        suggested_todo_title: nextSuggestedTodoTitle ?? existing.suggested_todo_title,
        suggested_todo_description:
          nextSuggestedTodoDescription ?? existing.suggested_todo_description,
        suggested_todo_priority: nextSuggestedTodoPriority ?? existing.suggested_todo_priority,
        updated_at: nowIso,
      });
      return {
        decision_item_id: existing.id,
        status: 'pending',
        result: 'merged',
      };
    }
  }

  const nextItem: DecisionItem = {
    id: itemId,
    title: nextTitle,
    summary: nextSummary,
    status: 'pending',
    scope_level: scopeLevel,
    scope_id: scopeId,
    priority: input.priority ?? null,
    source_type: input.source_type,
    source_id: input.source_id,
    source_run_id: nextSourceRunId,
    evidence: serializedEvidence,
    suggested_todo_title: nextSuggestedTodoTitle,
    suggested_todo_description: nextSuggestedTodoDescription,
    suggested_todo_priority: nextSuggestedTodoPriority,
    created_by: createdBy,
    created_at: nowIso,
    updated_at: nowIso,
    decided_at: null,
    decided_by: null,
    accepted_todo_id: null,
  };

  insertDecisionItem(nextItem);
  return {
    decision_item_id: itemId,
    status: 'pending',
    result: 'created',
  };
}

export function acceptDecisionItem(
  decisionItemId: string,
  actor: string,
  overrides?: DecisionItemAcceptOverrides,
): DecisionItemActionResult {
  return withTransaction(() => {
    const item = getDecisionItemById(decisionItemId);
    if (!item) {
      return { ok: false, error: 'not_found' };
    }
    if (item.status !== 'pending') {
      return {
        ok: false,
        error: 'already_decided',
        currentStatus: item.status,
      };
    }

    const todo = ingestTodo(
      {
        title:
          normalizeText(overrides?.title)
          ?? item.suggested_todo_title
          ?? item.title,
        description:
          normalizeText(overrides?.description)
          ?? item.suggested_todo_description
          ?? item.summary
          ?? undefined,
        priority:
          overrides?.priority
          ?? item.suggested_todo_priority
          ?? item.priority
          ?? undefined,
        source_type: item.source_type,
        source_id: item.source_id,
        source_run_id: item.source_run_id ?? undefined,
        trigger_mode: mapSourceToTriggerMode(item.source_type),
        evidence: {
          decision_item_id: item.id,
          decision_item_title: item.title,
          decision_item_summary: item.summary,
          decision_item_evidence: item.evidence,
        },
      },
      actor,
    );

    const nowIso = new Date().toISOString();
    updateDecisionItemDecision(item.id, {
      status: 'accepted',
      decided_at: nowIso,
      decided_by: actor,
      accepted_todo_id: todo.todo_id,
    });

    return {
      ok: true,
      decision_item_id: item.id,
      status: 'accepted' as const,
      todo,
    };
  });
}

export function ignoreDecisionItem(
  decisionItemId: string,
  actor: string,
): DecisionItemActionResult {
  return withTransaction(() => {
    const item = getDecisionItemById(decisionItemId);
    if (!item) {
      return { ok: false, error: 'not_found' };
    }
    if (item.status !== 'pending') {
      return {
        ok: false,
        error: 'already_decided',
        currentStatus: item.status,
      };
    }

    const nowIso = new Date().toISOString();
    updateDecisionItemDecision(item.id, {
      status: 'ignored',
      decided_at: nowIso,
      decided_by: actor,
      accepted_todo_id: null,
    });

    return {
      ok: true,
      decision_item_id: item.id,
      status: 'ignored' as const,
    };
  });
}
