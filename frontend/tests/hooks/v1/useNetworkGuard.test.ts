/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';

import { useNetworkGuard } from '../../../src/hooks/v1/useNetworkGuard';

describe('hooks/v1/useNetworkGuard', () => {
  it('returns supported status for default TESTNET', () => {
    const { result } = renderHook(() => useNetworkGuard({ network: 'testnet' }));

    expect(result.current.normalizedNetwork).toBe('TESTNET');
    expect(result.current.support.isSupported).toBe(true);
    expect(result.current.isSupported()).toBe(true);
  });

  it('returns mismatch error context for unsupported network', () => {
    const { result } = renderHook(() =>
      useNetworkGuard({
        network: 'futurenet',
        supportedNetworks: ['TESTNET'],
      }),
    );

    expect(result.current.support.isSupported).toBe(false);
    expect(result.current.support.error?.code).toBe('NETWORK_UNSUPPORTED');

    const assertion = result.current.assertSupportedNetwork();
    expect(assertion.ok).toBe(false);
    expect(assertion.error?.supportedNetworks).toEqual(['TESTNET']);
  });

  it('supports allow-list overrides for dev/test networks', () => {
    const { result } = renderHook(() =>
      useNetworkGuard({
        network: 'futurenet',
        supportedNetworks: ['TESTNET', 'FUTURENET'],
      }),
    );

    expect(result.current.support.isSupported).toBe(true);
    expect(result.current.isSupported()).toBe(true);
  });
});
