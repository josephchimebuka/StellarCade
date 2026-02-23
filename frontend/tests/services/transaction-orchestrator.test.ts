import { TransactionOrchestrator } from '../../src/services/transaction-orchestrator';
import {
  ConfirmationStatus,
  OrchestratorErrorCode,
  TransactionPhase,
  type TransactionContext,
} from '../../src/types/transaction-orchestrator';
import { ErrorDomain, ErrorSeverity, type AppError } from '../../src/types/errors';

function makeRetryableError(message = 'temporary failure'): AppError {
  return {
    code: 'RPC_NODE_UNAVAILABLE',
    domain: ErrorDomain.RPC,
    severity: ErrorSeverity.RETRYABLE,
    message,
  };
}

describe('TransactionOrchestrator', () => {
  it('completes submit + confirm happy path', async () => {
    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => 'corr-happy',
    });

    const result = await orchestrator.execute({
      operation: 'coinFlip.play',
      input: { wager: 10 },
      submit: async (_input, context) => {
        expect(context.correlationId).toBe('corr-happy');
        return { txHash: 'abc123', data: { accepted: true } };
      },
      confirm: async (_txHash) => ({
        status: ConfirmationStatus.CONFIRMED,
        confirmations: 1,
      }),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.correlationId).toBe('corr-happy');
      expect(result.txHash).toBe('abc123');
      expect(result.data).toEqual({ accepted: true });
      expect(result.state.phase).toBe(TransactionPhase.CONFIRMED);
      expect(result.state.confirmations).toBe(1);
    }
  });

  it('retries submission for retryable errors and then succeeds', async () => {
    let submitCalls = 0;

    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => 'corr-retry',
    });

    const result = await orchestrator.execute({
      operation: 'pool.fund',
      input: { amount: 100 },
      retryPolicy: { maxAttempts: 3, initialBackoffMs: 1, backoffMultiplier: 1 },
      submit: async () => {
        submitCalls += 1;
        if (submitCalls < 3) {
          throw makeRetryableError('node unavailable');
        }
        return { txHash: 'retry123', data: { done: true } };
      },
      confirm: async () => ({ status: ConfirmationStatus.CONFIRMED, confirmations: 2 }),
    });

    expect(submitCalls).toBe(3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state.phase).toBe(TransactionPhase.CONFIRMED);
      expect(result.state.attempt).toBe(3);
    }
  });

  it('fails fast on precondition failure without calling submit', async () => {
    const submit = jest.fn(async () => ({ txHash: 'never', data: null }));

    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => 'corr-precondition',
    });

    const result = await orchestrator.execute({
      operation: 'badge.award',
      input: { user: 'G...' },
      validatePreconditions: () => ({
        code: 'WALLET_NOT_CONNECTED',
        domain: ErrorDomain.WALLET,
        severity: ErrorSeverity.USER_ACTIONABLE,
        message: 'Wallet must be connected before this action.',
      }),
      submit,
      confirm: async () => ({ status: ConfirmationStatus.CONFIRMED }),
    });

    expect(submit).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.orchestratorCode).toBe(OrchestratorErrorCode.PRECONDITION_FAILED);
      expect(result.state.phase).toBe(TransactionPhase.FAILED);
    }
  });

  it('fails when confirmation returns terminal failure', async () => {
    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => 'corr-confirm-fail',
    });

    const result = await orchestrator.execute({
      operation: 'coinFlip.resolve',
      input: { gameId: 7 },
      submit: async () => ({ txHash: 'deadbeef', data: { gameId: 7 } }),
      confirm: async () => ({
        status: ConfirmationStatus.FAILED,
        error: {
          code: 'RPC_TX_REJECTED',
          domain: ErrorDomain.RPC,
          severity: ErrorSeverity.FATAL,
          message: 'Transaction was rejected by network.',
        },
      }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.orchestratorCode).toBe(OrchestratorErrorCode.CONFIRMATION_FAILED);
      expect(result.state.phase).toBe(TransactionPhase.FAILED);
    }
  });

  it('fails on confirmation timeout', async () => {
    let now = 0;

    const orchestrator = new TransactionOrchestrator({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      generateCorrelationId: () => 'corr-timeout',
    });

    const result = await orchestrator.execute({
      operation: 'tx.timeout.case',
      input: {},
      confirmationTimeoutMs: 2_000,
      pollIntervalMs: 1_000,
      submit: async () => ({ txHash: 'slowtx', data: null }),
      confirm: async () => ({ status: ConfirmationStatus.PENDING }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.orchestratorCode).toBe(OrchestratorErrorCode.TIMEOUT);
      expect(result.state.phase).toBe(TransactionPhase.FAILED);
    }
  });

  it('prevents duplicate in-flight execution', async () => {
    let resolveSubmit: ((v: { txHash: string; data: null }) => void) | null = null;

    const submit = jest.fn(
      () =>
        new Promise<{ txHash: string; data: null }>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => `corr-${Math.random().toString(16).slice(2, 6)}`,
    });

    const firstPromise = orchestrator.execute({
      operation: 'first',
      input: {},
      submit,
      confirm: async () => ({ status: ConfirmationStatus.CONFIRMED }),
    });

    const secondResult = await orchestrator.execute({
      operation: 'second',
      input: {},
      submit,
      confirm: async () => ({ status: ConfirmationStatus.CONFIRMED }),
    });

    expect(secondResult.success).toBe(false);
    if (!secondResult.success) {
      expect(secondResult.error.orchestratorCode).toBe(OrchestratorErrorCode.DUPLICATE_IN_FLIGHT);
    }

    expect(resolveSubmit).not.toBeNull();
    (resolveSubmit as (v: { txHash: string; data: null }) => void)({ txHash: 'done', data: null });

    await firstPromise;
  });

  it('emits deterministic phases to subscribers', async () => {
    const phases: TransactionPhase[] = [];
    const orchestrator = new TransactionOrchestrator({
      sleep: async () => {},
      generateCorrelationId: () => 'corr-phases',
    });

    orchestrator.subscribe((state) => {
      phases.push(state.phase);
    });

    await orchestrator.execute({
      operation: 'phases',
      input: {},
      submit: async (_input, _ctx: TransactionContext) => ({ txHash: 'phaseTx', data: null }),
      confirm: async () => ({ status: ConfirmationStatus.CONFIRMED }),
    });

    expect(phases).toEqual([
      TransactionPhase.IDLE,
      TransactionPhase.VALIDATING,
      TransactionPhase.SUBMITTING,
      TransactionPhase.SUBMITTED,
      TransactionPhase.CONFIRMING,
      TransactionPhase.CONFIRMED,
    ]);
  });
});
