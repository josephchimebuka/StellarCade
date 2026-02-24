/**
 * Typed API SDK — StellarCade Backend Client
 *
 * Production-grade HTTP client for all StellarCade backend REST endpoints.
 * Follows the same conventions as `SorobanContractClient`:
 *
 * - **Result envelopes**: every method returns `ApiResult<T>` — never throws.
 * - **Error normalization**: raw HTTP responses are mapped to `AppError` via
 *   the shared `mapApiError()` / `mapRpcError()` functions.
 * - **Retry with backoff**: transient failures (5xx, 429, network errors) are
 *   retried up to `MAX_RETRIES` times with exponential backoff; 4xx errors
 *   (client mistakes) are terminal and never retried.
 * - **Auth propagation**: a `SessionStore` interface is injected so the client
 *   stays independently testable without coupling to `GlobalState`.
 * - **Input validation**: required fields are checked before any network call;
 *   invalid inputs return an `API_VALIDATION_ERROR` immediately.
 * - **UI-agnostic**: no React imports; hooks can wrap this via `useAsyncAction`.
 *
 * @module services/typed-api-sdk
 */

import { mapApiError, mapRpcError } from './error-mapping';
import { ErrorDomain, ErrorSeverity } from '../types/errors';
import type { AppError } from '../types/errors';
import type {
  ApiResult,
  CreateProfileRequest,
  CreateProfileResponse,
  DepositResponse,
  GetGamesResponse,
  GetProfileResponse,
  PlayGameRequest,
  PlayGameResponse,
  WithdrawResponse,
  WalletAmountRequest,
} from '../types/api-client';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeValidationError(message: string): AppError {
  return {
    code: 'API_VALIDATION_ERROR',
    domain: ErrorDomain.API,
    severity: ErrorSeverity.USER_ACTIONABLE,
    message,
  };
}

function makeUnauthorizedError(): AppError {
  return {
    code: 'API_UNAUTHORIZED',
    domain: ErrorDomain.API,
    severity: ErrorSeverity.USER_ACTIONABLE,
    message: 'Authentication required. Please sign in again.',
  };
}

// ── SessionStore interface ────────────────────────────────────────────────────

/**
 * Minimal auth token provider injected into `ApiClient`.
 *
 * Pass a thin adapter over `GlobalState` in production:
 * ```typescript
 * const sessionStore: SessionStore = { getToken: () => selectAuth(globalState).token };
 * ```
 * In tests, use a plain object:
 * ```typescript
 * const sessionStore: SessionStore = { getToken: () => 'test-token' };
 * ```
 */
export interface SessionStore {
  /** Returns the current JWT, or null when the user is not authenticated. */
  getToken(): string | null;
}

// ── ApiClient options ─────────────────────────────────────────────────────────

export interface ApiClientOptions {
  /**
   * Base URL for all API requests.
   * Defaults to `'/api'` (relative), which works with the Vite dev proxy and
   * same-origin deployments.
   */
  baseUrl?: string;
  /**
   * Token provider. When omitted, authenticated endpoints return
   * `API_UNAUTHORIZED` without making a network call.
   */
  sessionStore?: SessionStore;
}

// ── ApiClient ─────────────────────────────────────────────────────────────────

/**
 * Centralized typed HTTP client for the StellarCade backend API.
 *
 * @example
 * ```typescript
 * const client = new ApiClient({
 *   baseUrl: '/api',
 *   sessionStore: { getToken: () => authToken },
 * });
 *
 * const result = await client.getGames();
 * if (result.success) {
 *   console.log(result.data); // Game[]
 * } else {
 *   console.error(result.error.code); // e.g. 'API_SERVER_ERROR'
 * }
 * ```
 */
export class ApiClient {
  private readonly _baseUrl: string;
  private readonly _sessionStore: SessionStore | undefined;

  constructor(opts: ApiClientOptions = {}) {
    this._baseUrl = opts.baseUrl ?? '/api';
    this._sessionStore = opts.sessionStore;
  }

  // ── Core request primitive ─────────────────────────────────────────────────

  /**
   * Execute an HTTP request with retry, error mapping, and auth injection.
   *
   * @param method - HTTP method ('GET' | 'POST')
   * @param path - Path relative to baseUrl (e.g. '/games')
   * @param body - Optional JSON request body (POST only)
   * @param requiresAuth - When true, the request requires a valid JWT
   */
  private async _request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    requiresAuth: boolean,
  ): Promise<ApiResult<T>> {
    // ── Auth precondition ────────────────────────────────────────────────────
    const token = this._sessionStore?.getToken() ?? null;
    if (requiresAuth && token === null) {
      return { success: false, error: makeUnauthorizedError() };
    }

    // ── Build headers ────────────────────────────────────────────────────────
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token !== null) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${this._baseUrl}${path}`;

    // ── Retry loop ───────────────────────────────────────────────────────────
    let lastError: AppError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (networkErr) {
        // Network failure (fetch threw) — map and retry
        lastError = mapRpcError(networkErr, { url, attempt });
        if (lastError.severity === ErrorSeverity.RETRYABLE) continue;
        return { success: false, error: lastError };
      }

      if (response.ok) {
        const data = (await response.json()) as T;
        return { success: true, data };
      }

      // Parse error body — backend emits { error: { message, code, status } }
      // or { message }. We pass the parsed object to mapApiError.
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { status: response.status };
      }

      // Attach the HTTP status to whatever shape was returned so mapApiError
      // can pattern-match on it consistently.
      const rawWithStatus =
        typeof errorBody === 'object' && errorBody !== null
          ? { ...(errorBody as Record<string, unknown>), status: response.status }
          : { status: response.status };

      const mapped = mapApiError(rawWithStatus, { url, attempt, status: response.status });
      lastError = mapped;

      // Only retry RETRYABLE errors (5xx, 429, network)
      if (mapped.severity !== ErrorSeverity.RETRYABLE) {
        return { success: false, error: mapped };
      }
    }

    return { success: false, error: lastError! };
  }

  // ── Public endpoint methods ────────────────────────────────────────────────

  /**
   * Retrieve all available games.
   * `GET /api/games` — no auth required.
   */
  async getGames(): Promise<ApiResult<GetGamesResponse>> {
    return this._request<GetGamesResponse>('GET', '/games', undefined, false);
  }

  /**
   * Play a game session.
   * `POST /api/games/play` — auth required.
   *
   * @param req - `{ gameId, wager? }` — gameId must be non-empty.
   */
  async playGame(req: PlayGameRequest): Promise<ApiResult<PlayGameResponse>> {
    if (!req.gameId || req.gameId.trim() === '') {
      return {
        success: false,
        error: makeValidationError('gameId is required and must be a non-empty string.'),
      };
    }
    if (req.wager !== undefined && req.wager <= 0) {
      return {
        success: false,
        error: makeValidationError('wager must be greater than zero.'),
      };
    }
    return this._request<PlayGameResponse>('POST', '/games/play', req, true);
  }

  /**
   * Fetch the authenticated user's profile.
   * `GET /api/users/profile` — auth required.
   */
  async getProfile(): Promise<ApiResult<GetProfileResponse>> {
    return this._request<GetProfileResponse>('GET', '/users/profile', undefined, true);
  }

  /**
   * Create a new user profile.
   * `POST /api/users/create` — no auth required.
   *
   * @param req - `{ address, username? }` — address must be non-empty.
   */
  async createProfile(req: CreateProfileRequest): Promise<ApiResult<CreateProfileResponse>> {
    if (!req.address || req.address.trim() === '') {
      return {
        success: false,
        error: makeValidationError('address is required and must be a non-empty string.'),
      };
    }
    return this._request<CreateProfileResponse>('POST', '/users/create', req, false);
  }

  /**
   * Deposit funds into the user's wallet.
   * `POST /api/wallet/deposit` — auth required.
   *
   * @param req - `{ amount }` — must be greater than zero.
   */
  async deposit(req: WalletAmountRequest): Promise<ApiResult<DepositResponse>> {
    if (!req.amount || req.amount <= 0) {
      return {
        success: false,
        error: makeValidationError('amount must be greater than zero.'),
      };
    }
    return this._request<DepositResponse>('POST', '/wallet/deposit', req, true);
  }

  /**
   * Withdraw funds from the user's wallet.
   * `POST /api/wallet/withdraw` — auth required.
   *
   * @param req - `{ amount }` — must be greater than zero.
   */
  async withdraw(req: WalletAmountRequest): Promise<ApiResult<WithdrawResponse>> {
    if (!req.amount || req.amount <= 0) {
      return {
        success: false,
        error: makeValidationError('amount must be greater than zero.'),
      };
    }
    return this._request<WithdrawResponse>('POST', '/wallet/withdraw', req, true);
  }
}
