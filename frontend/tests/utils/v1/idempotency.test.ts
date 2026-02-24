/**
 * @jest-environment node
 */

import {
  createInFlightRequestDedupe,
  generateIdempotencyKey,
} from '../../../src/utils/v1/idempotency';

describe('utils/v1/idempotency', () => {
  it('generates stable keys for the same context', () => {
    const context = {
      operation: 'coinFlip.play',
      scope: 'wallet',
      walletAddress: 'GABC',
      payload: { amount: 10, side: 'heads' },
    };

    const a = generateIdempotencyKey(context);
    const b = generateIdempotencyKey(context);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success && b.success) {
      expect(a.key).toBe(b.key);
      expect(a.fingerprint).toBe(b.fingerprint);
    }
  });

  it('fails for missing operation', () => {
    const result = generateIdempotencyKey({ operation: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('dedupes in-flight keys until expiry and supports cleanup', () => {
    const dedupe = createInFlightRequestDedupe();
    const now = 1_000;

    const first = dedupe.register('k1', { now, ttlMs: 100 });
    const second = dedupe.register('k1', { now: now + 10, ttlMs: 100 });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.conflict).toBe(true);
    expect(dedupe.has('k1', now + 50)).toBe(true);

    const removed = dedupe.cleanup(now + 101);
    expect(removed).toBe(1);
    expect(dedupe.has('k1', now + 101)).toBe(false);
  });

  it('releases keys explicitly', () => {
    const dedupe = createInFlightRequestDedupe();
    dedupe.register('k2', { now: 0, ttlMs: 1000 });

    expect(dedupe.release('k2')).toBe(true);
    expect(dedupe.has('k2', 10)).toBe(false);
  });
});
