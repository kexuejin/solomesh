export function isConfirmPhraseMatched(required: string, input: string): boolean {
  const requiredNormalized = required.trim();
  const inputNormalized = input.trim();
  if (!requiredNormalized || !inputNormalized) return false;
  return requiredNormalized === inputNormalized;
}
