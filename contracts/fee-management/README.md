# Stellarcade Fee Management Contract

A comprehensive fee management system for the Stellarcade gaming platform that handles fee configuration, collection, accrual, and withdrawal with proper authorization and validation.

## Overview

The Fee Management Contract provides a centralized system for managing fees across all games in the Stellarcade platform. It supports per-game fee configurations, automatic fee collection, and secure fee distribution to designated recipients.

## Features

- **Per-Game Fee Configuration**: Set custom fee rates and recipients for each game
- **Automatic Fee Collection**: Calculate and collect fees during game transactions
- **Fee Accrual Tracking**: Track accumulated fees for each game
- **Secure Withdrawals**: Withdraw fees to designated recipients with authorization
- **Pause/Resume**: Emergency pause functionality for contract operations
- **Duplicate Prevention**: Guards against duplicate fee charges
- **Overflow Protection**: Safe arithmetic operations with overflow checks

## Contract Interface

### Public Methods

#### `init(admin: Address, treasury_contract: Address) -> Result<(), Error>`
Initializes the fee management contract with admin and treasury addresses.

**Parameters:**
- `admin`: Address with full control over the contract
- `treasury_contract`: Address of the treasury contract for fund custody

**Events:**
- `ContractInitialized`: Emitted when contract is successfully initialized

#### `set_fee_config(game_id: Symbol, bps: u32, recipient: Address) -> Result<(), Error>`
Sets fee configuration for a specific game.

**Parameters:**
- `game_id`: Unique identifier for the game
- `bps`: Fee rate in basis points (0-10,000, where 10,000 = 100%)
- `recipient`: Address to receive collected fees

**Authorization:** Admin only

**Events:**
- `FeeConfigSet`: Emitted when fee configuration is updated

#### `charge_fee(game_id: Symbol, amount: i128, token: Option<Address>) -> Result<i128, Result<i128, Error>>`
Charges fee for a game transaction and returns net amount.

**Parameters:**
- `game_id`: Unique identifier for the game
- `amount`: Transaction amount to charge fee on
- `token`: Optional token address (defaults to native token)

**Returns:**
- `Ok(Ok(net_amount))`: Success, returns amount after fee deduction
- `Ok(Err(Error))`: Fee charging failed

**Events:**
- `FeeCharged`: Emitted when fee is successfully charged

#### `accrued_fees(game_id: Symbol) -> Result<i128, Error>`
Returns the total accrued fees for a specific game.

**Parameters:**
- `game_id`: Unique identifier for the game

**Returns:**
- Total accrued fees for the specified game

#### `withdraw_fees(game_id: Symbol, recipient: Option<Address>, amount: Option<i128>) -> Result<(), Error>`
Withdraws accrued fees to a recipient.

**Parameters:**
- `game_id`: Unique identifier for the game
- `recipient`: Optional recipient address (defaults to fee config recipient)
- `amount`: Optional amount to withdraw (defaults to all accrued fees)

**Events:**
- `FeesWithdrawn`: Emitted when fees are successfully withdrawn

#### `pause() -> Result<(), Error>`
Pauses all contract operations (admin only).

**Events:**
- `ContractPaused`: Emitted when contract is paused

#### `unpause() -> Result<(), Error>`
Resumes contract operations (admin only).

**Events:**
- `ContractUnpaused`: Emitted when contract is unpaused

## Data Storage

### Storage Keys

- `Admin`: Contract administrator address
- `TreasuryContract`: Treasury contract address
- `Paused`: Contract pause state
- `FeeConfig(game_id)`: Fee configuration for each game
- `AccruedFees(game_id)`: Total accrued fees for each game
- `ProcessedCharge(operation)`: Prevents duplicate fee charges

### Data Structures

#### `FeeConfig`
```rust
pub struct FeeConfig {
    pub fee_bps: u32,        // Fee rate in basis points
    pub recipient: Address,  // Fee recipient address
}
```

#### `ChargeOp`
```rust
pub struct ChargeOp {
    pub game_id: Symbol,     // Game identifier
    pub amount: i128,        // Charge amount
    pub timestamp: u64,      // Operation timestamp
}
```

## Events

### `FeeConfigSet`
Emitted when fee configuration is set for a game.
```rust
pub struct FeeConfigSet {
    pub game_id: Symbol,
    pub fee_bps: u32,
    pub recipient: Address,
    pub admin: Address,
}
```

### `FeeCharged`
Emitted when a fee is successfully charged.
```rust
pub struct FeeCharged {
    pub game_id: Symbol,
    pub amount: i128,        // Original amount
    pub fee_amount: i128,    // Fee charged
    pub net_amount: i128,    // Amount after fee
}
```

### `FeesWithdrawn`
Emitted when fees are withdrawn.
```rust
pub struct FeesWithdrawn {
    pub game_id: Symbol,
    pub amount: i128,        // Amount withdrawn
    pub recipient: Address,
}
```

### `ContractInitialized`
Emitted when contract is initialized.
```rust
pub struct ContractInitialized {
    pub admin: Address,
    pub treasury_contract: Address,
}
```

### `ContractPaused` / `ContractUnpaused`
Emitted when contract pause state changes.
```rust
pub struct ContractPaused {
    pub admin: Address,
}
```

## Error Handling

### Error Codes

| Error | Code | Description |
|-------|------|-------------|
| `AlreadyInitialized` | 1 | Contract already initialized |
| `NotInitialized` | 2 | Contract not initialized |
| `NotAuthorized` | 3 | Caller not authorized |
| `InvalidAmount` | 4 | Invalid amount provided |
| `InsufficientFees` | 5 | Insufficient accrued fees |
| `InvalidFeeConfig` | 6 | Invalid fee configuration |
| `GameNotFound` | 7 | Game configuration not found |
| `Overflow` | 8 | Arithmetic overflow detected |
| `ContractPaused` | 9 | Contract is paused |
| `AlreadyPaused` | 10 | Contract already paused |
| `NotPaused` | 11 | Contract not paused |
| `InvalidRecipient` | 12 | Invalid recipient address |
| `DuplicateOperation` | 13 | Duplicate operation detected |

## Security Features

### Authorization Controls
- **Admin-only operations**: Initialization, fee configuration, pause/unpause
- **Role-based access**: Different authorization levels for different operations
- **Address validation**: Validates all address inputs

### State Protection
- **Initialization guards**: Prevents re-initialization
- **Pause mechanism**: Emergency stop for all operations
- **Duplicate prevention**: Guards against replay attacks

### Financial Safety
- **Overflow protection**: Safe arithmetic operations
- **Amount validation**: Validates all monetary amounts
- **Fee bounds**: Ensures fees are within valid ranges (0-100%)

## Integration Guide

### For Game Contracts

1. **Fee Configuration**: Call `set_fee_config` to set up fees for your game
2. **Fee Collection**: Call `charge_fee` during transactions to collect fees
3. **Fee Tracking**: Use `accrued_fees` to monitor collected fees
4. **Fee Withdrawal**: Call `withdraw_fees` to distribute collected fees

### Example Usage

```rust
// Set up fee configuration (admin only)
fee_contract.set_fee_config(
    &symbol_short!("my_game"), 
    &250, // 2.5%
    &fee_recipient
);

// Charge fee during game transaction
let net_amount = fee_contract.charge_fee(
    &symbol_short!("my_game"),
    &1000, // $10.00
    None // Native token
)?;

// Check accrued fees
let total_fees = fee_contract.accrued_fees(&symbol_short!("my_game"))?;

// Withdraw fees
fee_contract.withdraw_fees(
    &symbol_short!("my_game"),
    None, // Default recipient
    None  // Withdraw all
)?;
```

## Testing

The contract includes comprehensive unit tests covering:

- Initialization scenarios
- Fee configuration and validation
- Fee charging and calculation
- Accrual tracking
- Withdrawal operations
- Authorization controls
- Error conditions
- Edge cases (zero fees, maximum fees, overflow protection)
- Pause/unpause functionality

Run tests with:
```bash
cargo test --package stellarcade-fee-management
```

## Constants

- `BASIS_POINTS_DIVISOR`: 10,000 (for basis points calculations)
- `PERSISTENT_BUMP_LEDGERS`: 518,400 (storage TTL)

## Dependencies

- `soroban-sdk`: Stellar Soroban contract SDK
- `shared`: Shared Stellarcade utilities and types

## License

This contract is part of the Stellarcade platform and follows the same licensing terms.
