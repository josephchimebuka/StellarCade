/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useIdempotency } from '../../../src/hooks/v1/idempotency';

describe('hooks/v1/idempotency', () => {
  it('generates key and tracks in-flight state', () => {
    const { result } = renderHook(() => useIdempotency());

    const keyResult = result.current.generateKey({
      operation: 'pool.fund',
      payload: { amount: 5 },
    });

    expect(keyResult.success).toBe(true);
    if (!keyResult.success) return;

    const reg = result.current.registerInFlight(keyResult.key!, { ttlMs: 1000 });
    expect(reg.accepted).toBe(true);

    expect(result.current.isInFlight(keyResult.key!)).toBe(true);

    act(() => {
      result.current.releaseInFlight(keyResult.key!);
    });

    expect(result.current.isInFlight(keyResult.key!)).toBe(false);
  });

  it('returns dedupe conflict for duplicate in-flight registration', () => {
    const { result } = renderHook(() => useIdempotency());

    result.current.registerInFlight('dup-key', { now: 0, ttlMs: 100 });
    const second = result.current.registerInFlight('dup-key', { now: 10, ttlMs: 100 });

    expect(second.accepted).toBe(false);
    expect(second.conflict).toBe(true);
  });
});
