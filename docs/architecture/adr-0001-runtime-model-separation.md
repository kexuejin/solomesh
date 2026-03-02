# ADR-0001: Separate Agent Runtime, Model Provider, and Model

- Status: Accepted
- Date: 2026-02-28

## Context

The current codebase historically reused the word `provider` for multiple layers:

- runtime selection (`claude` / `codex`)
- model vendor selection (Anthropic/OpenAI/etc.)
- model id selection

This creates ambiguity in API contracts, UI labels, and workflow routing logic.

## Decision

We use a strict three-layer model:

1. `agentRuntime`: execution engine (`claude-code`, `codex`, `opencode`, `gemini`)
2. `modelProvider`: model service vendor (`anthropic`, `openai`, `google`, `openrouter`, ...)
3. `model`: concrete model id (`gpt-5`, `claude-sonnet-4-5`, ...)

Term `provider` alone is not allowed in new API contracts or new UI labels.

## Consequences

Positive:
- clear boundaries for adapter design
- lower onboarding cost for contributors
- simpler runtime switch semantics in chat/workflow

Negative:
- migration effort for old naming in API fields and docs
- temporary dual vocabulary during staged migration

## Alternatives Considered

### Alternative A: Keep generic `provider`

Rejected because it remains ambiguous and keeps coupling between runtime and model layers.

### Alternative B: Keep `agentProvider` as runtime name

Rejected because the name is semantically wrong and blocks future multi-model-per-runtime design.

## Follow-up

- Add strict schema for `agentRuntime`/`modelProvider`/`model`
- Replace ambiguous labels in settings and docs
- Add lint/check rule for banned terminology in new files
