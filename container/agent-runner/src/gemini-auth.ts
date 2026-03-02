export function resolveGeminiApiKey(
  env: Record<string, string | undefined>,
): string {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) return geminiKey;
  const googleKey = env.GOOGLE_API_KEY?.trim();
  if (googleKey) return googleKey;
  return '';
}
