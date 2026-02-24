/**
 * useTransactionOrchestrator
 *
 * React wrapper for TransactionOrchestrator. Keeps UI usage simple while
 * preserving the service's UI-agnostic core behavior.
 */

import { useEffect, useMemo, useState } from 'react';
import { TransactionOrchestrator } from '../services/transaction-orchestrator';
import type {
  TransactionOrchestratorState,
  TransactionRequest,
  TransactionResult,
} from '../types/transaction-orchestrator';

export interface UseTransactionOrchestratorReturn {
  state: TransactionOrchestratorState;
  execute: <TInput, TData>(
    request: TransactionRequest<TInput, TData>,
  ) => Promise<TransactionResult<TData>>;
  reset: () => void;
  service: TransactionOrchestrator;
}

export function useTransactionOrchestrator(
  serviceOverride?: TransactionOrchestrator,
): UseTransactionOrchestratorReturn {
  const service = useMemo(
    () => serviceOverride ?? new TransactionOrchestrator(),
    [serviceOverride],
  );

  const [state, setState] = useState<TransactionOrchestratorState>(service.getState());

  useEffect(() => {
    const unsubscribe = service.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, [service]);

  return {
    state,
    execute: service.execute.bind(service),
    reset: service.reset.bind(service),
    service,
  };
}

export default useTransactionOrchestrator;
