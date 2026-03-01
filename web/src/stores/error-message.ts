import { extractErrorMessage } from '../lib/error-message';

export function extractStoreErrorMessage(err: unknown): string | null {
  return extractErrorMessage(err);
}
