import { MESSAGES, zhCN } from './messages';

export type UiLocale = keyof typeof MESSAGES;
export const UI_LOCALE_STORAGE_KEY = 'solomesh.ui.locale';

type MessageTree = typeof zhCN;
type MessageNode = string | Record<string, unknown>;
type DotPath<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${DotPath<T[K]>}`
      : never;
}[keyof T & string];

export type MessageKey = DotPath<MessageTree> | string;
export type MessageParams = Record<string, string | number>;

export function normalizeUiLocale(input: string | null | undefined): UiLocale | null {
  if (!input) return null;
  const lower = input.trim().toLowerCase();
  if (!lower) return null;
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  return null;
}

export function detectSystemLocale(): UiLocale {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [...(navigator.languages || []), navigator.language];
  for (const item of candidates) {
    const locale = normalizeUiLocale(item);
    if (locale) return locale;
  }
  return 'en';
}

export function detectUiLocale(): UiLocale {
  if (typeof window !== 'undefined') {
    const stored = normalizeUiLocale(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY));
    if (stored) return stored;
  }
  return detectSystemLocale();
}

export function resolveMessage(tree: Record<string, unknown>, key: string): string | null {
  const segments = key.split('.');
  let node: MessageNode | undefined = tree;
  for (const segment of segments) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, MessageNode>)[segment];
  }
  return typeof node === 'string' ? node : null;
}

export function applyMessageParams(
  template: string,
  params?: MessageParams,
): string {
  if (!params) return template;
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

export function resolveLocaleMessage(key: string, locale: UiLocale = detectUiLocale()): string {
  const localeDict = MESSAGES[locale] as unknown as Record<string, unknown>;
  const fallbackDict = MESSAGES.en as unknown as Record<string, unknown>;
  return resolveMessage(localeDict, key) ?? resolveMessage(fallbackDict, key) ?? key;
}

export function translateLocaleMessage(
  key: string,
  params?: MessageParams,
  locale: UiLocale = detectUiLocale(),
): string {
  return applyMessageParams(resolveLocaleMessage(key, locale), params);
}
