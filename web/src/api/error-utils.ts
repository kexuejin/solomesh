export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

const BACKEND_UNAVAILABLE_MESSAGE =
  '后端服务不可用，请确认后端已启动（默认端口 3000）后重试';
const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';

function getErrorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (err instanceof Error) return err.message;
  return '';
}

export function mapFetchExceptionToApiError(err: unknown): ApiError {
  if (getErrorName(err) === 'AbortError') {
    return { status: 408, message: REQUEST_TIMEOUT_MESSAGE };
  }

  const msg = getErrorMessage(err).toLowerCase();
  const looksLikeConnectivityIssue =
    msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('load failed')
    || msg.includes('fetch failed');
  if (looksLikeConnectivityIssue) {
    return { status: 0, message: BACKEND_UNAVAILABLE_MESSAGE };
  }

  return { status: 0, message: '网络请求失败，请稍后重试' };
}
