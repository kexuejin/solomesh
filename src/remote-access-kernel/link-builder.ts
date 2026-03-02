export interface AccessLinkBuilderOptions {
  tokenQueryKey?: string;
}

export interface BuildAccessLinkRequest {
  publicUrl: string;
  token: string;
  path?: string;
  extraQuery?: Record<string, string>;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export class AccessLinkBuilder {
  private readonly tokenQueryKey: string;

  constructor(options: AccessLinkBuilderOptions = {}) {
    this.tokenQueryKey = options.tokenQueryKey ?? 'token';
    if (!this.tokenQueryKey) {
      throw new Error('tokenQueryKey must not be empty.');
    }
  }

  build(request: BuildAccessLinkRequest): string {
    const url = new URL(request.publicUrl);
    if (request.path !== undefined) {
      url.pathname = normalizePath(request.path);
    }
    url.searchParams.set(this.tokenQueryKey, request.token);
    for (const [key, value] of Object.entries(request.extraQuery ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
}
