// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useTransactionOrchestrator } from '../../src/hooks/useTransactionOrchestrator';
import {
  ConfirmationStatus,
  TransactionPhase,
} from '../../src/types/transaction-orchestrator';
import { ErrorDomain, ErrorSeverity } from '../../src/types/errors';

describe('useTransactionOrchestrator integration', () => {
  it('exposes service state updates through the hook for a happy path', async () => {
    const { result } = renderHook(() => useTransactionOrchestrator());

    await act(async () => {
      const execResult = await result.current.execute({
        operation: 'integration.happy',
        input: { amount: 5 },
        submit: async () => ({ txHash: 'tx-int-1', data: { ok: true } }),
        confirm: async () => ({
          status: ConfirmationStatus.CONFIRMED,
          confirmations: 1,
        }),
      });

      expect(execResult.success).toBe(true);
    });

    expect(result.current.state.phase).toBe(TransactionPhase.CONFIRMED);
    expect(result.current.state.txHash).toBe('tx-int-1');
    expect(result.current.state.confirmations).toBe(1);
  });

  it('maps terminal failure state and supports reset()', async () => {
    const { result } = renderHook(() => useTransactionOrchestrator());

    await act(async () => {
      const execResult = await result.current.execute({
        operation: 'integration.fail',
        input: {},
        submit: async () => ({ txHash: 'tx-int-2', data: null }),
        confirm: async () => ({
          status: ConfirmationStatus.FAILED,
          error: {
            code: 'RPC_TX_REJECTED',
            domain: ErrorDomain.RPC,
            severity: ErrorSeverity.FATAL,
            message: 'Rejected by network',
          },
        }),
      });

      expect(execResult.success).toBe(false);
    });

    expect(result.current.state.phase).toBe(TransactionPhase.FAILED);
    expect(result.current.state.error?.message).toContain('Rejected by network');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.phase).toBe(TransactionPhase.IDLE);
    expect(result.current.state.txHash).toBeUndefined();
  });
});
