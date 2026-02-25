# AI-Generated Game Contract

This Soroban smart contract implements the business logic and state machine required for AI-Generated games on the Stellarcade platform. It serves as the decentralized referee and escrow, verifying interactions between players and AI oracles with deterministic constraints.

## Responsibilities & Features

- **State Transitions**: Enforces a strict linear lifecycle (`Created` -> `InProgress` -> `Resolved`) for each game instance. Duplicate interactions natively roll backward preserving invariants.
- **Oracle Interaction**: Authenticated Oracles feed final payloads resolving games programmatically. Only authorized inputs overwrite internal completion checkpoints natively.
- **Reward Claim Systems**: Allows recognized winners mapped during oracle executions to securely trigger claim functions locally. Duplicates and unauthorized allocations instantly panic natively yielding `RewardAlreadyClaimed` or `NoReward`.
- **Authorization Constraints**: Binds `submit_ai_move` strictly to the `player`, initialization and setup bounds to `admin`, and the final resolution paths securely to `model_oracle` nodes safely keeping responsibilities decoupled robustly.

## Required Public Interface

**`init(admin: Address, model_oracle: Address, reward_contract: Address) -> Result<(), Error>`**:
Initializes the core contract configuration mapped globally in instance storage natively once.

**`create_ai_game(admin: Address, game_id: u64, config_hash: BytesN<32>) -> Result<(), Error>`**:
Registers a newly compiled mapped AI scenario to the blockchain via a deterministic configuration hash.

**`submit_ai_move(player: Address, game_id: u64, move_payload: String) -> Result<(), Error>`**: 
Ingests a player's payload during a live AI game cycle triggering `InProgress` natively dynamically. 

**`resolve_ai_game(oracle: Address, game_id: u64, result_payload: String, winner: Option<Address>) -> Result<(), Error>`**:
Called exclusively by the oracle infrastructure concluding bounds explicitly declaring a payout claim mappings target cleanly.

**`claim_ai_reward(player: Address, game_id: u64) -> Result<(), Error>`**:
Transfers the player's rewards via mapping to downstream allocation dependencies checking idempotency properly executing event emissions reliably.

## Events emitted

- `(symbol_short!("init"))`: Dispatched when infrastructure mapped successfully.
- `(symbol_short!("created"), game_id)`: Dispatched when an AI game maps `Created` natively.
- `(symbol_short!("move"), game_id, player)`: Dispatched indicating successful gameplay injection dynamically tracking offchain state correctly.
- `(symbol_short!("resolved"), game_id, oracle)`: Indicates finality reached mapping outcomes reliably.
- `(symbol_short!("claimed"), game_id, player)`: Signifies payout logic executed deterministically.
