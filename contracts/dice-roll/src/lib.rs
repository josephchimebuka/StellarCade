//! Stellarcade Dice Roll Contract
//!
//! A dice betting game integrated with the Random Generator contract.
//! Players predict a face (1–6), place a wager, and an oracle resolves
//! the outcome via the RNG contract's request/fulfill model.
//!
//! ## Game Flow
//! 1. Player calls `roll` → tokens transfer in, RNG requested, game stored.
//! 2. Oracle fulfills randomness on the RNG contract (off-chain step).
//! 3. Anyone calls `resolve_roll` → reads RNG result, settles payout.
//!
//! ## Payout
//! A correct prediction pays `6 * wager - fee`, where the fee is
//! `wager * house_edge_bps / 10000` applied to the winnings portion
//! (5 * wager). For example, at 250 bps (2.5%) and a 100-token wager,
//! winnings = 500, fee = 500 * 250 / 10000 = 12, payout = 600 - 12 = 588.
//!
//! ## House Edge
//! Configured at init via `house_edge_bps` (basis points). Applied only
//! to the profit portion of a winning bet (5 * wager).
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

/// Die faces: 1–6. RNG result is 0–5, mapped to face by adding 1.
pub const MIN_FACE: u32 = 1;
pub const MAX_FACE: u32 = 6;
/// Number of sides on the die — used as the RNG max bound.
pub const DIE_SIDES: u64 = 6;
/// Payout multiplier (before house edge deduction).
const PAYOUT_MULTIPLIER: i128 = 6;

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
    InvalidPrediction   = 5,
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
pub struct Roll {
    pub player: Address,
    pub prediction: u32,
    pub wager: i128,
    pub resolved: bool,
    pub won: bool,
    pub result: u32,
    pub payout: i128,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct RollPlaced {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub prediction: u32,
    pub wager: i128,
}

#[contractevent]
pub struct RollResolved {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub result: u32,
    pub won: bool,
    pub payout: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DiceRoll;

#[contractimpl]
impl DiceRoll {
    /// Initialize the dice roll game.
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

    /// Player places a dice roll bet. Tokens are transferred into the contract.
    /// A randomness request is submitted to the RNG contract.
    ///
    /// `prediction`: the die face the player predicts (1–6).
    pub fn roll(
        env: Env,
        player: Address,
        prediction: u32,
        wager: i128,
        game_id: u64,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        player.require_auth();

        if prediction < MIN_FACE || prediction > MAX_FACE {
            return Err(Error::InvalidPrediction);
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

        // Request randomness: max=6 gives result 0–5
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        RandomGeneratorClient::new(&env, &rng_addr).request_random(
            &env.current_contract_address(),
            &game_id,
            &DIE_SIDES,
        );

        // Store game state
        let roll = Roll {
            player: player.clone(),
            prediction,
            wager,
            resolved: false,
            won: false,
            result: 0,
            payout: 0,
        };
        env.storage().persistent().set(&game_key, &roll);
        env.storage()
            .persistent()
            .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        RollPlaced { game_id, player, prediction, wager }.publish(&env);
        Ok(())
    }

    /// Resolve a game after the oracle has fulfilled the RNG request.
    /// Anyone can call this — no auth needed since the outcome is deterministic.
    pub fn resolve_roll(env: Env, game_id: u64) -> Result<(), Error> {
        require_initialized(&env)?;

        let game_key = DataKey::Game(game_id);
        let mut roll: Roll = env
            .storage()
            .persistent()
            .get(&game_key)
            .ok_or(Error::GameNotFound)?;

        if roll.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        // Read RNG result
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        let rng_client = RandomGeneratorClient::new(&env, &rng_addr);
        let fulfilled = rng_client.try_get_result(&game_id);
        let entry = match fulfilled {
            Ok(Ok(e)) => e,
            _ => return Err(Error::RngNotFulfilled),
        };

        // RNG result is 0–5; die face is 1–6
        let die_face = (entry.result as u32) + 1;
        let won = die_face == roll.prediction;

        let mut payout = 0i128;
        if won {
            let house_edge_bps: i128 =
                env.storage().instance().get(&DataKey::HouseEdgeBps).unwrap();
            // Winnings = (PAYOUT_MULTIPLIER - 1) * wager (the profit portion)
            // Fee = winnings * house_edge_bps / 10000
            // Payout = PAYOUT_MULTIPLIER * wager - fee
            let winnings = roll
                .wager
                .checked_mul(PAYOUT_MULTIPLIER - 1)
                .ok_or(Error::Overflow)?;
            let fee = winnings
                .checked_mul(house_edge_bps)
                .and_then(|v| v.checked_div(BASIS_POINTS_DIVISOR))
                .ok_or(Error::Overflow)?;
            payout = roll
                .wager
                .checked_mul(PAYOUT_MULTIPLIER)
                .and_then(|v| v.checked_sub(fee))
                .ok_or(Error::Overflow)?;

            // Update state before transfer (reentrancy-safe)
            roll.won = true;
            roll.result = die_face;
            roll.payout = payout;
            roll.resolved = true;
            env.storage().persistent().set(&game_key, &roll);
            env.storage()
                .persistent()
                .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

            let token = get_token(&env);
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &roll.player,
                &payout,
            );
        } else {
            roll.resolved = true;
            roll.won = false;
            roll.result = die_face;
            roll.payout = 0;
            env.storage().persistent().set(&game_key, &roll);
            env.storage()
                .persistent()
                .extend_ttl(&game_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
        }

        RollResolved {
            game_id,
            player: roll.player,
            result: die_face,
            won,
            payout,
        }
        .publish(&env);

        Ok(())
    }

    /// View a roll's state.
    pub fn get_roll(env: Env, game_id: u64) -> Result<Roll, Error> {
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
        .expect("DiceRoll: token not set")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
