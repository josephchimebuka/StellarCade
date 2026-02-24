/**
 * @jest-environment node
 */

import {
  assertSupportedNetwork,
  isSupportedNetwork,
  normalizeNetworkIdentity,
} from '../../../src/utils/v1/useNetworkGuard';

describe('utils/v1/useNetworkGuard', () => {
  it('normalizes known aliases', () => {
    expect(normalizeNetworkIdentity('testnet')).toBe('TESTNET');
    expect(normalizeNetworkIdentity('mainnet')).toBe('PUBLIC');
    expect(normalizeNetworkIdentity('Test SDF Network ; September 2015')).toBe('TESTNET');
  });

  it('reports supported network', () => {
    const result = isSupportedNetwork('TESTNET');
    expect(result.isSupported).toBe(true);
    expect(result.normalizedActual).toBe('TESTNET');
  });

  it('returns actionable mismatch context for unsupported network', () => {
    const result = isSupportedNetwork('futurenet', { supportedNetworks: ['TESTNET'] });

    expect(result.isSupported).toBe(false);
    expect(result.error?.code).toBe('NETWORK_UNSUPPORTED');
    expect(result.error?.normalizedActual).toBe('FUTURENET');
    expect(result.error?.supportedNetworks).toEqual(['TESTNET']);
  });

  it('supports allow-list overrides', () => {
    const result = assertSupportedNetwork('futurenet', {
      supportedNetworks: ['TESTNET', 'FUTURENET'],
    });

    expect(result.ok).toBe(true);
    expect(result.normalizedActual).toBe('FUTURENET');
  });

  it('fails for invalid allow-list configuration', () => {
    const result = assertSupportedNetwork('TESTNET', { supportedNetworks: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NETWORK_INVALID_ALLOW_LIST');
  });
});
