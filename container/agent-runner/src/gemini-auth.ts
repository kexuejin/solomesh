import path from 'path';

export type GeminiAuthMode = 'api_key' | 'oauth';

export function normalizeGeminiAuthMode(input: unknown): GeminiAuthMode {
  const normalized = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return normalized === 'oauth' ? 'oauth' : 'api_key';
}

export function resolveGeminiApiKey(
  env: Record<string, string | undefined>,
): string {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) return geminiKey;
  const googleKey = env.GOOGLE_API_KEY?.trim();
  if (googleKey) return googleKey;
  return '';
}

function trimTrailingSeparators(input: string): string {
  return input.replace(/[\\/]+$/g, '');
}

/**
 * GEMINI_CLI_HOME should point to "home root", not ".gemini" itself.
 * Keep backward compatibility when old values end with "/.gemini".
 */
export function normalizeGeminiCliHomeRoot(input: string): string {
  const trimmed = trimTrailingSeparators(input.trim());
  if (!trimmed) return '';
  if (path.basename(trimmed) === '.gemini') {
    const parent = path.dirname(trimmed);
    return parent || trimmed;
  }
  return trimmed;
}

export function resolveGeminiCliHomeCandidates(
  env: Record<string, string | undefined>,
): string[] {
  const homeRoot = normalizeGeminiCliHomeRoot(env.HOME?.trim() || '/home/node') || '/home/node';
  const configuredRoot = env.GEMINI_CLI_HOME?.trim()
    ? normalizeGeminiCliHomeRoot(env.GEMINI_CLI_HOME || '')
    : '';
  // In SoloMesh we explicitly set GEMINI_CLI_HOME to an isolated per-session home root.
  // When it is present, do not fallback to the host HOME to avoid reading stale local auth.
  if (configuredRoot) return [configuredRoot];
  return [homeRoot];
}

export function isGeminiMissingAuthError(message: string): boolean {
  return /Please set an Auth method|must specify the GEMINI_API_KEY environment variable/i.test(
    message,
  );
}
