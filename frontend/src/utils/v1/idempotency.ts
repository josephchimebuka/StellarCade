/**
 * v1 idempotency utilities.
 *
 * Provides deterministic key generation and in-flight dedupe helpers with
 * explicit expiry control. No global state is used.
 *
 * @example
 * ```ts
 * const key = generateIdempotencyKey({
 *   operation: 'coinFlip.play',
 *   payload: { amount: 10, side: 'heads' },
 * });
 * if (key.success) {
 *   const dedupe = createInFlightRequestDedupe();
 *   const reg = dedupe.register(key.key!);
 *   if (reg.accepted) {
 *     // execute request...
 *   }
 * }
 * ```
 */

import type { AppError } from '../../types/errors';

export interface IdempotencyKeyContext {
  operation: string;
  scope?: string | null;
  walletAddress?: string | null;
  contractAddress?: string | null;
  payload?: unknown;
}

export interface IdempotencyKeyResult {
  success: boolean;
  key?: string;
  fingerprint?: string;
  error?: AppError;
}

export interface DedupeRegisterResult {
  accepted: boolean;
  key: string;
  conflict: boolean;
  expiresAt: number;
  remainingMs: number;
}

export interface DedupeRegisterOptions {
  ttlMs?: number;
  now?: number;
}

const DEFAULT_TTL_MS = 30_000;

function sanitizeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '_').slice(0, 64);
}

function stableStringify(input: unknown): string {
  if (input === null || input === undefined) return 'null';
  if (typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((x) => stableStringify(x)).join(',')}]`;

  const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
    .join(',')}}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  // Convert to unsigned 32-bit hex.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function makeValidationError(message: string): AppError {
  return {
    code: 'API_VALIDATION_ERROR',
    domain: 'api',
    severity: 'user_actionable',
    message,
  };
}

/**
 * Generates a deterministic idempotency key from operation context.
 */
export function generateIdempotencyKey(context: IdempotencyKeyContext): IdempotencyKeyResult {
  if (!context || typeof context !== 'object') {
    return {
      success: false,
      error: makeValidationError('Context is required.'),
    };
  }

  if (!context.operation || context.operation.trim() === '') {
    return {
      success: false,
      error: makeValidationError('operation is required and must be non-empty.'),
    };
  }

  const operation = sanitizeSegment(context.operation);
  const scope = sanitizeSegment(context.scope ?? 'global');
  const fingerprintSource = stableStringify({
    walletAddress: context.walletAddress ?? null,
    contractAddress: context.contractAddress ?? null,
    payload: context.payload ?? null,
  });
  const fingerprint = fnv1aHex(fingerprintSource);

  return {
    success: true,
    key: `${operation}:${scope}:${fingerprint}`,
    fingerprint,
  };
}

/**
 * In-memory in-flight dedupe tracker with TTL-based expiry.
 */
export class InFlightRequestDedupe {
  private readonly keys = new Map<string, number>();

  register(key: string, options: DedupeRegisterOptions = {}): DedupeRegisterResult {
    if (!key || key.trim() === '') {
      throw new Error('key is required and must be non-empty');
    }

    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (ttlMs <= 0) {
      throw new Error('ttlMs must be > 0');
    }

    this.cleanup(now);

    const existingExpiry = this.keys.get(key);
    if (existingExpiry !== undefined && existingExpiry > now) {
      return {
        accepted: false,
        key,
        conflict: true,
        expiresAt: existingExpiry,
        remainingMs: existingExpiry - now,
      };
    }

    const expiresAt = now + ttlMs;
    this.keys.set(key, expiresAt);

    return {
      accepted: true,
      key,
      conflict: false,
      expiresAt,
      remainingMs: ttlMs,
    };
  }

  release(key: string): boolean {
    return this.keys.delete(key);
  }

  has(key: string, now: number = Date.now()): boolean {
    this.cleanup(now);
    const expiry = this.keys.get(key);
    return expiry !== undefined && expiry > now;
  }

  cleanup(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, expiry] of this.keys.entries()) {
      if (expiry <= now) {
        this.keys.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(now: number = Date.now()): number {
    this.cleanup(now);
    return this.keys.size;
  }
}

export function createInFlightRequestDedupe(): InFlightRequestDedupe {
  return new InFlightRequestDedupe();
}
