//! Stellarcade Coin Flip Contract
//!
//! Implements the classic 50/50 game logic.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct CoinFlip;

#[contractimpl]
impl CoinFlip {
    /// Play the coin flip game.
    pub fn play(_env: Env, player: Address, _amount: i128, _choice: u32, _seed: BytesN<32>) {
        player.require_auth();
        // TODO: Call PrizePool to lock/deposit amount
        // TODO: Call RandomGenerator to get result
        // TODO: Determine if choice (0 or 1) matches result
        // TODO: If win, call PrizePool to pay out win amount
        // TODO: Emit CoinFlipResult event
    }

    /// View previous game result for verification.
    pub fn get_game_result(_env: Env, _game_id: u32) -> u32 {
        // TODO: Retrieve result from storage
        0
    }
}
