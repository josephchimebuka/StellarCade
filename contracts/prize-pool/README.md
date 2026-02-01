# Prize Pool Contract

## Overview

The Prize Pool contract is the financial heart of Stellarcade. it handles all asset movements, including deposits, withdrawals, and payouts.

## Functions

### `initialize(admin: Address)`

Sets up the contract with the initial administrative address.

### `deposit(from: Address, amount: i128)`

Accepts Stellar assets and credits them to the user's on-platform balance.

### `withdraw(to: Address, amount: i128)`

Allows users to move their winnings or remaining balance back to their personal wallet.

### `get_balance(user: Address) -> i128`

Returns the current withdrawable balance for a given address.

### `calculate_payout(amount: i128) -> i128`

A utility function to preview the win amount after platform fees are deducted.

## Storage

- **Admin**: The authorized platform manager.
- \*\*Balances`: A map of `Address`to`i128`.

## Security

- All balance-changing functions require the `from`/`to` address to authorize.
- House fees are collected on every winning payout to sustain the pool.
