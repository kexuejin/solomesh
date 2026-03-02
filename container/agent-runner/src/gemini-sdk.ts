import { resolveGeminiApiKey } from './gemini-auth.js';
import { shorten } from './utils.js';

export interface GeminiImageInput {
  data: string;
  mimeType?: string;
}

export interface GeminiSdkClientOptions {
  apiKey: string;
  httpOptions?: {
    baseUrl: string;
  };
}

export interface GeminiSdkContentPartText {
  text: string;
}

export interface GeminiSdkContentPartInlineData {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiSdkContent {
  role: 'user';
  parts: Array<GeminiSdkContentPartText | GeminiSdkContentPartInlineData>;
}

export interface GeminiSdkChatConfig {
  tools?: unknown[];
  automaticFunctionCalling?: {
    disable: boolean;
    maximumRemoteCalls: number;
  };
  thinkingConfig?: {
    includeThoughts?: boolean;
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
    thinkingBudget?: number;
  };
}

export interface GeminiSdkChatCreateParams {
  model: string;
  config?: GeminiSdkChatConfig;
}

export interface GeminiSdkChunkDeltaState {
  fullText: string;
  fullThinking: string;
}

export interface GeminiSdkChunkDeltas extends GeminiSdkChunkDeltaState {
  textDelta: string;
  thinkingDelta: string;
}

export interface GeminiSdkToolStreamState {
  nextSyntheticToolSeq: number;
  toolUseIdByCallId: Record<string, string>;
  openToolUseIds: string[];
  openToolUseIdByName: Record<string, string>;
  lastToolProgressByToolUseId: Record<string, string>;
}

export interface GeminiSdkToolStreamEvent {
  eventType: 'tool_use_start' | 'tool_progress' | 'tool_use_end';
  toolUseId: string;
  parentToolUseId?: string | null;
  isNested?: boolean;
  toolName?: string;
  toolInputSummary?: string;
  text?: string;
}

export interface GeminiSdkChunkToolEventsResult {
  events: GeminiSdkToolStreamEvent[];
  state: GeminiSdkToolStreamState;
}

export type GeminiOperationPermissionMode = 'default' | 'bypass';
export type GeminiReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
const DEFAULT_MAX_REMOTE_CALLS = 8;
const BYPASS_MAX_REMOTE_CALLS = 20;

function buildGeminiThinkingConfig(
  reasoningEffort?: GeminiReasoningEffort,
): GeminiSdkChatConfig['thinkingConfig'] | undefined {
  if (!reasoningEffort) return undefined;

  if (reasoningEffort === 'xhigh') {
    // Gemini currently tops out at HIGH thinking level; xhigh maps to HIGH + auto budget.
    return {
      includeThoughts: true,
      thinkingLevel: 'high',
      thinkingBudget: -1,
    };
  }

  return {
    includeThoughts: true,
    thinkingLevel: reasoningEffort,
  };
}

export function buildGeminiSdkClientOptions(
  env: Record<string, string | undefined>,
): GeminiSdkClientOptions {
  const apiKey = resolveGeminiApiKey(env);
  const baseUrl = env.GOOGLE_GEMINI_BASE_URL?.trim() || '';
  if (baseUrl) {
    return {
      apiKey,
      httpOptions: { baseUrl },
    };
  }
  return { apiKey };
}

export function buildGeminiSdkContents(
  promptWithMemory: string,
  images?: GeminiImageInput[],
): GeminiSdkContent[] {
  const parts: GeminiSdkContent['parts'] = [{ text: promptWithMemory }];
  for (const image of images || []) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType || 'image/png',
        data: image.data,
      },
    });
  }
  return [{ role: 'user', parts }];
}

export function buildGeminiSdkChatCreateParams(
  model: string,
  mcpClients: unknown[],
  mcpToTool: (...args: unknown[]) => unknown,
  operationPermissionMode: GeminiOperationPermissionMode = 'default',
  reasoningEffort?: GeminiReasoningEffort,
): GeminiSdkChatCreateParams {
  const thinkingConfig = buildGeminiThinkingConfig(reasoningEffort);

  if (!mcpClients.length) {
    return thinkingConfig
      ? { model, config: { thinkingConfig } }
      : { model };
  }

  const config: GeminiSdkChatConfig = {
    tools: [mcpToTool(...mcpClients)],
    automaticFunctionCalling: {
      disable: false,
      maximumRemoteCalls:
        operationPermissionMode === 'bypass'
          ? BYPASS_MAX_REMOTE_CALLS
          : DEFAULT_MAX_REMOTE_CALLS,
    },
  };
  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  return {
    model,
    config,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function getRecordField(
  record: Record<string, unknown> | null,
  field: string,
): Record<string, unknown> | null {
  return asRecord(record?.[field]);
}

function getStringField(
  record: Record<string, unknown> | null,
  field: string,
): string {
  const value = record?.[field];
  return typeof value === 'string' ? value : '';
}

function extractGeminiChunkCandidateParts(chunk: unknown): Record<string, unknown>[] {
  const chunkRecord = asRecord(chunk);
  const candidates = chunkRecord?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const firstCandidate = asRecord(candidates[0]);
  const content = asRecord(firstCandidate?.content);
  const parts = content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => !!part);
}

function joinPartTextByThoughtFlag(
  parts: Record<string, unknown>[],
  thought: boolean,
): string {
  let merged = '';
  for (const part of parts) {
    const text = typeof part.text === 'string' ? part.text : '';
    if (!text) continue;
    if ((part.thought === true) !== thought) continue;
    merged += text;
  }
  return merged;
}

function applyCumulativeDelta(previous: string, next: string): string {
  if (!next || next === previous) return '';
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint'
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

const GEMINI_TOOL_PROGRESS_MAX_CHARS = 1200;

function sanitizeToolNameSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeGeminiToolName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return 'mcp_tool';
  if (trimmed.startsWith('mcp__')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\s/.test(trimmed)) return trimmed;

  const separators = ['/', ':', '.'];
  for (const separator of separators) {
    if (!trimmed.includes(separator)) continue;
    const parts = trimmed
      .split(separator)
      .map((part) => sanitizeToolNameSegment(part))
      .filter((part) => !!part);
    if (parts.length >= 2) {
      return `mcp__${parts.join('__')}`;
    }
  }

  return trimmed;
}

function extractFunctionCallPart(
  part: Record<string, unknown>,
): { id: string; name: string; argsText: string } | null {
  const functionCall =
    getRecordField(part, 'functionCall') || getRecordField(part, 'function_call');
  if (!functionCall) return null;

  const id =
    getStringField(functionCall, 'id')
    || getStringField(functionCall, 'call_id');
  const name = normalizeGeminiToolName(getStringField(functionCall, 'name') || 'mcp_tool');
  const argsValue =
    functionCall.args !== undefined
      ? functionCall.args
      : functionCall.arguments;
  const argsText = stringifyUnknown(argsValue);
  return { id, name, argsText };
}

function extractFunctionResponsePart(
  part: Record<string, unknown>,
): { id: string; name: string; responseText: string } | null {
  const functionResponse =
    getRecordField(part, 'functionResponse') || getRecordField(part, 'function_response');
  if (!functionResponse) return null;

  const id =
    getStringField(functionResponse, 'id')
    || getStringField(functionResponse, 'call_id');
  const rawName = getStringField(functionResponse, 'name');
  const name = rawName ? normalizeGeminiToolName(rawName) : '';
  const response = asRecord(functionResponse.response);
  let responseText =
    getStringField(response, 'output')
    || getStringField(response, 'error');
  if (!responseText) {
    responseText = stringifyUnknown(functionResponse.response);
  }
  return { id, name, responseText };
}

function withStateCopy(
  state: GeminiSdkToolStreamState,
): GeminiSdkToolStreamState {
  return {
    nextSyntheticToolSeq: state.nextSyntheticToolSeq,
    toolUseIdByCallId: { ...state.toolUseIdByCallId },
    openToolUseIds: [...state.openToolUseIds],
    openToolUseIdByName: { ...state.openToolUseIdByName },
    lastToolProgressByToolUseId: { ...state.lastToolProgressByToolUseId },
  };
}

function isToolOpen(
  state: GeminiSdkToolStreamState,
  toolUseId: string,
): boolean {
  return state.openToolUseIds.includes(toolUseId);
}

function resolveToolUseId(
  state: GeminiSdkToolStreamState,
  callId: string,
  name: string,
): string {
  if (callId && state.toolUseIdByCallId[callId]) {
    return state.toolUseIdByCallId[callId];
  }
  if (!callId && name && state.openToolUseIdByName[name]) {
    return state.openToolUseIdByName[name];
  }
  if (callId) {
    state.toolUseIdByCallId[callId] = callId;
    return callId;
  }
  const generated = `gemini-fn-${state.nextSyntheticToolSeq}`;
  state.nextSyntheticToolSeq += 1;
  return generated;
}

function closeToolUse(
  state: GeminiSdkToolStreamState,
  toolUseId: string,
): void {
  state.openToolUseIds = state.openToolUseIds.filter((id) => id !== toolUseId);
  for (const [name, mappedToolUseId] of Object.entries(state.openToolUseIdByName)) {
    if (mappedToolUseId === toolUseId) {
      delete state.openToolUseIdByName[name];
    }
  }
  delete state.lastToolProgressByToolUseId[toolUseId];
}

export function createGeminiSdkToolStreamState(): GeminiSdkToolStreamState {
  return {
    nextSyntheticToolSeq: 1,
    toolUseIdByCallId: {},
    openToolUseIds: [],
    openToolUseIdByName: {},
    lastToolProgressByToolUseId: {},
  };
}

function resolveToolProgressDelta(
  state: GeminiSdkToolStreamState,
  toolUseId: string,
  nextText: string,
): string {
  if (!nextText) return '';
  const previous = state.lastToolProgressByToolUseId[toolUseId] || '';
  const rawDelta = applyCumulativeDelta(previous, nextText);
  if (!rawDelta) return '';
  state.lastToolProgressByToolUseId[toolUseId] = nextText;
  return shorten(rawDelta, GEMINI_TOOL_PROGRESS_MAX_CHARS);
}

export function extractGeminiSdkChunkToolEvents(
  chunk: unknown,
  previous: GeminiSdkToolStreamState,
): GeminiSdkChunkToolEventsResult {
  const state = withStateCopy(previous);
  const events: GeminiSdkToolStreamEvent[] = [];
  const parts = extractGeminiChunkCandidateParts(chunk);

  for (const part of parts) {
    const call = extractFunctionCallPart(part);
    if (call) {
      const toolUseId = resolveToolUseId(state, call.id, call.name);
      if (call.id) state.toolUseIdByCallId[call.id] = toolUseId;
      if (call.name) state.openToolUseIdByName[call.name] = toolUseId;
      const openedNow = !isToolOpen(state, toolUseId);

      if (openedNow) {
        state.openToolUseIds.push(toolUseId);
        events.push({
          eventType: 'tool_use_start',
          toolUseId,
          parentToolUseId: null,
          isNested: false,
          toolName: call.name,
          toolInputSummary: call.argsText ? shorten(call.argsText, 240) : undefined,
        });
      }

      // Initial function_call input is already surfaced in tool_use_start.toolInputSummary;
      // only stream incremental updates for subsequent call deltas.
      if (openedNow) {
        state.lastToolProgressByToolUseId[toolUseId] = call.argsText;
      } else {
        const callProgress = resolveToolProgressDelta(state, toolUseId, call.argsText);
        if (callProgress) {
          events.push({
            eventType: 'tool_progress',
            toolUseId,
            parentToolUseId: null,
            isNested: false,
            text: callProgress,
          });
        }
      }
      continue;
    }

    const response = extractFunctionResponsePart(part);
    if (!response) continue;

    const toolUseId = resolveToolUseId(state, response.id, response.name);
    if (response.id) state.toolUseIdByCallId[response.id] = toolUseId;
    if (response.name) state.openToolUseIdByName[response.name] = toolUseId;

    if (!isToolOpen(state, toolUseId)) {
      state.openToolUseIds.push(toolUseId);
      events.push({
        eventType: 'tool_use_start',
        toolUseId,
        parentToolUseId: null,
        isNested: false,
        toolName: response.name || 'mcp_tool',
      });
    }

    const responseProgress = resolveToolProgressDelta(
      state,
      toolUseId,
      response.responseText,
    );
    if (responseProgress) {
      events.push({
        eventType: 'tool_progress',
        toolUseId,
        parentToolUseId: null,
        isNested: false,
        text: responseProgress,
      });
    }
    events.push({
      eventType: 'tool_use_end',
      toolUseId,
      parentToolUseId: null,
      isNested: false,
    });
    closeToolUse(state, toolUseId);
  }

  return { events, state };
}

export function extractGeminiSdkChunkDeltas(
  chunk: unknown,
  previous: GeminiSdkChunkDeltaState,
): GeminiSdkChunkDeltas {
  const chunkRecord = asRecord(chunk);
  const chunkText = typeof chunkRecord?.text === 'string' ? chunkRecord.text : '';
  const parts = extractGeminiChunkCandidateParts(chunk);
  const visibleText = joinPartTextByThoughtFlag(parts, false);
  const thoughtText = joinPartTextByThoughtFlag(parts, true);

  const nextFullTextCandidate = chunkText || visibleText;
  const fullText = nextFullTextCandidate || previous.fullText;
  const fullThinking = thoughtText || previous.fullThinking;

  return {
    fullText,
    fullThinking,
    textDelta: applyCumulativeDelta(previous.fullText, fullText),
    thinkingDelta: applyCumulativeDelta(previous.fullThinking, fullThinking),
  };
}
