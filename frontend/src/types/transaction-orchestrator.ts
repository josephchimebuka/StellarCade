/**
 * Transaction Orchestrator contracts.
 *
 * Shared typed contracts for the submit -> confirm -> retry -> fail lifecycle.
 * The orchestrator stays UI-agnostic and exposes deterministic state snapshots.
 */

import type { AppError } from './errors';

export const TransactionPhase = {
  IDLE: 'IDLE',
  VALIDATING: 'VALIDATING',
  SUBMITTING: 'SUBMITTING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMING: 'CONFIRMING',
  RETRYING: 'RETRYING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;

export type TransactionPhase = (typeof TransactionPhase)[keyof typeof TransactionPhase];

export const TERMINAL_TRANSACTION_PHASES: ReadonlySet<TransactionPhase> = new Set([
  TransactionPhase.CONFIRMED,
  TransactionPhase.FAILED,
]);

export const ConfirmationStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;

export type ConfirmationStatus = (typeof ConfirmationStatus)[keyof typeof ConfirmationStatus];

export const OrchestratorErrorCode = {
  INVALID_INPUT: 'INVALID_INPUT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  INVALID_STATE: 'INVALID_STATE',
  DUPLICATE_IN_FLIGHT: 'DUPLICATE_IN_FLIGHT',
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',
  TIMEOUT: 'TIMEOUT',
} as const;

export type OrchestratorErrorCode =
  (typeof OrchestratorErrorCode)[keyof typeof OrchestratorErrorCode];

export interface OrchestratorError extends AppError {
  orchestratorCode: OrchestratorErrorCode;
  correlationId: string;
}

export interface TransactionContext {
  correlationId: string;
  operation: string;
  attempt: number;
  startedAt: number;
}

export interface SubmissionResult<TData> {
  txHash: string;
  data: TData;
}

export interface ConfirmationResult {
  status: ConfirmationStatus;
  confirmations?: number;
  error?: AppError;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
}

export interface TransactionRequest<TInput, TData> {
  operation: string;
  input: TInput;
  validateInput?: (input: TInput) => AppError | null;
  validatePreconditions?: () => AppError | null;
  submit: (input: TInput, context: TransactionContext) => Promise<SubmissionResult<TData>>;
  confirm: (txHash: string, context: TransactionContext) => Promise<ConfirmationResult>;
  retryPolicy?: Partial<RetryPolicy>;
  pollIntervalMs?: number;
  confirmationTimeoutMs?: number;
}

export interface TransactionOrchestratorState<TData = unknown> {
  phase: TransactionPhase;
  operation?: string;
  correlationId?: string;
  txHash?: string;
  data?: TData;
  confirmations: number;
  startedAt?: number;
  settledAt?: number;
  attempt: number;
  error?: OrchestratorError;
}

export type TransactionResult<TData> =
  | {
      success: true;
      correlationId: string;
      txHash: string;
      data: TData;
      confirmations: number;
      state: TransactionOrchestratorState<TData>;
    }
  | {
      success: false;
      correlationId: string;
      error: OrchestratorError;
      state: TransactionOrchestratorState<TData>;
    };

export type TransactionStateSubscriber<TData = unknown> = (
  state: TransactionOrchestratorState<TData>,
) => void;
