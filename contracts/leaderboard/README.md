# Stellarcade Leaderboard Contract

A central contract to track and manage player scores and rankings across different games in the Stellarcade ecosystem.

## Features
- Global and per-game score tracking.
- Automated ranking updates.
- Permissioned score submission.
- Optimized storage for fast rank retrieval.

## Public Interface
- `init(admin: Address)`: Initialize the contract with an admin.
- `submit_score(player: Address, game_id: Symbol, score: u64)`: Submit a player's score for a specific game. Only authorized callers (admin or registered game contracts) can submit scores.
- `update_rankings(game_id: Symbol)`: Re-sorts and updates the top players list for a game.
- `top_players(game_id: Symbol, limit: u32)` -> `Vec<ScoreEntry>`: Returns the top ranking players for a game.
- `player_rank(game_id: Symbol, player: Address)` -> `u32`: Returns the current rank of a player in a specific game.

## Events
- `ScoreSubmitted`: Emitted whenever a score is recorded.
- `LeaderboardUpdated`: Emitted when rankings for a game are updated.

## Storage
- `Admin`: Persistent storage of the contract administrator.
- `GameScores`: Per-player persistent storage for game scores.
- `Leaderboards`: Sorted lists of top performers per game.

## Security
- Admin-controlled authorization for score submission.
- Validation of game IDs and score values.
- Protection against unauthorized score manipulation.
