# Workflow-Driven Todo Stitch Prompts (2026-03-01)

## Context

Based on:

- `docs/todo/workflow-driven-todo-requirements.md`
- `docs/todo/workflow-driven-todo-implementation.md`

Goal: visualize `workflow + automation + plugin(skill/mcp)` orchestration with a unified `todo ingest` core.

## Global Design System

- Product tone: modern enterprise, reliable operations, audit-friendly
- Theme: light-first, high legibility
- Canvas: `#F5F7FB`
- Surface: `#FFFFFF`
- Primary: `#0F6BFF`
- Accent: `#0EA5A4`
- Success: `#16A34A`
- Warning: `#D97706`
- Error: `#DC2626`
- Text primary: `#0F172A`
- Text secondary: `#475569`
- Border: `#D9E2EC`
- Radius: card `14px`, control `10px`
- Shadow: `0 8px 24px rgba(15, 23, 42, 0.08)`
- Font: Manrope headings + IBM Plex Sans body

## Shared Prompt Prefix

`Design a production-ready SoloMesh UI in a modern enterprise style, clearly distinct from upstream project. Keep information architecture practical and implementation-friendly. Use the exact design tokens listed above.`

## Target Screens

### 1) todo-ingest-console (desktop)

`[Shared Prefix] Create a desktop Todo Ingest Console page. Include an ingest request form, normalized payload preview, dedupe key panel, and ingest response card showing action: created|merged|ignored with todo_id and reason.`

### 2) todo-core-list (desktop)

`[Shared Prefix] Create a desktop Todo Core list page with filters (status, priority, source_type, trigger_mode), table columns (title, dedupe_key, occurrence_count, last_seen_at), and row badges for merged vs created.`

### 3) todo-detail-audit (desktop)

`[Shared Prefix] Create a desktop Todo detail page with left summary panel and right source event timeline. Timeline items show source_type, source_id, source_run_id, action, evidence excerpt, and timestamp.`

### 4) workflow-stage-editor-todo (desktop)

`[Shared Prefix] Create a workflow stage editor screen that configures Todo ingest and explicit failure handling. Include stage graph, step config form, field mapping to ingest payload, trigger_mode selector manual|automation, and an on_error rule section that can enable todo ingest for failure branches.`

### 5) automation-task-to-workflow (desktop)

`[Shared Prefix] Create an automation scheduler page that binds scheduled tasks to workflow templates. Include task list, cron/interval config, run history, and explicit rule builder (on_error -> ingest todo, score threshold -> ingest todo).`

### 6) plugin-output-to-todo (desktop)

`[Shared Prefix] Create a plugin (Skill/MCP) output review page where candidates are transformed into Todo ingest inputs. Include candidate cards, evidence viewer, confidence score, dedupe preview, source_id mapping (skill:<id> or mcp:<server>:<tool>), and batch ingest actions.`

### 7) chat-manual-todo-capture (desktop)

`[Shared Prefix] Create a chat workspace page with a side drawer for manual todo capture. Drawer contains title/priority/evidence/source fields and a submit action that calls Todo ingest.`

### 8) mobile-todo-inbox (mobile)

`[Shared Prefix] Create a mobile Todo inbox page with segmented filters, todo cards, merge occurrence badge, source chip, and a compact event timeline preview per item.`
