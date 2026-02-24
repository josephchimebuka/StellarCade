/**
 * v1 idempotency hook.
 *
 * React wrapper around idempotency utilities with no external side effects.
 */

import { useMemo } from 'react';
import {
  createInFlightRequestDedupe,
  generateIdempotencyKey,
  type DedupeRegisterOptions,
  type DedupeRegisterResult,
  type IdempotencyKeyContext,
  type IdempotencyKeyResult,
  type InFlightRequestDedupe,
} from '../../utils/v1/idempotency';

export interface UseIdempotencyV1Return {
  generateKey: (context: IdempotencyKeyContext) => IdempotencyKeyResult;
  registerInFlight: (key: string, options?: DedupeRegisterOptions) => DedupeRegisterResult;
  releaseInFlight: (key: string) => boolean;
  isInFlight: (key: string) => boolean;
  cleanupExpired: () => number;
  size: () => number;
  dedupe: InFlightRequestDedupe;
}

/**
 * Hook for deterministic idempotency key generation and in-flight dedupe.
 */
export function useIdempotency(
  dedupeOverride?: InFlightRequestDedupe,
): UseIdempotencyV1Return {
  const dedupe = useMemo(() => dedupeOverride ?? createInFlightRequestDedupe(), [dedupeOverride]);

  return {
    generateKey: generateIdempotencyKey,
    registerInFlight: (key, options) => dedupe.register(key, options),
    releaseInFlight: (key) => dedupe.release(key),
    isInFlight: (key) => dedupe.has(key),
    cleanupExpired: () => dedupe.cleanup(),
    size: () => dedupe.size(),
    dedupe,
  };
}

export default useIdempotency;
