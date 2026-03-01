import type { MessageKey } from '../i18n';

export type WorkflowCommandType =
  | 'start'
  | 'accept'
  | 'cancel'
  | 'next'
  | 'exit'
  | 'status'
  | 'none';

const START_PREFIX_RE = /^\s*\/wf(?:\s+|$)(?<rest>[\s\S]*)$/i;
const COMMAND_PREFIX_RE =
  /^\s*\/wf-(?<cmd>accept|cancel|next|exit|status)(?:\s+|$)(?<rest>[\s\S]*)$/i;

export interface WorkflowDirectiveInputResult {
  commandType: WorkflowCommandType;
  hasCommand: boolean;
  contentForPrompt: string;
  isCommandOnly: boolean;
  templateId: string | null;
}

export interface WorkflowCommandSuggestion {
  value: string;
  label: string;
  description?: string;
  descriptionKey?: MessageKey;
  descriptionParams?: Record<string, string | number>;
}

export interface WorkflowTemplateSuggestionSource {
  id: string;
  name?: string | null;
  description?: string | null;
}

export interface WorkflowCommandSuggestionOptions {
  templates?: WorkflowTemplateSuggestionSource[];
  templateIds?: string[];
}

const WORKFLOW_TEMPLATE_SUGGESTIONS: WorkflowCommandSuggestion[] = [
  {
    value: '/wf analysis-heavy',
    label: 'analysis-heavy',
    descriptionKey: 'chat.workflowDirective.templates.analysisHeavy',
  },
  {
    value: '/wf feature-delivery',
    label: 'feature-delivery',
    descriptionKey: 'chat.workflowDirective.templates.featureDelivery',
  },
  {
    value: '/wf review-gate',
    label: 'review-gate',
    descriptionKey: 'chat.workflowDirective.templates.reviewGate',
  },
];

const WORKFLOW_CONTROL_SUGGESTIONS: WorkflowCommandSuggestion[] = [
  {
    value: '/wf-status',
    label: 'wf-status',
    descriptionKey: 'chat.workflowDirective.controls.status',
  },
  {
    value: '/wf-next',
    label: 'wf-next',
    descriptionKey: 'chat.workflowDirective.controls.next',
  },
  {
    value: '/wf-exit',
    label: 'wf-exit',
    descriptionKey: 'chat.workflowDirective.controls.exit',
  },
  {
    value: '/wf-accept',
    label: 'wf-accept',
    descriptionKey: 'chat.workflowDirective.controls.accept',
  },
  {
    value: '/wf-cancel',
    label: 'wf-cancel',
    descriptionKey: 'chat.workflowDirective.controls.cancel',
  },
];

function buildTemplateSuggestions(
  templates?: WorkflowTemplateSuggestionSource[],
  templateIds?: string[],
): WorkflowCommandSuggestion[] {
  const merged = new Map<string, WorkflowCommandSuggestion>();
  for (const item of WORKFLOW_TEMPLATE_SUGGESTIONS) {
    merged.set(item.label, item);
  }
  for (const item of templates ?? []) {
    const id = item.id.trim().toLowerCase();
    if (!id || merged.has(id)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const suggestion: WorkflowCommandSuggestion = {
      value: `/wf ${id}`,
      label: id,
    };
    if (description) {
      suggestion.description = description;
    } else if (name && name !== id) {
      suggestion.descriptionKey = 'chat.workflowDirective.templateName';
      suggestion.descriptionParams = { name };
    } else {
      suggestion.descriptionKey = 'chat.workflowDirective.customTemplate';
    }
    merged.set(id, suggestion);
  }
  for (const raw of templateIds ?? []) {
    const id = raw.trim().toLowerCase();
    if (!id || merged.has(id)) continue;
    merged.set(id, {
      value: `/wf ${id}`,
      label: id,
      descriptionKey: 'chat.workflowDirective.customTemplate',
    });
  }
  return Array.from(merged.values());
}

export function parseWorkflowDirectiveInput(content: string): WorkflowDirectiveInputResult {
  const command = content.match(COMMAND_PREFIX_RE);
  if (command) {
    const cmd = command.groups?.cmd?.toLowerCase();
    const contentForPrompt = (command.groups?.rest ?? '').trimStart();
    const commandType: WorkflowCommandType =
      cmd === 'accept'
      || cmd === 'cancel'
      || cmd === 'next'
      || cmd === 'exit'
      || cmd === 'status'
        ? cmd
        : 'none';
    return {
      commandType,
      hasCommand: commandType !== 'none',
      contentForPrompt,
      isCommandOnly: contentForPrompt.length === 0,
      templateId: null,
    };
  }

  const start = content.match(START_PREFIX_RE);
  if (start) {
    const rest = (start.groups?.rest ?? '').trimStart();
    if (!rest) {
      return {
        commandType: 'start',
        hasCommand: true,
        contentForPrompt: '',
        isCommandOnly: true,
        templateId: null,
      };
    }
    const firstTokenMatch = rest.match(/^(?<template>\S+)(?<remaining>[\s\S]*)$/);
    const templateId = firstTokenMatch?.groups?.template?.toLowerCase() ?? null;
    const contentForPrompt = (firstTokenMatch?.groups?.remaining ?? '').trimStart();
    return {
      commandType: 'start',
      hasCommand: true,
      contentForPrompt,
      isCommandOnly: contentForPrompt.length === 0,
      templateId,
    };
  }

  return {
    commandType: 'none',
    hasCommand: false,
    contentForPrompt: content,
    isCommandOnly: false,
    templateId: null,
  };
}

export function getWorkflowCommandType(content: string): WorkflowCommandType {
  return parseWorkflowDirectiveInput(content).commandType;
}

export function isWorkflowControlCommand(content: string): boolean {
  return parseWorkflowDirectiveInput(content).hasCommand;
}

export function isWorkflowCommandOnly(content: string): boolean {
  return parseWorkflowDirectiveInput(content).isCommandOnly;
}

export function getWorkflowCommandSuggestions(
  input: string,
  options: WorkflowCommandSuggestionOptions = {},
): WorkflowCommandSuggestion[] {
  const templateSuggestions = buildTemplateSuggestions(
    options.templates,
    options.templateIds,
  );
  const text = input.trimStart().toLowerCase();
  if (!text.startsWith('/wf')) return [];

  if (text === '/wf') {
    return [...templateSuggestions, ...WORKFLOW_CONTROL_SUGGESTIONS];
  }

  if (text.startsWith('/wf ')) {
    const query = text.slice('/wf '.length).trimStart();
    if (!query) return templateSuggestions;
    if (query.endsWith(' ')) return [];
    const [firstToken, ...rest] = query.split(/\s+/).filter(Boolean);
    if (rest.length > 0) return [];
    return templateSuggestions.filter((item) =>
      item.value.toLowerCase().includes(firstToken),
    );
  }

  if (text.startsWith('/wf-')) {
    const query = text.slice('/wf-'.length);
    if (query.includes(' ')) return [];
    if (!query) return WORKFLOW_CONTROL_SUGGESTIONS;
    return WORKFLOW_CONTROL_SUGGESTIONS.filter((item) =>
      item.value.toLowerCase().includes(`/wf-${query}`),
    );
  }

  return [];
}
