/**
 * v1 network guard utilities.
 *
 * Normalizes provider network identifiers and validates support against
 * configurable allow-lists.
 *
 * @example
 * ```ts
 * const support = isSupportedNetwork('Test SDF Network ; September 2015');
 * if (!support.isSupported) {
 *   console.error(support.error);
 * }
 *
 * const asserted = assertSupportedNetwork('futurenet', {
 *   supportedNetworks: ['TESTNET', 'FUTURENET'],
 * });
 * ```
 */

export const DEFAULT_SUPPORTED_NETWORKS = ['TESTNET', 'PUBLIC'] as const;

export interface NetworkSupportError {
  code: 'NETWORK_MISSING' | 'NETWORK_UNSUPPORTED' | 'NETWORK_INVALID_ALLOW_LIST';
  message: string;
  actual: string | null;
  normalizedActual: string;
  supportedNetworks: readonly string[];
}

export interface NetworkSupportResult {
  isSupported: boolean;
  actual: string | null;
  normalizedActual: string;
  supportedNetworks: readonly string[];
  error?: NetworkSupportError;
}

export interface AssertNetworkResult {
  ok: boolean;
  normalizedActual: string;
  supportedNetworks: readonly string[];
  error?: NetworkSupportError;
}

export interface NetworkGuardOptions {
  supportedNetworks?: readonly string[];
}

function compact(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeAlias(raw: string): string {
  const c = compact(raw);

  if (
    c === 'testnet' ||
    c === 'testsdfnetworkseptember2015' ||
    c.includes('sorobantestnet')
  ) {
    return 'TESTNET';
  }

  if (
    c === 'public' ||
    c === 'mainnet' ||
    c === 'publicglobalstellarnetworkseptember2015' ||
    c.includes('sorobanpublic')
  ) {
    return 'PUBLIC';
  }

  if (c === 'futurenet') return 'FUTURENET';
  if (c === 'standalone') return 'STANDALONE';

  return raw.trim().toUpperCase();
}

function normalizeAllowList(input?: readonly string[]): readonly string[] {
  const source = input ?? DEFAULT_SUPPORTED_NETWORKS;
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  const normalized = source
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .map((item) => normalizeAlias(item));

  return Array.from(new Set(normalized));
}

/**
 * Normalizes any network identifier into canonical upper-case aliases.
 */
export function normalizeNetworkIdentity(network: string | null | undefined): string {
  if (network === null || network === undefined) return 'UNKNOWN';
  if (typeof network !== 'string') return 'UNKNOWN';
  if (network.trim() === '') return 'UNKNOWN';
  return normalizeAlias(network);
}

/**
 * Returns support status for the provided network.
 */
export function isSupportedNetwork(
  network: string | null | undefined,
  options: NetworkGuardOptions = {},
): NetworkSupportResult {
  const normalizedActual = normalizeNetworkIdentity(network);
  const supportedNetworks = normalizeAllowList(options.supportedNetworks);

  if (supportedNetworks.length === 0) {
    return {
      isSupported: false,
      actual: network ?? null,
      normalizedActual,
      supportedNetworks,
      error: {
        code: 'NETWORK_INVALID_ALLOW_LIST',
        message: 'supportedNetworks must include at least one valid network name.',
        actual: network ?? null,
        normalizedActual,
        supportedNetworks,
      },
    };
  }

  if (normalizedActual === 'UNKNOWN') {
    return {
      isSupported: false,
      actual: network ?? null,
      normalizedActual,
      supportedNetworks,
      error: {
        code: 'NETWORK_MISSING',
        message: 'Active network is missing or invalid.',
        actual: network ?? null,
        normalizedActual,
        supportedNetworks,
      },
    };
  }

  if (!supportedNetworks.includes(normalizedActual)) {
    return {
      isSupported: false,
      actual: network ?? null,
      normalizedActual,
      supportedNetworks,
      error: {
        code: 'NETWORK_UNSUPPORTED',
        message: `Network \"${normalizedActual}\" is not supported.`,
        actual: network ?? null,
        normalizedActual,
        supportedNetworks,
      },
    };
  }

  return {
    isSupported: true,
    actual: network ?? null,
    normalizedActual,
    supportedNetworks,
  };
}

/**
 * Assert-like helper that returns actionable mismatch context.
 */
export function assertSupportedNetwork(
  network: string | null | undefined,
  options: NetworkGuardOptions = {},
): AssertNetworkResult {
  const support = isSupportedNetwork(network, options);
  if (!support.isSupported) {
    return {
      ok: false,
      normalizedActual: support.normalizedActual,
      supportedNetworks: support.supportedNetworks,
      error: support.error,
    };
  }

  return {
    ok: true,
    normalizedActual: support.normalizedActual,
    supportedNetworks: support.supportedNetworks,
  };
}
