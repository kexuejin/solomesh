# Runtime / Model Glossary

This document defines the product terms used across API, UI, and docs.

## Layer 1: Agent Runtime

`Agent Runtime` is the execution engine used by the system for agent sessions.

Examples:
- `claude-code`
- `codex`
- `opencode`
- `gemini`

Responsibilities:
- tool execution loop
- session lifecycle
- streaming and task events
- runtime-level capabilities

Naming rule:
- Use `agentRuntime`
- Do not use `agentProvider` for this layer

## Layer 2: Model Provider

`Model Provider` is the model hosting/service vendor.

Examples:
- `anthropic`
- `openai`
- `google`
- `openrouter`

Responsibilities:
- model API endpoint/account
- billing and quota
- authentication and region policy

Naming rule:
- Use `modelProvider`
- Do not use generic `provider` alone in runtime selection flows

## Layer 3: Model

`Model` is the concrete model id used for one request/session.

Examples:
- `claude-sonnet-4-5`
- `gpt-5`
- `gemini-2.5-pro`

Naming rule:
- Use `model`

## Quick Mapping

- `@codex` in chat: switches `agentRuntime`
- "Use OpenRouter": sets `modelProvider`
- "Use gpt-5": sets `model`

## Naming Do / Don't

Do:
- `agentRuntime`
- `modelProvider`
- `model`

Don't:
- `provider` (ambiguous)
- `agentProvider` (legacy name for runtime)
