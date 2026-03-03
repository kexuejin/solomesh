import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeminiSdkToolStreamState,
  extractGeminiSdkChunkToolEvents,
  extractGeminiSdkChunkDeltas,
  buildGeminiSdkChatCreateParams,
  buildGeminiSdkClientOptions,
  buildGeminiSdkContents,
} from '../container/agent-runner/src/gemini-sdk.ts';

test('buildGeminiSdkClientOptions prefers GEMINI_API_KEY and keeps custom base URL', () => {
  const options = buildGeminiSdkClientOptions({
    GEMINI_API_KEY: 'gm-primary',
    GOOGLE_API_KEY: 'gm-fallback',
    GOOGLE_GEMINI_BASE_URL: 'https://proxy.example.com/gemini',
  });

  assert.equal(options.apiKey, 'gm-primary');
  assert.deepEqual(options.httpOptions, {
    baseUrl: 'https://proxy.example.com/gemini',
  });
});

test('buildGeminiSdkClientOptions falls back to GOOGLE_API_KEY and omits blank base URL', () => {
  const options = buildGeminiSdkClientOptions({
    GEMINI_API_KEY: '   ',
    GOOGLE_API_KEY: 'gm-fallback',
    GOOGLE_GEMINI_BASE_URL: '   ',
  });

  assert.equal(options.apiKey, 'gm-fallback');
  assert.equal('httpOptions' in options, false);
});

test('buildGeminiSdkContents builds text-only content when no images are provided', () => {
  assert.deepEqual(buildGeminiSdkContents('hello world', undefined), [
    {
      role: 'user',
      parts: [{ text: 'hello world' }],
    },
  ]);
});

test('buildGeminiSdkContents appends inline image parts', () => {
  assert.deepEqual(
    buildGeminiSdkContents('analyze', [
      { data: 'abc123', mimeType: 'image/jpeg' },
      { data: 'xyz999' },
    ]),
    [
      {
        role: 'user',
        parts: [
          { text: 'analyze' },
          { inlineData: { mimeType: 'image/jpeg', data: 'abc123' } },
          { inlineData: { mimeType: 'image/png', data: 'xyz999' } },
        ],
      },
    ],
  );
});

test('buildGeminiSdkChatCreateParams returns model-only payload when no MCP clients', () => {
  const params = buildGeminiSdkChatCreateParams('gemini-2.5-pro', [], () => 'unused');
  assert.deepEqual(params, { model: 'gemini-2.5-pro' });
});

test('buildGeminiSdkChatCreateParams wires tools and automaticFunctionCalling when MCP clients exist', () => {
  const clientA = { id: 'a' };
  const clientB = { id: 'b' };
  let capturedArgs: unknown[] | null = null;
  const mcpToTool = (...args: unknown[]) => {
    capturedArgs = args;
    return { kind: 'mcp-tool' };
  };

  const params = buildGeminiSdkChatCreateParams(
    'gemini-2.5-pro',
    [clientA, clientB],
    mcpToTool,
  );

  assert.deepEqual(capturedArgs, [clientA, clientB]);
  assert.deepEqual(params, {
    model: 'gemini-2.5-pro',
    config: {
      tools: [{ kind: 'mcp-tool' }],
      automaticFunctionCalling: {
        disable: false,
        maximumRemoteCalls: 8,
      },
    },
  });
});

test('buildGeminiSdkChatCreateParams increases tool-call budget in bypass mode', () => {
  const params = buildGeminiSdkChatCreateParams(
    'gemini-2.5-pro',
    [{ id: 'a' }],
    () => ({ kind: 'mcp-tool' }),
    'bypass',
  );

  assert.deepEqual(params, {
    model: 'gemini-2.5-pro',
    config: {
      tools: [{ kind: 'mcp-tool' }],
      automaticFunctionCalling: {
        disable: false,
        maximumRemoteCalls: 20,
      },
    },
  });
});

test('buildGeminiSdkChatCreateParams skips thinking config for models without thinking-level support', () => {
  const params = buildGeminiSdkChatCreateParams(
    'gemini-2.0-flash',
    [],
    () => ({ kind: 'mcp-tool' }),
    'default',
    'high',
  );

  assert.deepEqual(params, { model: 'gemini-2.0-flash' });
});

test('extractGeminiSdkChunkDeltas extracts text delta from chunk.text cumulative stream', () => {
  const first = extractGeminiSdkChunkDeltas(
    { text: 'Hello' },
    { fullText: '', fullThinking: '' },
  );
  assert.equal(first.textDelta, 'Hello');
  assert.equal(first.fullText, 'Hello');
  assert.equal(first.thinkingDelta, '');
  assert.equal(first.fullThinking, '');

  const second = extractGeminiSdkChunkDeltas(
    { text: 'Hello world' },
    { fullText: first.fullText, fullThinking: first.fullThinking },
  );
  assert.equal(second.textDelta, ' world');
  assert.equal(second.fullText, 'Hello world');
  assert.equal(second.thinkingDelta, '');
  assert.equal(second.fullThinking, '');
});

test('extractGeminiSdkChunkDeltas extracts thinking delta from thought parts', () => {
  const first = extractGeminiSdkChunkDeltas(
    {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'Reason A' },
              { thought: false, text: 'Visible A' },
            ],
          },
        },
      ],
    },
    { fullText: '', fullThinking: '' },
  );
  assert.equal(first.textDelta, 'Visible A');
  assert.equal(first.fullText, 'Visible A');
  assert.equal(first.thinkingDelta, 'Reason A');
  assert.equal(first.fullThinking, 'Reason A');

  const second = extractGeminiSdkChunkDeltas(
    {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'Reason AB' },
              { thought: false, text: 'Visible AB' },
            ],
          },
        },
      ],
    },
    { fullText: first.fullText, fullThinking: first.fullThinking },
  );
  assert.equal(second.textDelta, 'B');
  assert.equal(second.fullText, 'Visible AB');
  assert.equal(second.thinkingDelta, 'B');
  assert.equal(second.fullThinking, 'Reason AB');
});

test('extractGeminiSdkChunkToolEvents emits start for function call and progress/end for function response', () => {
  let state = createGeminiSdkToolStreamState();

  const first = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call-1',
                  name: 'mcp__solomesh__search',
                  args: { query: 'alpha' },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  state = first.state;
  assert.equal(first.events.length, 1);
  assert.deepEqual(first.events[0], {
    eventType: 'tool_use_start',
    toolUseId: 'call-1',
    parentToolUseId: null,
    isNested: false,
    toolName: 'mcp__solomesh__search',
    toolInputSummary: '{"query":"alpha"}',
  });

  const second = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionResponse: {
                  id: 'call-1',
                  name: 'mcp__solomesh__search',
                  response: { output: 'done' },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  state = second.state;
  assert.equal(second.events.length, 2);
  assert.deepEqual(second.events[0], {
    eventType: 'tool_progress',
    toolUseId: 'call-1',
    parentToolUseId: null,
    isNested: false,
    text: 'done',
  });
  assert.deepEqual(second.events[1], {
    eventType: 'tool_use_end',
    toolUseId: 'call-1',
    parentToolUseId: null,
    isNested: false,
  });
  assert.deepEqual(state.openToolUseIds, []);
});

test('extractGeminiSdkChunkToolEvents falls back to synthetic id when function call has no id', () => {
  let state = createGeminiSdkToolStreamState();

  const first = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'mcp__solomesh__search',
                  args: { query: 'beta' },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  state = first.state;
  assert.equal(first.events[0]?.eventType, 'tool_use_start');
  assert.ok(first.events[0]?.toolUseId);
  const syntheticToolUseId = first.events[0]?.toolUseId || '';
  assert.ok(syntheticToolUseId.startsWith('gemini-fn-'));
  assert.deepEqual(state.openToolUseIds, [syntheticToolUseId]);

  const second = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionResponse: {
                  name: 'mcp__solomesh__search',
                  response: { output: 'ok' },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  assert.deepEqual(second.events, [
    {
      eventType: 'tool_progress',
      toolUseId: syntheticToolUseId,
      parentToolUseId: null,
      isNested: false,
      text: 'ok',
    },
    {
      eventType: 'tool_use_end',
      toolUseId: syntheticToolUseId,
      parentToolUseId: null,
      isNested: false,
    },
  ]);
  assert.deepEqual(second.state.openToolUseIds, []);
});

test('extractGeminiSdkChunkToolEvents emits delta-only progress for cumulative function call args', () => {
  let state = createGeminiSdkToolStreamState();

  const first = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call-2',
                  name: 'mcp__solomesh__search',
                  args: 'alpha',
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  state = first.state;

  const second = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call-2',
                  name: 'mcp__solomesh__search',
                  args: 'alpha-beta',
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );

  assert.deepEqual(second.events, [
    {
      eventType: 'tool_progress',
      toolUseId: 'call-2',
      parentToolUseId: null,
      isNested: false,
      text: '-beta',
    },
  ]);
});

test('extractGeminiSdkChunkToolEvents truncates oversized tool_progress payloads', () => {
  let state = createGeminiSdkToolStreamState();

  const opened = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call-3',
                  name: 'mcp__solomesh__search',
                  args: { query: 'gamma' },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );
  state = opened.state;

  const oversizedOutput = 'X'.repeat(6000);
  const second = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionResponse: {
                  id: 'call-3',
                  name: 'mcp__solomesh__search',
                  response: { output: oversizedOutput },
                },
              },
            ],
          },
        },
      ],
    },
    state,
  );

  assert.equal(second.events[0]?.eventType, 'tool_progress');
  const progressText = second.events[0]?.text || '';
  assert.ok(progressText.length < oversizedOutput.length);
  assert.ok(progressText.endsWith('...'));
});

test('extractGeminiSdkChunkToolEvents normalizes mcp-like tool names for display consistency', () => {
  const first = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call-4',
                  name: 'solomesh/search_files',
                  args: { query: 'delta' },
                },
              },
            ],
          },
        },
      ],
    },
    createGeminiSdkToolStreamState(),
  );

  assert.deepEqual(first.events[0], {
    eventType: 'tool_use_start',
    toolUseId: 'call-4',
    parentToolUseId: null,
    isNested: false,
    toolName: 'mcp__solomesh__search_files',
    toolInputSummary: '{"query":"delta"}',
  });

  const second = extractGeminiSdkChunkToolEvents(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionResponse: {
                  id: 'call-5',
                  name: 'solomesh.search_files',
                  response: { output: 'ok' },
                },
              },
            ],
          },
        },
      ],
    },
    createGeminiSdkToolStreamState(),
  );

  assert.deepEqual(second.events[0], {
    eventType: 'tool_use_start',
    toolUseId: 'call-5',
    parentToolUseId: null,
    isNested: false,
    toolName: 'mcp__solomesh__search_files',
  });
});
