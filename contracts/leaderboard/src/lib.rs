//! Stellarcade Leaderboard Contract
//!
//! Tracks player scores across different games and maintains a top-players list.
//! The contract is permissioned, allowing only the admin or authorized game
//! contracts to submit scores.

#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LEADERBOARD_SIZE: u32 = 100;
const PERSISTENT_BUMP_LEDGERS: u32 = 518_400; // ~30 days

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidLimit = 4,
    Overflow = 5,
    GameNotFound = 6,
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreEntry {
    pub player: Address,
    pub score: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Authorized(Address),
    GameActive(Symbol),
    PlayerScore(Symbol, Address),
    Leaderboard(Symbol),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ScoreSubmitted {
    #[topic]
    pub game_id: Symbol,
    #[topic]
    pub player: Address,
    pub score: u64,
}

#[contractevent]
pub struct LeaderboardUpdated {
    #[topic]
    pub game_id: Symbol,
}

#[contractevent]
pub struct GameStatusChanged {
    #[topic]
    pub game_id: Symbol,
    pub active: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct LeaderboardContract;

#[contractimpl]
impl LeaderboardContract {
    /// Initialize the leaderboard contract with an admin.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Authorized(admin), &true);
        Ok(())
    }

    /// Authorize or deauthorize an address (e.g., a game contract) to submit scores.
    pub fn set_authorized(
        env: Env,
        admin: Address,
        addr: Address,
        auth: bool,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;

        env.storage()
            .instance()
            .set(&DataKey::Authorized(addr), &auth);
        Ok(())
    }

    /// Set a game's active status.
    pub fn set_game_active(
        env: Env,
        admin: Address,
        game_id: Symbol,
        active: bool,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;

        env.storage()
            .instance()
            .set(&DataKey::GameActive(game_id.clone()), &active);
        GameStatusChanged { game_id, active }.publish(&env);
        Ok(())
    }

    /// Submit a score for a player in a game.
    /// Only authorized callers can submit scores.
    pub fn submit_score(
        env: Env,
        caller: Address,
        player: Address,
        game_id: Symbol,
        score: u64,
    ) -> Result<(), Error> {
        caller.require_auth();

        // Check authorization
        if !env
            .storage()
            .instance()
            .get(&DataKey::Authorized(caller))
            .unwrap_or(false)
        {
            return Err(Error::NotAuthorized);
        }

        // Check if game is active
        if !env
            .storage()
            .instance()
            .get(&DataKey::GameActive(game_id.clone()))
            .unwrap_or(false)
        {
            return Err(Error::GameNotFound);
        }

        let score_key = DataKey::PlayerScore(game_id.clone(), player.clone());
        let current_score: u64 = env.storage().persistent().get(&score_key).unwrap_or(0);

        // Only update if the new score is higher
        if score > current_score {
            env.storage().persistent().set(&score_key, &score);
            env.storage().persistent().extend_ttl(
                &score_key,
                PERSISTENT_BUMP_LEDGERS,
                PERSISTENT_BUMP_LEDGERS,
            );

            ScoreSubmitted {
                game_id: game_id.clone(),
                player: player.clone(),
                score,
            }
            .publish(&env);

            // Automatically update rankings if the score is high enough
            update_leaderboard_internal(&env, &game_id, player, score)?;
        }

        Ok(())
    }

    /// Explicitly request a ranking update for a game.
    /// In this implementation, it's mostly a placeholder as submit_score handles it,
    /// but can be used to re-validate the top list.
    pub fn update_rankings(env: Env, game_id: Symbol) -> Result<(), Error> {
        // Placeholder for batch updates or re-sorting if needed.
        // Currently, submit_score keeps it sorted.
        LeaderboardUpdated { game_id }.publish(&env);
        Ok(())
    }

    /// Get the top players for a game, up to a certain limit.
    pub fn top_players(env: Env, game_id: Symbol, limit: u32) -> Result<Vec<ScoreEntry>, Error> {
        if limit == 0 || limit > MAX_LEADERBOARD_SIZE {
            return Err(Error::InvalidLimit);
        }

        let leaderboard: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::Leaderboard(game_id))
            .unwrap_or(Vec::new(&env));

        let mut result = Vec::new(&env);
        let actual_limit = if limit < leaderboard.len() {
            limit
        } else {
            leaderboard.len()
        };

        for i in 0..actual_limit {
            result.push_back(leaderboard.get_unchecked(i));
        }

        Ok(result)
    }

    /// Get the rank of a player in a specific game (1-indexed).
    /// Returns 0 if player is not in the top leaderboard.
    pub fn player_rank(env: Env, game_id: Symbol, player: Address) -> Result<u32, Error> {
        let leaderboard: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::Leaderboard(game_id))
            .unwrap_or(Vec::new(&env));

        for i in 0..leaderboard.len() {
            if leaderboard.get_unchecked(i).player == player {
                return Ok(i + 1);
            }
        }

        Ok(0)
    }

    /// Get a player's raw score.
    pub fn get_player_score(env: Env, game_id: Symbol, player: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::PlayerScore(game_id, player))
            .unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != &admin {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

fn update_leaderboard_internal(
    env: &Env,
    game_id: &Symbol,
    player: Address,
    score: u64,
) -> Result<(), Error> {
    let leaderboard_key = DataKey::Leaderboard(game_id.clone());
    let mut leaderboard: Vec<ScoreEntry> = env
        .storage()
        .persistent()
        .get(&leaderboard_key)
        .unwrap_or(Vec::new(env));

    // Remove existing entry for the player if present
    let mut existing_index: Option<u32> = None;
    for i in 0..leaderboard.len() {
        if leaderboard.get_unchecked(i).player == player {
            existing_index = Some(i);
            break;
        }
    }

    if let Some(idx) = existing_index {
        leaderboard.remove(idx);
    }

    // Binary search/Insertion sort
    let mut inserted = false;
    for i in 0..leaderboard.len() {
        if score > leaderboard.get_unchecked(i).score {
            leaderboard.insert(
                i,
                ScoreEntry {
                    player: player.clone(),
                    score,
                },
            );
            inserted = true;
            break;
        }
    }

    if !inserted && leaderboard.len() < MAX_LEADERBOARD_SIZE {
        leaderboard.push_back(ScoreEntry {
            player: player.clone(),
            score,
        });
    }

    // Truncate if exceeded max size
    while leaderboard.len() > MAX_LEADERBOARD_SIZE {
        leaderboard.pop_back();
    }

    env.storage()
        .persistent()
        .set(&leaderboard_key, &leaderboard);
    env.storage().persistent().extend_ttl(
        &leaderboard_key,
        PERSISTENT_BUMP_LEDGERS,
        PERSISTENT_BUMP_LEDGERS,
    );

    LeaderboardUpdated {
        game_id: game_id.clone(),
    }
    .publish(env);

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
