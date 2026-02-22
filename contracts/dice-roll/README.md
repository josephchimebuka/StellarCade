# Dice Roll Game Contract

A 1-in-6 dice betting game integrated with the Random Generator contract
for provably fair outcomes. Players predict which face (1–6) the die will
land on, place a wager, and an oracle resolves the outcome via the RNG
contract's request/fulfill model.

## Public Interface

| Function | Description |
|----------|-------------|
| `init(admin, rng_contract, token, min_wager, max_wager, house_edge_bps)` | One-time setup |
| `roll(player, prediction, wager, game_id)` | Player places a bet (prediction 1–6) |
| `resolve_roll(game_id)` | Resolve after RNG oracle fulfills the request |
| `get_roll(game_id)` | View roll/game state |

## End-to-End Game Flow

```
1. Admin deploys DiceRoll + RandomGenerator contracts
2. Admin calls rng.authorize(dice_roll_address) to whitelist the game
3. Admin calls dice_roll.init(...)

--- Per game ---

4. Player calls roll(player, 4, 100, game_id)
   → Tokens transfer from player to contract
   → RNG request submitted (request_id = game_id, max = 6)

5. Oracle calls rng.fulfill_random(oracle, game_id, server_seed)
   → Result computed: sha256(seed || id) % 6 → 0–5

6. Anyone calls resolve_roll(game_id)
   → Reads RNG result, maps 0–5 to die face 1–6
   → If player's prediction matches: payout = 6 * wager - fee
   → If not: wager stays in contract (house keeps it)
```

## Settlement

- **Win payout**: `6 * wager - (5 * wager * house_edge_bps / 10000)`
- **Loss**: wager stays in the contract
- House edge is applied only to the profit portion (5 × wager)
- House edge is configurable at init (e.g., 250 bps = 2.5%)

Example: 100 token wager at 250 bps edge:
- Winnings portion = 5 × 100 = 500
- Fee = 500 × 250 / 10000 = 12
- Payout = 600 − 12 = **588 tokens**

## Events

| Event | Topics | Fields |
|-------|--------|--------|
| `RollPlaced` | `game_id`, `player` | `prediction`, `wager` |
| `RollResolved` | `game_id`, `player` | `result`, `won`, `payout` |

## Storage

| Key | Scope | Description |
|-----|-------|-------------|
| `Admin` | Instance | Contract administrator |
| `Token` | Instance | Payment token address |
| `RngContract` | Instance | Random Generator contract address |
| `MinWager` | Instance | Minimum allowed wager |
| `MaxWager` | Instance | Maximum allowed wager |
| `HouseEdgeBps` | Instance | House edge in basis points |
| `Game(u64)` | Persistent | Individual roll state by game ID |

## Invariants

- Each `game_id` can only be used once (no duplicate games)
- A game can only be resolved once (`resolved` flag checked)
- RNG must be fulfilled before resolution is allowed
- Predictions must be in range 1–6
- Wagers must be within configured min/max bounds and > 0
- State is updated before external token transfers (reentrancy-safe)
- Persistent storage TTL is extended on every write (~30 days)

## Security

- Wager min/max limits enforced
- Invalid predictions (outside 1–6) rejected
- Duplicate game IDs rejected
- Double resolution rejected
- State updated before external token transfers (reentrancy-safe)
- RNG result must be fulfilled before resolution is allowed
- Checked arithmetic prevents overflow on all payout calculations

## Dependencies

| Contract | Purpose |
|----------|---------|
| `RandomGenerator` | Provably fair randomness via request/fulfill model |
| Stellar Token | Wager escrow and payout transfers |

The Dice Roll contract must be authorized on the RNG contract
(`rng.authorize(dice_roll_address)`) before it can request randomness.

## Running Tests

```bash
cd contracts/dice-roll
cargo test
```
