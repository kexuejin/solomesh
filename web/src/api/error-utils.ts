import { translateLocaleMessage } from '../i18n/runtime';
import { extractErrorMessage } from '../lib/error-message';

export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

type ErrorMessageKey =
  | 'api.errors.backendUnavailable'
  | 'api.errors.requestTimeout'
  | 'api.errors.networkFailed';

function getErrorText(key: ErrorMessageKey): string {
  return translateLocaleMessage(key);
}

function getErrorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

export function mapFetchExceptionToApiError(err: unknown): ApiError {
  if (getErrorName(err) === 'AbortError') {
    return { status: 408, message: getErrorText('api.errors.requestTimeout') };
  }

  const msg = (extractErrorMessage(err) ?? '').toLowerCase();
  const looksLikeConnectivityIssue =
    msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('load failed')
    || msg.includes('fetch failed');
  if (looksLikeConnectivityIssue) {
    return { status: 0, message: getErrorText('api.errors.backendUnavailable') };
  }

  return { status: 0, message: getErrorText('api.errors.networkFailed') };
}
