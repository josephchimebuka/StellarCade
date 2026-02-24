//! Shared utilities and data structures for Stellarcade contracts.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{contracterror, contracttype, Address};

// ─── Common Error Codes ───────────────────────────────────────────────────────

/// Common error codes used across all contracts.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    InsufficientBalance = 2,
    InvalidAmount = 3,
    Overflow = 4,
}

// ─── Exploit-Prevention Error Codes ──────────────────────────────────────────

/// Granular error codes for the exploit-prevention contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ExploitError {
    // Authorization
    Unauthorized = 1,
    NotAdmin = 2,
    NotOracle = 3,

    // Replay / deduplication
    AlreadyProcessed = 10,
    NonceReused = 11,

    // Input validation
    InvalidInput = 20,
    AmountTooLow = 21,
    AmountTooHigh = 22,
    InvalidAddress = 23,
    StaleTimestamp = 24,

    // State machine
    InvalidStateTransition = 30,
    AlreadyInitialized = 31,
    NotInitialized = 32,
    ContractPaused = 33,

    // Arithmetic / accounting
    ArithmeticOverflow = 40,
    InsufficientBalance = 41,
    AccountingInvariantViolated = 42,

    // Randomness / oracle
    InvalidRngProof = 50,
    OracleDataTampered = 51,
    SettlementManipulated = 52,

    // Rate limiting
    RateLimitExceeded = 60,
}

// ─── Platform Config ──────────────────────────────────────────────────────────

/// A standard configuration for platform-wide settings.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    pub admin: Address,
    pub fee_percentage: u32, // In basis points (e.g., 250 = 2.5%)
}

// ─── Exploit-Prevention Structs ───────────────────────────────────────────────

/// Per-game and per-platform wager/timestamp bounds plus rate-limit settings.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundConfig {
    pub min_amount: i128,
    pub max_amount: i128,
    pub max_timestamp_delta: u64,
    pub rate_limit_window: u64,
    pub rate_limit_max_calls: u32,
}

/// Per-caller sliding-window rate-limit state stored in temporary storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateLimitEntry {
    pub window_start: u64,
    pub call_count: u32,
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

/// Storage keys shared across exploit-prevention and dependent contracts.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    ProcessedNonce(u64),
    ProcessedTxHash(soroban_sdk::Bytes),
    RateLimit(soroban_sdk::Address),
    Oracle,
    BoundConfig,
}

// ─── Fee Helpers ──────────────────────────────────────────────────────────────

/// Constant for basis points divisor.
pub const BASIS_POINTS_DIVISOR: u32 = 10_000;


pub fn calculate_fee(amount: i128, fee_bps: u32) -> Result<i128, Error> {
    if amount < 0 {
        return Err(Error::InvalidAmount);
    }
    if fee_bps > BASIS_POINTS_DIVISOR {
        return Err(Error::InvalidAmount);
    }
    amount
        .checked_mul(fee_bps as i128)
        .and_then(|v| v.checked_div(BASIS_POINTS_DIVISOR as i128))
        .ok_or(Error::Overflow)
}

// ─── Event Topic Helpers ─────────────────────────────────────────────────────

pub mod events {
    use soroban_sdk::{symbol_short, Symbol};

    pub fn initialized() -> Symbol {
        symbol_short!("init")
    }
    pub fn paused() -> Symbol {
        symbol_short!("paused")
    }
    pub fn unpaused() -> Symbol {
        symbol_short!("unpaused")
    }
    pub fn admin_changed() -> Symbol {
        symbol_short!("adm_chg")
    }
    pub fn replay_blocked() -> Symbol {
        symbol_short!("rply_blk")
    }
    pub fn bounds_violated() -> Symbol {
        symbol_short!("bnd_viol")
    }
    pub fn rate_limited() -> Symbol {
        symbol_short!("rt_lmt")
    }
    pub fn oracle_validated() -> Symbol {
        symbol_short!("orc_ok")
    }
    pub fn oracle_rejected() -> Symbol {
        symbol_short!("orc_rej")
    }
    pub fn rng_validated() -> Symbol {
        symbol_short!("rng_ok")
    }
    pub fn rng_rejected() -> Symbol {
        symbol_short!("rng_rej")
    }
    pub fn settlement_ok() -> Symbol {
        symbol_short!("stl_ok")
    }
    pub fn settlement_rejected() -> Symbol {
        symbol_short!("stl_rej")
    }
    pub fn bounds_updated() -> Symbol {
        symbol_short!("bnd_upd")
    }
}