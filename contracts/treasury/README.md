# Treasury Contract

The Treasury contract is the platform-core funds module for Stellarcade.

It receives SEP-41 token deposits, enforces admin-controlled outgoing settlements, provides deterministic idempotency guards, and exposes a consistent state snapshot for downstream services/contracts.

## Public Interface

### `init(admin: Address, token_address: Address) -> Result<(), Error>`
Initializes the contract exactly once.

- Stores admin and token address.
- Seeds accounting counters to zero.
- Sets pause flag to `false`.
- Emits `Initialized`.

### `deposit(from: Address, amount: i128, reason: Symbol) -> Result<(), Error>`
Transfers `amount` from `from` into treasury.

- Requires `from` auth.
- Requires `amount > 0`.
- Rejected if paused.
- Rejected if `(from, reason)` already processed.
- Increments `available_balance` and `total_deposited`.
- Emits `Deposited`.

### `allocate(to_contract: Address, amount: i128, purpose: Symbol) -> Result<(), Error>`
Transfers funds from treasury to a downstream contract address.

- Admin only.
- Requires `amount > 0` and enough `available_balance`.
- Rejected if paused.
- Rejected if `(to_contract, purpose)` already processed.
- Decrements `available_balance`, increments `total_allocated`.
- Emits `Allocated`.

### `release(to: Address, amount: i128, purpose: Symbol) -> Result<(), Error>`
Transfers funds from treasury to a recipient address.

- Admin only.
- Requires `amount > 0` and enough `available_balance`.
- Rejected if paused.
- Rejected if `(to, purpose)` already processed.
- Decrements `available_balance`, increments `total_released`.
- Emits `Released`.

### `treasury_state() -> Result<TreasuryState, Error>`
Returns current state snapshot.

```rust
pub struct TreasuryState {
    pub admin: Address,
    pub token_address: Address,
    pub paused: bool,
    pub available_balance: i128,
    pub total_deposited: i128,
    pub total_allocated: i128,
    pub total_released: i128,
}
```

## Additional Admin Controls

### `pause(admin)` and `unpause(admin)`
Emergency controls for temporary mutation lock.

- `pause` and `unpause` are admin-only.
- `deposit`, `allocate`, and `release` are blocked while paused.
- Emits `PauseChanged`.

## Events

- `Initialized { admin, token_address }`
- `Deposited { from, amount, reason }`
- `Allocated { to_contract, amount, purpose }`
- `Released { to, amount, purpose }`
- `PauseChanged { paused, admin }`

## Storage Model

Instance storage:
- `Admin`
- `Token`
- `Paused`

Persistent storage:
- `Available`
- `TotalDeposited`
- `TotalAllocated`
- `TotalReleased`
- `ProcessedDeposit(DepositOp { from, reason })`
- `ProcessedAllocation(AllocateOp { to_contract, purpose })`
- `ProcessedRelease(ReleaseOp { to, purpose })`

All persistent keys are TTL-bumped on write.

## Invariants

- `available_balance = total_deposited - total_allocated - total_released`
- Outgoing flows (`allocate`, `release`) cannot exceed `available_balance`.
- Duplicate settlement processing is blocked by idempotency keys.
- Admin authorization is required for all privileged operations.

## Error Codes

- `AlreadyInitialized`
- `NotInitialized`
- `NotAuthorized`
- `InvalidAmount`
- `InsufficientFunds`
- `DuplicateOperation`
- `Overflow`
- `ContractPaused`
- `AlreadyPaused`
- `NotPaused`

## Integration Assumptions

- `token_address` is a deployed SEP-41 token contract.
- All managed inflows use `deposit`; direct token transfers to treasury bypass accounting and are out-of-scope.
- `purpose` and `reason` should be treated as idempotency keys by callers and must be unique per settlement intent.
- Downstream game contracts should use `allocate` for contract-directed settlement funding and `release` for recipient-directed payouts/refunds.

## Build and Test

```bash
cd contracts/treasury
cargo test
```
