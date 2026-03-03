# SoloMesh UI Rebrand Prompts (2026-02-28)

## Global Visual Tokens

- Brand direction: Modern Enterprise, Calm Ops, Reliable
- Theme: Light-first, high legibility, no dark mode
- Typography: Manrope (headings), IBM Plex Sans (body)
- Canvas background: `#F5F7FB`
- Surface background: `#FFFFFF`
- Primary action: `#0F6BFF`
- Secondary accent: `#0EA5A4`
- Text primary: `#0F172A`
- Text secondary: `#475569`
- Border: `#D9E2EC`
- Semantic: success `#16A34A`, warning `#D97706`, error `#DC2626`
- Radius: cards `14px`, inputs/buttons `10px`
- Shadow: `0 8px 24px rgba(15, 23, 42, 0.08)`
- Components: clean left navigation, layered cards, dense but readable data tables, clear status chips

## Shared Prompt Prefix

Use this prefix for every screen:

`Design a production-ready SoloMesh interface in a modern enterprise visual style. Keep information architecture realistic for an AI runtime orchestration product. Use the exact visual tokens provided above. The layout should feel distinct from upstream project.`

## Screen Prompts

### 1) setup-wizard (desktop)

`[Shared Prefix] Create a desktop first-run wizard for administrator onboarding. Include a 4-step progress header, organization profile form, security policy toggles, and a right-side context panel explaining runtime/provider impacts. Add inline validation states and clear next-step CTA hierarchy.`

### 2) setup-providers (desktop)

`[Shared Prefix] Create a provider setup console with runtime selector (Claude Code / Codex), provider cards, API key connection forms, model capability matrix, test-connection panel, and status timeline for verification. Keep form density high but readable.`

### 3) chat-tool-tracking (desktop)

`[Shared Prefix] Create a split chat workspace: left conversation list, center threaded messages, right tool execution tracking panel with expandable steps, latency badges, and logs. Show user query, assistant response, and two tool call records with success state.`

### 4) chat-markdown (desktop)

`[Shared Prefix] Create a desktop chat page optimized for long markdown responses. Include heading hierarchy, code blocks, tables, callout cards, and copy actions. Maintain sticky compose bar and compact session list.`

### 5) chat-image-gen (desktop)

`[Shared Prefix] Create a desktop chat + image generation page. Show prompt input, generation progress cards, output gallery (2x2), metadata chips (model, size, seed), and an action bar for regenerate, upscale, and export.`

### 6) feishu-chat (desktop)

`[Shared Prefix] Create a Feishu-style chat integration monitor page for SoloMesh. Include channel list, message stream, command parsing badges, and runtime execution status chips. Keep style enterprise and consistent with SoloMesh tokens.`

### 7) feishu-card-reply (desktop)

`[Shared Prefix] Create a card-reply design preview page for IM interactions. Include template selector, live card preview, variable placeholders, approval actions, and send result logs. Emphasize structured card blocks and readable controls.`

### 8) settings-runtime (desktop, new capability)

`[Shared Prefix] Create a runtime settings page showing runtime abstraction (Claude Code / Codex), provider-aware capabilities, model routing rules, and read-only skills/MCP status tables. Include warning banners for incompatible combinations.`

### 9) workflow-template-editor (desktop, new capability)

`[Shared Prefix] Create a workflow template editor with left template list, center stage graph (draft-friendly visual), right dependency precheck panel, and bottom execution policy settings. Include save versioning and validation summary.`

### 10) im-session-binding (desktop, new capability)

`[Shared Prefix] Create an IM session binding page with account binding matrix, multi-channel merge policy settings, fallback rules, and dry-run simulation results. Show merge strategy badges and conflict warning states.`

### 11) mobile-login (mobile)

`[Shared Prefix] Create a mobile login screen with workspace selector, SSO options, passcode input, and trust-device checkbox. Keep spacing compact and thumb-friendly.`

### 12) mobile-groups (mobile)

`[Shared Prefix] Create a mobile groups/workspaces list with search, pinned groups, unread counters, and quick switch action. Include bottom navigation with Chat, Monitor, Settings.`

### 13) mobile-monitor (mobile)

`[Shared Prefix] Create a mobile monitoring dashboard with runtime health cards, queue depth mini chart, recent failures list, and quick action buttons. Prioritize glanceable status hierarchy.`

### 14) mobile-settings (mobile)

`[Shared Prefix] Create a mobile settings page for profile, notifications, runtime preferences, and security. Include grouped list sections, toggles, and a destructive logout section.`
