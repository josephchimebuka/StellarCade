# Multi-Player Room Contract

## Overview

The Multi-Player Room contract manages room lifecycle for multi-player game sessions on Stellarcade.
It provides deterministic state transitions and consistent event emission for room creation,
player enrollment, match start, and room closure.

## Lifecycle

`Open -> InMatch -> Closed`

- `create_room` creates a room in `Open` state.
- `join_room` is allowed only in `Open`.
- `start_match` transitions `Open` to `InMatch` when minimum player count is met.
- `close_room` transitions `Open` or `InMatch` to `Closed`.

## Public Interface

### `init(admin, fee_contract)`

Initializes contract-level configuration and can only be called once.

### `create_room(room_id, config_hash)`

Admin-only room creation.

### `join_room(room_id, player)`

Player joins an open room; player must authorize.

### `start_match(room_id)`

Admin-only transition from `Open` to `InMatch`. Requires at least 2 players.

### `close_room(room_id)`

Admin-only transition to `Closed`.

## Additional View Methods

- `get_room(room_id) -> RoomData`
- `get_players(room_id) -> Vec<Address>`
- `get_fee_contract() -> Address`

## Events

- `Initialized { admin, fee_contract }`
- `RoomCreated { room_id, config_hash, created_by }`
- `PlayerJoined { room_id, player, player_count }`
- `MatchStarted { room_id, player_count }`
- `RoomClosed { room_id, final_player_count }`

## Storage

### Instance keys

- `Admin: Address`
- `FeeContract: Address`
- `Paused: bool`

### Persistent keys

- `Room(room_id): RoomData`
- `RoomPlayers(room_id): Vec<Address>`
- `PlayerInRoom(room_id, player): bool`

## Validation and Security

- Privileged methods require admin authorization (`create_room`, `start_match`, `close_room`).
- `join_room` requires player authorization.
- Duplicate joins and duplicate room IDs are rejected.
- Invalid/zero `room_id` and zeroed `config_hash` are rejected.
- State transitions are guarded and deterministic.
- Arithmetic uses checked operations for player count updates.
- Emergency pause guard exists via `Paused` instance flag.

## Invariants

- A room ID can be created only once.
- Room status can never move backward.
- A player can join a room at most once.
- `player_count == len(RoomPlayers(room_id))` for all successful transitions.

## Integration Assumptions

- `fee_contract` address is stored for downstream composition with fee/accounting contracts.
- No external contract call is made in this contract yet; orchestration is expected in higher-level game contracts.
- Emergency controls may set `Paused` via integrated admin tooling/contract governance.

## Test Coverage

Unit tests cover:

- Initialization and re-initialization guard
- Happy-path lifecycle and final state
- Unauthorized privileged method calls
- Duplicate create/join actions
- Invalid state transitions
- Invalid input rejection
- Paused/emergency guard behavior
- Event emission presence for lifecycle operations
