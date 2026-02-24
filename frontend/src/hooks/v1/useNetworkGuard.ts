import { useMemo } from 'react';

import {
  assertSupportedNetwork as assertSupportedNetworkUtil,
  isSupportedNetwork as isSupportedNetworkUtil,
  normalizeNetworkIdentity,
  DEFAULT_SUPPORTED_NETWORKS,
  type AssertNetworkResult,
  type NetworkGuardOptions,
  type NetworkSupportResult,
} from '../../utils/v1/useNetworkGuard';

export interface UseNetworkGuardOptions extends NetworkGuardOptions {
  network?: string | null;
}

export interface UseNetworkGuardReturn {
  network: string | null;
  normalizedNetwork: string;
  supportedNetworks: readonly string[];
  support: NetworkSupportResult;
  assertSupportedNetwork: (networkOverride?: string | null) => AssertNetworkResult;
  isSupported: (networkOverride?: string | null) => boolean;
}

/**
 * Hook wrapper for v1 network guard utilities.
 */
export function useNetworkGuard(options: UseNetworkGuardOptions = {}): UseNetworkGuardReturn {
  const network = options.network ?? null;
  const supportedNetworks =
    options.supportedNetworks === undefined
      ? DEFAULT_SUPPORTED_NETWORKS
      : options.supportedNetworks;

  const support = useMemo(
    () => isSupportedNetworkUtil(network, { supportedNetworks }),
    [network, supportedNetworks],
  );

  const normalizedNetwork = support.normalizedActual ?? normalizeNetworkIdentity(network);

  return {
    network,
    normalizedNetwork,
    supportedNetworks: support.supportedNetworks,
    support,
    assertSupportedNetwork: (networkOverride?: string | null) =>
      assertSupportedNetworkUtil(networkOverride ?? network, { supportedNetworks }),
    isSupported: (networkOverride?: string | null) =>
      isSupportedNetworkUtil(networkOverride ?? network, { supportedNetworks }).isSupported,
  };
}

export default useNetworkGuard;
