// @vitest-environment node

/**
 * Integration tests for ApiClient (typed-api-sdk).
 *
 * Uses a deterministic mock fetch to simulate full request/response
 * round-trips across all domains (games, users, wallet). No live HTTP.
 *
 * These tests verify:
 *  - Complete happy-path flows per domain
 *  - Auth lifecycle (no token → error; token present → success)
 *  - Terminal vs retryable error paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../../src/services/typed-api-sdk';

// ── Mock fetch factory ────────────────────────────────────────────────────────

interface MockRoute {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

/**
 * Install a mock fetch that routes by method+URL to predetermined responses.
 * Unmatched requests return 501 Not Implemented.
 */
function installMockServer(routes: MockRoute[]): void {
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const match = routes.find(
      (r) => r.method.toUpperCase() === method && url.endsWith(r.path),
    );
    if (match) {
      return Promise.resolve({
        ok: match.status >= 200 && match.status < 300,
        status: match.status,
        json: async () => match.body,
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      status: 501,
      json: async () => ({ message: `No mock for ${method} ${url}` }),
    } as Response);
  });
}

function makeSessionStore(token: string | null = 'integration-token') {
  return { getToken: () => token };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

// A module-level spy reference that tests can assert on when they need to
// verify fetch was NOT called. Each test that doesn't use installMockServer
// or a sequential mock should set global.fetch to this spy explicitly.
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  global.fetch = fetchSpy;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Games domain ──────────────────────────────────────────────────────────────

describe('Integration — games domain', () => {
  it('full round-trip: list games → play game', async () => {
    installMockServer([
      {
        method: 'GET',
        path: '/games',
        status: 200,
        body: [{ id: 'coin-flip', name: 'Coin Flip', status: 'active' }],
      },
      {
        method: 'POST',
        path: '/games/play',
        status: 200,
        body: { result: 'win', payout: 2.0, txHash: 'txhash-abc' },
      },
    ]);

    const client = new ApiClient({ sessionStore: makeSessionStore() });

    // Step 1: list available games
    const gamesResult = await client.getGames();
    expect(gamesResult.success).toBe(true);
    if (!gamesResult.success) return;
    expect(gamesResult.data.length).toBe(1);
    expect(gamesResult.data[0].id).toBe('coin-flip');

    // Step 2: play the selected game
    const playResult = await client.playGame({ gameId: 'coin-flip', wager: 1.0 });
    expect(playResult.success).toBe(true);
    if (!playResult.success) return;
    expect(playResult.data.result).toBe('win');
    expect(playResult.data.txHash).toBe('txhash-abc');
  });

  it('play game fails when not authenticated', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.playGame({ gameId: 'coin-flip' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    // fetch must not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Users domain ──────────────────────────────────────────────────────────────

describe('Integration — users domain', () => {
  it('full round-trip: create profile → fetch profile', async () => {
    const address = 'GABC1234567890EXAMPLE';
    const profile = { address, username: 'alice', createdAt: '2024-01-15T10:00:00Z' };

    installMockServer([
      { method: 'POST', path: '/users/create', status: 200, body: profile },
      { method: 'GET', path: '/users/profile', status: 200, body: profile },
    ]);

    const client = new ApiClient({ sessionStore: makeSessionStore() });

    // Step 1: create profile (no auth required)
    const createResult = await client.createProfile({ address, username: 'alice' });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;
    expect(createResult.data.username).toBe('alice');

    // Step 2: fetch the profile (auth required)
    const profileResult = await client.getProfile();
    expect(profileResult.success).toBe(true);
    if (!profileResult.success) return;
    expect(profileResult.data.address).toBe(address);
  });

  it('getProfile fails when not authenticated', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getProfile();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createProfile fails on server error', async () => {
    installMockServer([
      { method: 'POST', path: '/users/create', status: 500, body: { message: 'db error' } },
      { method: 'POST', path: '/users/create', status: 500, body: { message: 'db error' } },
      { method: 'POST', path: '/users/create', status: 500, body: { message: 'db error' } },
    ]);

    const client = new ApiClient();
    const result = await client.createProfile({ address: 'GABC123' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_SERVER_ERROR');
    }
  }, 20_000);
});

// ── Wallet domain ─────────────────────────────────────────────────────────────

describe('Integration — wallet domain', () => {
  it('full round-trip: deposit then withdraw', async () => {
    installMockServer([
      { method: 'POST', path: '/wallet/deposit', status: 200, body: { balance: 110.0 } },
      { method: 'POST', path: '/wallet/withdraw', status: 200, body: { balance: 100.0 } },
    ]);

    const client = new ApiClient({ sessionStore: makeSessionStore() });

    const depositResult = await client.deposit({ amount: 10.0 });
    expect(depositResult.success).toBe(true);
    if (!depositResult.success) return;
    expect(depositResult.data.balance).toBe(110.0);

    const withdrawResult = await client.withdraw({ amount: 10.0 });
    expect(withdrawResult.success).toBe(true);
    if (!withdrawResult.success) return;
    expect(withdrawResult.data.balance).toBe(100.0);
  });

  it('deposit fails when not authenticated', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.deposit({ amount: 50.0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('withdraw fails when not authenticated', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.withdraw({ amount: 50.0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Auth lifecycle ────────────────────────────────────────────────────────────

describe('Integration — auth lifecycle', () => {
  it('unauthenticated requests to public endpoints succeed', async () => {
    installMockServer([
      { method: 'GET', path: '/games', status: 200, body: [] },
    ]);

    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getGames();

    expect(result.success).toBe(true);
  });

  it('authenticated requests carry Bearer token', async () => {
    installMockServer([
      { method: 'GET', path: '/users/profile', status: 200, body: { address: 'G123', createdAt: '2024-01-01' } },
    ]);

    const client = new ApiClient({ sessionStore: makeSessionStore('auth-token-xyz') });
    await client.getProfile();

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    const headers = calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer auth-token-xyz');
  });
});

// ── Terminal vs retryable ─────────────────────────────────────────────────────

describe('Integration — terminal vs retryable errors', () => {
  it('4xx errors are terminal — fetch called exactly once', async () => {
    installMockServer([
      { method: 'GET', path: '/games', status: 404, body: { message: 'not found' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    if (!result.success) {
      expect(result.error.code).toBe('API_NOT_FOUND');
    }
  });

  it('5xx errors are retried up to MAX_RETRIES times', async () => {
    // installMockServer routes by path only — use a sequential mock instead
    // so we can return 503 twice then 200 on the third attempt.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'unavailable' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'unavailable' }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: '1', name: 'Game', status: 'active' }] } as Response);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('validation errors are returned immediately without fetch', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 0 });

    expect(result.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });
});
