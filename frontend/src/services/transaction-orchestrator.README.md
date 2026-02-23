# Transaction Orchestrator

`TransactionOrchestrator` is a UI-agnostic service that coordinates transaction execution across wallet/backend/RPC layers.

## Responsibilities

- Deterministic lifecycle transitions:
  - `IDLE -> VALIDATING -> SUBMITTING -> SUBMITTED -> CONFIRMING -> CONFIRMED`
  - Retry path: `SUBMITTING -> RETRYING -> SUBMITTING`
  - Failure path: `... -> FAILED`
- Precondition and input validation before side effects.
- Submission retry policy for retryable failures.
- Confirmation polling with timeout handling.
- Correlation IDs for traceability across submit/confirm calls.
- Duplicate in-flight prevention.

## Usage

```ts
import { TransactionOrchestrator } from '../services/transaction-orchestrator';
import { ConfirmationStatus } from '../types/transaction-orchestrator';

const orchestrator = new TransactionOrchestrator();

const result = await orchestrator.execute({
  operation: 'coinFlip.play',
  input: { wager: 100n },
  validatePreconditions: () => null,
  validateInput: () => null,
  submit: async (_input, ctx) => {
    console.log(ctx.correlationId);
    return { txHash: 'abc123', data: { accepted: true } };
  },
  confirm: async (_hash) => ({
    status: ConfirmationStatus.CONFIRMED,
    confirmations: 1,
  }),
});
```

## Hook Wrapper

Use `useTransactionOrchestrator` to bind service state to React components without coupling the core orchestration logic to UI code.

## Notes

- `submit` and `confirm` functions are dependency-injected to keep this module reusable and easy to test.
- Retry decisions are driven by mapped error severity (`retryable` vs terminal).
