//! Stellarcade Coin Flip Contract
//!
//! A 50/50 betting game integrated with the Random Generator contract.
//! Players pick Heads (0) or Tails (1), place a wager, and an oracle
//! resolves the outcome via the RNG contract's request/fulfill model.
//!
//! ## Game Flow
//! 1. Player calls `place_bet` → tokens transfer in, RNG requested, game stored.
//! 2. Oracle fulfills randomness on the RNG contract (off-chain step).
//! 3. Anyone calls `resolve_bet` → reads RNG result, settles payout.
//!
//! ## House Edge
//! Configured at init via `house_edge_bps` (basis points). A 250 bps edge
//! means a winning bet on a 100-token wager pays 195 tokens (2x minus 5%).
//! The remaining 5 tokens stay in the contract as house profit.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient, Address,
    Env,
};

use stellarcade_random_generator::RandomGeneratorClient;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;
const BASIS_POINTS_DIVISOR: i128 = 10_000;

/// Heads = 0, Tails = 1. RNG result % 2 maps to this.
pub const HEADS: u32 = 0;
pub const TAILS: u32 = 1;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized  = 1,
    NotInitialized      = 2,
    NotAuthorized       = 3,
    InvalidAmount       = 4,
    InvalidSide         = 5,
    GameAlreadyExists   = 6,
    GameNotFound        = 7,
    GameAlreadyResolved = 8,
    RngNotFulfilled     = 9,
    WagerTooLow         = 10,
    WagerTooHigh        = 11,
    Overflow            = 12,
}

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    RngContract,
    MinWager,
    MaxWager,
    HouseEdgeBps,
    Game(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player: Address,
    pub side: u32,
    pub wager: i128,
    pub resolved: bool,
    pub won: bool,
    pub payout: i128,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct BetPlaced {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub side: u32,
    pub wager: i128,
}

#[contractevent]
pub struct BetResolved {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub won: bool,
    pub payout: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct CoinFlip;

#[contractimpl]
impl CoinFlip {
    /// Initialize the coin flip game.
    ///
    /// `house_edge_bps`: house edge in basis points (e.g., 250 = 2.5%).
    pub fn init(
        env: Env,
        admin: Address,
        rng_contract: Address,
        token: Address,
        min_wager: i128,
        max_wager: i128,
        house_edge_bps: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::RngContract, &rng_contract);
        env.storage().instance().set(&DataKey::MinWager, &min_wager);
        env.storage().instance().set(&DataKey::MaxWager, &max_wager);
        env.storage().instance().set(&DataKey::HouseEdgeBps, &house_edge_bps);
        Ok(())
    }

    /// Player places a bet. Tokens are transferred into the contract.
    /// A randomness request is submitted to the RNG contract.
    ///
    /// `side`: 0 = Heads, 1 = Tails.
    pub fn place_bet(
        env: Env,
        player: Address,
        side: u32,
        wager: i128,
        game_id: u64,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        player.require_auth();

        if side != HEADS && side != TAILS {
            return Err(Error::InvalidSide);
        }
        if wager <= 0 {
            return Err(Error::InvalidAmount);
        }

        let min_wager: i128 = env.storage().instance().get(&DataKey::MinWager).unwrap();
        let max_wager: i128 = env.storage().instance().get(&DataKey::MaxWager).unwrap();
        if wager < min_wager {
            return Err(Error::WagerTooLow);
        }
        if wager > max_wager {
            return Err(Error::WagerTooHigh);
        }

        let game_key = DataKey::Game(game_id);
        if env.storage().persistent().has(&game_key) {
            return Err(Error::GameAlreadyExists);
        }

        // Transfer tokens from player to this contract
        let token = get_token(&env);
        TokenClient::new(&env, &token).transfer(
            &player,
            env.current_contract_address(),
            &wager,
        );

        // Request randomness: max=2 gives result 0 or 1
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        RandomGeneratorClient::new(&env, &rng_addr).request_random(
            &env.current_contract_address(),
            &game_id,
            &2u64,
        );

        // Store game state
        let game = Game {
            player: player.clone(),
            side,
            wager,
            resolved: false,
            won: false,
            payout: 0,
        };
        env.storage().persistent().set(&game_key, &game);
        env.storage()
            .persistent()
            .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        BetPlaced { game_id, player, side, wager }.publish(&env);
        Ok(())
    }

    /// Resolve a game after the oracle has fulfilled the RNG request.
    /// Anyone can call this — no auth needed since the outcome is deterministic.
    pub fn resolve_bet(env: Env, game_id: u64) -> Result<(), Error> {
        require_initialized(&env)?;

        let game_key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&game_key)
            .ok_or(Error::GameNotFound)?;

        if game.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        // Read RNG result — panics if not yet fulfilled
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        let rng_client = RandomGeneratorClient::new(&env, &rng_addr);
        let fulfilled = rng_client.try_get_result(&game_id);
        let entry = match fulfilled {
            Ok(Ok(e)) => e,
            _ => return Err(Error::RngNotFulfilled),
        };

        let outcome = entry.result as u32; // 0 or 1
        let won = outcome == game.side;

        let mut payout = 0i128;
        if won {
            let house_edge_bps: i128 =
                env.storage().instance().get(&DataKey::HouseEdgeBps).unwrap();
            // Payout = 2 * wager - house edge on the winnings
            // Winnings = wager (the profit portion). Fee = winnings * edge / 10000.
            let fee = game
                .wager
                .checked_mul(house_edge_bps)
                .and_then(|v| v.checked_div(BASIS_POINTS_DIVISOR))
                .ok_or(Error::Overflow)?;
            payout = game
                .wager
                .checked_mul(2)
                .and_then(|v| v.checked_sub(fee))
                .ok_or(Error::Overflow)?;

            // Transfer winnings to player (state update before transfer for safety)
            game.won = true;
            game.payout = payout;
            game.resolved = true;
            env.storage().persistent().set(&game_key, &game);
            env.storage()
                .persistent()
                .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

            let token = get_token(&env);
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &game.player,
                &payout,
            );
        } else {
            game.resolved = true;
            game.won = false;
            game.payout = 0;
            env.storage().persistent().set(&game_key, &game);
            env.storage()
                .persistent()
                .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
        }

        BetResolved {
            game_id,
            player: game.player,
            won,
            payout,
        }
        .publish(&env);

        Ok(())
    }

    /// View a game's state.
    pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("CoinFlip: token not set")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
