// @vitest-environment node

/**
 * Unit tests for ApiClient (typed-api-sdk).
 *
 * All network calls are intercepted via `vi.fn()` on the global `fetch`.
 * No live HTTP — every response is a deterministic mock object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../../src/services/typed-api-sdk';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): void {
  let mock = vi.fn();
  for (const r of responses) {
    mock = mock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response);
  }
  global.fetch = mock;
}

function mockFetchNetworkError(times = 1): void {
  let mock = vi.fn();
  for (let i = 0; i < times; i++) {
    mock = mock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  }
  global.fetch = mock;
}

function makeSessionStore(token: string | null = 'test-jwt-token') {
  return { getToken: () => token };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe('ApiClient — happy path', () => {
  it('getGames returns typed game list', async () => {
    const games = [{ id: '1', name: 'Coin Flip', status: 'active' }];
    mockFetch(200, games);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(games);
    }
  });

  it('playGame returns play result', async () => {
    const payload = { result: 'win', payout: 2.5, txHash: 'abc123' };
    mockFetch(200, payload);

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: 'game-1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.result).toBe('win');
      expect(result.data.payout).toBe(2.5);
    }
  });

  it('getProfile returns user profile', async () => {
    const profile = { address: 'GABC123', username: 'alice', createdAt: '2024-01-01' };
    mockFetch(200, profile);

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe('GABC123');
    }
  });

  it('createProfile returns created profile', async () => {
    const profile = { address: 'GABC123', createdAt: '2024-01-01' };
    mockFetch(200, profile);

    const client = new ApiClient();
    const result = await client.createProfile({ address: 'GABC123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe('GABC123');
    }
  });

  it('deposit returns updated balance', async () => {
    mockFetch(200, { balance: 105.0 });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 5.0 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe(105.0);
    }
  });

  it('withdraw returns updated balance', async () => {
    mockFetch(200, { balance: 95.0 });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.withdraw({ amount: 5.0 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balance).toBe(95.0);
    }
  });
});

// ── Auth propagation ─────────────────────────────────────────────────────────

describe('ApiClient — auth propagation', () => {
  it('sends Authorization header when token is present', async () => {
    mockFetch(200, { result: 'win' });
    const client = new ApiClient({ sessionStore: makeSessionStore('my-token') });
    await client.playGame({ gameId: 'game-1' });

    const calledHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBe('Bearer my-token');
  });

  it('returns API_UNAUTHORIZED immediately when token is missing for auth-required endpoint', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.playGame({ gameId: 'game-1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    // fetch must NOT have been called
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns API_UNAUTHORIZED when no sessionStore is provided for auth-required endpoint', async () => {
    const client = new ApiClient();
    const result = await client.getProfile();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
  });

  it('does not send Authorization header when token is null for public endpoint', async () => {
    mockFetch(200, []);
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    await client.getGames();

    const calledHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });
});

// ── Retry logic ───────────────────────────────────────────────────────────────

describe('ApiClient — retry logic', () => {
  it('retries on 500 and succeeds on third attempt', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'server error' } },
      { status: 500, body: { message: 'server error' } },
      { status: 200, body: [{ id: '1', name: 'CoinFlip', status: 'active' }] },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('returns error after exhausting all retries on 500', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'error' } },
      { status: 500, body: { message: 'error' } },
      { status: 500, body: { message: 'error' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_SERVER_ERROR');
    }
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('retries on network failure and succeeds', async () => {
    const successResponse = {
      ok: true,
      status: 200,
      json: async () => [{ id: '2', name: 'Pattern Puzzle', status: 'active' }],
    } as Response;

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(successResponse);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
  }, 20_000);

  it('does NOT retry on 400 (terminal client error)', async () => {
    mockFetch(400, { message: 'bad request' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: 'x' });

    expect(result.success).toBe(false);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    mockFetch(401, { message: 'unauthorized' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile();

    expect(result.success).toBe(false);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

// ── Error mapping ─────────────────────────────────────────────────────────────

describe('ApiClient — error mapping', () => {
  it('maps 400 → API_VALIDATION_ERROR', async () => {
    mockFetch(400, { error: { message: 'invalid input', status: 400 } });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: 'g1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('maps 401 → API_UNAUTHORIZED', async () => {
    mockFetch(401, { message: 'unauthorized' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
  });

  it('maps 403 → API_FORBIDDEN', async () => {
    mockFetch(403, { message: 'forbidden' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 10 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_FORBIDDEN');
    }
  });

  it('maps 404 → API_NOT_FOUND', async () => {
    mockFetch(404, { message: 'not found' });

    const client = new ApiClient();
    const result = await client.createProfile({ address: 'GABC123' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_NOT_FOUND');
    }
  });

  it('maps 429 → API_RATE_LIMITED', async () => {
    // 429 is RETRYABLE so client will retry MAX_RETRIES times; supply enough responses.
    mockFetchSequence([
      { status: 429, body: { message: 'slow down' } },
      { status: 429, body: { message: 'slow down' } },
      { status: 429, body: { message: 'slow down' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_RATE_LIMITED');
    }
  }, 20_000);

  it('maps 500 → API_SERVER_ERROR (after retries exhausted)', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'crash' } },
      { status: 500, body: { message: 'crash' } },
      { status: 500, body: { message: 'crash' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_SERVER_ERROR');
    }
  }, 20_000);
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('ApiClient — input validation', () => {
  it('rejects playGame with empty gameId without calling fetch', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects playGame with whitespace-only gameId', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: '   ' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects playGame with non-positive wager', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.playGame({ gameId: 'g1', wager: -5 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects createProfile with empty address', async () => {
    const client = new ApiClient();
    const result = await client.createProfile({ address: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects deposit with zero amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects deposit with negative amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: -1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects withdraw with zero amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.withdraw({ amount: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });
});

// ── Result envelope shape ─────────────────────────────────────────────────────

describe('ApiClient — result envelope shape', () => {
  it('success result has { success: true, data } and no error property', async () => {
    mockFetch(200, []);
    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    expect('data' in result).toBe(true);
    expect('error' in result).toBe(false);
  });

  it('failure result has { success: false, error } and no data property', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getProfile();

    expect(result.success).toBe(false);
    expect('error' in result).toBe(true);
    expect('data' in result).toBe(false);
  });

  it('error contains code, domain, severity, message fields', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.deposit({ amount: 10 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error.code).toBe('string');
      expect(typeof result.error.domain).toBe('string');
      expect(typeof result.error.severity).toBe('string');
      expect(typeof result.error.message).toBe('string');
    }
  });
});
