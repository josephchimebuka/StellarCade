/**
 * Typed request/response contracts for the StellarCade backend REST API.
 *
 * All public endpoints are represented here as plain TypeScript interfaces.
 * The `ApiResult<T>` discriminated union is the canonical return type for
 * every `ApiClient` method — callers never need a try/catch.
 *
 * @module types/api-client
 */

import type { AppError } from './errors';

// ── Result envelope ─────────────────────────────────────────────────────────

/**
 * Discriminated union returned by every `ApiClient` method.
 * Mirrors the `ContractResult<T>` pattern used in `types/contracts.ts`.
 *
 * @example
 * ```typescript
 * const result = await client.getGames();
 * if (result.success) {
 *   console.log(result.data); // Game[]
 * } else {
 *   console.error(result.error.code); // ApiErrorCode
 * }
 * ```
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };

// ── GET /api/games ───────────────────────────────────────────────────────────

/** A single game entry returned by the backend. */
export interface Game {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

/** Response shape for `GET /api/games`. */
export type GetGamesResponse = Game[];

// ── POST /api/games/play ─────────────────────────────────────────────────────

/** Request body for `POST /api/games/play`. Requires auth. */
export interface PlayGameRequest {
  /** ID of the game to play. Must be a non-empty string. */
  gameId: string;
  /** Optional wager amount in XLM. Must be positive if provided. */
  wager?: number;
}

/** Response shape for `POST /api/games/play`. */
export interface PlayGameResponse {
  result: string;
  payout?: number;
  txHash?: string;
}

// ── GET /api/users/profile ───────────────────────────────────────────────────

/** A user's on-chain profile. */
export interface UserProfile {
  address: string;
  username?: string;
  createdAt: string;
}

/** Response shape for `GET /api/users/profile`. */
export type GetProfileResponse = UserProfile;

// ── POST /api/users/create ───────────────────────────────────────────────────

/** Request body for `POST /api/users/create`. */
export interface CreateProfileRequest {
  /** Stellar public key (G…). Must be a non-empty string. */
  address: string;
  username?: string;
}

/** Response shape for `POST /api/users/create`. */
export type CreateProfileResponse = UserProfile;

// ── POST /api/wallet/deposit & /api/wallet/withdraw ─────────────────────────

/** Request body for deposit/withdraw endpoints. Requires auth. */
export interface WalletAmountRequest {
  /** Amount in XLM. Must be greater than zero. */
  amount: number;
}

/** Response shape for wallet operations. */
export interface WalletOpResponse {
  balance: number;
  txHash?: string;
}

/** Response shape for `POST /api/wallet/deposit`. */
export type DepositResponse = WalletOpResponse;

/** Response shape for `POST /api/wallet/withdraw`. */
export type WithdrawResponse = WalletOpResponse;
