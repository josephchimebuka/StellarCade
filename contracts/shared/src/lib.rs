//! Shared utilities and data structures for Stellarcade contracts.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{contracttype, Address};

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

/// A standard configuration for platform-wide settings.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    pub admin: Address,
    pub fee_percentage: u32, // In basis points (e.g., 250 = 2.5%)
}

/// Constant for basis points divisor.
pub const BASIS_POINTS_DIVISOR: u32 = 10_000;

/// Helper to calculate fee based on amount and basis points.
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
