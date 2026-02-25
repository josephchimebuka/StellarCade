//! Stellarcade Random Generator Contract
//!
//! Provides provably fair, bounded randomness for game contracts via a
//! two-phase request/fulfill model:
//!
//! 1. An authorized game contract calls `request_random`, registering a
//!    pending request with a caller address and an upper bound (`max`).
//! 2. The designated oracle calls `fulfill_random` with a `server_seed`.
//!    The result is computed deterministically as:
//!
//!      `sha256(server_seed || request_id_be_bytes)[0..8] % max`
//!
//!    and stored on-chain alongside the server seed so anyone can verify.
//!
//! ## Fairness Model
//! The oracle must publish `sha256(server_seed)` **before** a game round
//! begins (off-chain commitment). Once a request is submitted, the server
//! seed is fixed — the oracle cannot choose a seed after seeing the
//! request without breaking the pre-published commitment. After fulfillment,
//! any party can re-derive and verify the result using the stored seed:
//!
//!   `sha256(stored_server_seed || request_id_be)[0..8] % max == stored_result`
//!
//! ## Storage Strategy
//! - `instance()`: Admin, Oracle. Fixed contract-level config.
//! - `persistent()`: AuthorizedCaller entries, PendingRequest entries,
//!   FulfilledRequest entries — each a separate ledger entry with TTL
//!   bumped on every write so active requests never expire mid-game.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN,
    Env,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
/// Bumped on every persistent write so no request expires mid-game.
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    NotAuthorized      = 3,
    /// `max < 2` — a range of [0, 0] produces no randomness.
    InvalidBound       = 4,
    /// A request with this `request_id` already exists (pending or fulfilled).
    DuplicateRequestId = 5,
    RequestNotFound    = 6,
    /// `fulfill_random` was called a second time for the same `request_id`.
    AlreadyFulfilled   = 7,
    /// The `caller` passed to `request_random` is not in the whitelist.
    UnauthorizedCaller = 8,
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

/// All storage key discriminants.
///
/// Instance keys (Admin, Oracle): contract config, small fixed set.
/// Persistent keys: per-caller whitelist entries, per-request data.
#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Oracle,
    // --- persistent() ---
    /// Presence flag for whitelisted game contract addresses.
    AuthorizedCaller(Address),
    /// A pending randomness request, awaiting oracle fulfillment.
    PendingRequest(u64),
    /// A fulfilled request with its result and seed stored for verification.
    FulfilledRequest(u64),
}

/// A pending randomness request registered by an authorized game contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingEntry {
    pub caller: Address,
    pub max: u64,
}

/// A fulfilled request with its deterministic result and the oracle seed.
///
/// Both `server_seed` and `result` are stored on-chain so any external party
/// can verify correctness without trusting the oracle's off-chain claims.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FulfilledEntry {
    pub caller: Address,
    pub max: u64,
    /// Oracle-provided seed; stored to allow on-chain result verification.
    pub server_seed: BytesN<32>,
    /// `sha256(server_seed || request_id_be)[0..8] % max`; always in `[0, max)`.
    pub result: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct RandomRequested {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub caller: Address,
    pub max: u64,
}

/// Emits the server_seed so off-chain verifiers do not need a `get_result` call.
#[contractevent]
pub struct RandomFulfilled {
    #[topic]
    pub request_id: u64,
    pub result: u64,
    pub server_seed: BytesN<32>,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct RandomGenerator;

#[contractimpl]
impl RandomGenerator {
    // -----------------------------------------------------------------------
    // init
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    ///
    /// `oracle` is the sole address permitted to call `fulfill_random`. It is
    /// expected to be a backend service that pre-commits server seeds off-chain
    /// before each game round begins.
    pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // authorize / revoke
    // -----------------------------------------------------------------------

    /// Add a game contract to the caller whitelist. Admin only.
    pub fn authorize(env: Env, admin: Address, caller: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        let key = DataKey::AuthorizedCaller(caller);
        env.storage().persistent().set(&key, &());
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        Ok(())
    }

    /// Remove a game contract from the caller whitelist. Admin only.
    pub fn revoke(env: Env, admin: Address, caller: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedCaller(caller));

        Ok(())
    }

    // -----------------------------------------------------------------------
    // request_random
    // -----------------------------------------------------------------------

    /// Submit a randomness request. Only whitelisted callers may call this.
    ///
    /// `max` must be >= 2. The fulfilled result will be in `[0, max - 1]`.
    /// `request_id` must be globally unique — rejected if a pending or
    /// fulfilled entry for the same ID already exists.
    pub fn request_random(
        env: Env,
        caller: Address,
        request_id: u64,
        max: u64,
    ) -> Result<(), Error> {
        require_initialized(&env)?;

        if max < 2 {
            return Err(Error::InvalidBound);
        }

        caller.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::AuthorizedCaller(caller.clone()))
        {
            return Err(Error::UnauthorizedCaller);
        }

        // Block reuse of any request_id, pending or fulfilled, to prevent
        // a game contract from submitting a duplicate after its first result.
        if env.storage().persistent().has(&DataKey::PendingRequest(request_id))
            || env
                .storage()
                .persistent()
                .has(&DataKey::FulfilledRequest(request_id))
        {
            return Err(Error::DuplicateRequestId);
        }

        let entry = PendingEntry { caller: caller.clone(), max };
        let key = DataKey::PendingRequest(request_id);
        env.storage().persistent().set(&key, &entry);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        RandomRequested { request_id, caller, max }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // fulfill_random
    // -----------------------------------------------------------------------

    /// Fulfill a pending randomness request. Oracle only.
    ///
    /// The result is derived as:
    ///   `sha256(server_seed || request_id_be_bytes)[0..8] % max`
    ///
    /// Both `server_seed` and `result` are persisted for on-chain verification.
    /// Fairness holds when the oracle published `sha256(server_seed)` before
    /// the corresponding `request_random` call was submitted.
    pub fn fulfill_random(
        env: Env,
        oracle: Address,
        request_id: u64,
        server_seed: BytesN<32>,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        require_oracle(&env, &oracle)?;

        // Each request_id can be fulfilled exactly once.
        if env
            .storage()
            .persistent()
            .has(&DataKey::FulfilledRequest(request_id))
        {
            return Err(Error::AlreadyFulfilled);
        }

        let pending_key = DataKey::PendingRequest(request_id);
        let pending: PendingEntry = env
            .storage()
            .persistent()
            .get(&pending_key)
            .ok_or(Error::RequestNotFound)?;

        let result = derive_result(&env, &server_seed, request_id, pending.max);

        // Remove the pending entry; write the fulfilled entry.
        env.storage().persistent().remove(&pending_key);

        let fulfilled = FulfilledEntry {
            caller: pending.caller,
            max: pending.max,
            server_seed: server_seed.clone(),
            result,
        };
        let fulfilled_key = DataKey::FulfilledRequest(request_id);
        env.storage().persistent().set(&fulfilled_key, &fulfilled);
        env.storage()
            .persistent()
            .extend_ttl(&fulfilled_key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        RandomFulfilled { request_id, result, server_seed }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // get_result
    // -----------------------------------------------------------------------

    /// Return the fulfilled result for a `request_id`.
    ///
    /// Returns `RequestNotFound` if the request is still pending or never existed.
    pub fn get_result(env: Env, request_id: u64) -> Result<FulfilledEntry, Error> {
        require_initialized(&env)?;

        env.storage()
            .persistent()
            .get(&DataKey::FulfilledRequest(request_id))
            .ok_or(Error::RequestNotFound)
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

fn require_oracle(env: &Env, caller: &Address) -> Result<(), Error> {
    let oracle: Address = env
        .storage()
        .instance()
        .get(&DataKey::Oracle)
        .ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != &oracle {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

/// Derive a bounded random result from `server_seed` and `request_id`.
///
/// Constructs a 40-byte preimage:  server_seed (32 bytes) || request_id (8 bytes BE)
/// Takes SHA-256, interprets the first 8 bytes as a big-endian u64, and reduces
/// modulo `max`. Produces a value in `[0, max - 1]`.
///
/// Combining `server_seed` with `request_id` in the preimage ensures that
/// different requests fulfilled with the same seed produce different outputs,
/// preventing the oracle from reusing a single seed commitment across rounds.
fn derive_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
    // Build preimage on the stack to avoid heap allocation.
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&server_seed.to_array());
    preimage[32..].copy_from_slice(&request_id.to_be_bytes());

    let digest: BytesN<32> = env.crypto().sha256(&Bytes::from_slice(env, &preimage)).into();
    let arr = digest.to_array();
    let raw = u64::from_be_bytes([arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7]]);
    raw % max
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env};

    // ------------------------------------------------------------------
    // Test helpers
    // ------------------------------------------------------------------

    /// Register contract + init. Returns (client, admin, oracle, game_contract).
    fn setup(env: &Env) -> (RandomGeneratorClient<'_>, Address, Address, Address) {
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let game = Address::generate(env);

        let contract_id = env.register(RandomGenerator, ());
        let client = RandomGeneratorClient::new(env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &oracle);
        client.authorize(&admin, &game);

        (client, admin, oracle, game)
    }

    /// Re-derive the expected result using the same logic as `derive_result`,
    /// so the test is an independent cross-check of the on-chain computation.
    fn expected_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
        let mut preimage = [0u8; 40];
        preimage[..32].copy_from_slice(&server_seed.to_array());
        preimage[32..].copy_from_slice(&request_id.to_be_bytes());
        let digest: BytesN<32> =
            env.crypto().sha256(&Bytes::from_slice(env, &preimage)).into();
        let arr = digest.to_array();
        let raw = u64::from_be_bytes([
            arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
        ]);
        raw % max
    }

    fn seed(env: &Env, byte: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = byte;
        BytesN::from_array(env, &arr)
    }

    // ------------------------------------------------------------------
    // 1. Request creation stores a pending entry
    // ------------------------------------------------------------------

    #[test]
    fn test_request_creates_pending_entry() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        client.request_random(&game, &1u64, &6u64);

        // After request, result is not yet available.
        let result = client.try_get_result(&1u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 2. Valid fulfillment produces correct deterministic result
    // ------------------------------------------------------------------

    #[test]
    fn test_fulfill_deterministic_result() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 6u64;
        let request_id = 42u64;
        let server_seed = seed(&env, 0xAB);

        client.request_random(&game, &request_id, &max);
        client.fulfill_random(&oracle, &request_id, &server_seed);

        let entry = client.get_result(&request_id);
        let expected = expected_result(&env, &server_seed, request_id, max);

        assert_eq!(entry.result, expected);
        assert_eq!(entry.max, max);
        assert_eq!(entry.server_seed, server_seed);
    }

    // ------------------------------------------------------------------
    // 3. Duplicate request_id rejected (pending case)
    // ------------------------------------------------------------------

    #[test]
    fn test_duplicate_request_id_pending_rejected() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        client.request_random(&game, &1u64, &2u64);

        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 4. Duplicate request_id rejected (fulfilled case)
    // ------------------------------------------------------------------

    #[test]
    fn test_duplicate_request_id_fulfilled_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 1);
        client.request_random(&game, &1u64, &2u64);
        client.fulfill_random(&oracle, &1u64, &s);

        // Same ID cannot be requested again after fulfillment.
        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 5. Replay fulfillment rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_replay_fulfillment_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 2);
        client.request_random(&game, &1u64, &2u64);
        client.fulfill_random(&oracle, &1u64, &s);

        // Second fulfill on the same request_id must fail.
        let result = client.try_fulfill_random(&oracle, &1u64, &s);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 6. Unauthorized caller (not in whitelist) rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_unauthorized_caller_rejected() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        env.mock_all_auths();

        let stranger = Address::generate(&env);
        let result = client.try_request_random(&stranger, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 7. Non-oracle cannot fulfill
    // ------------------------------------------------------------------

    #[test]
    fn test_unauthorized_fulfill_rejected() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 3);
        client.request_random(&game, &1u64, &2u64);

        let impostor = Address::generate(&env);
        let result = client.try_fulfill_random(&impostor, &1u64, &s);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 8. Output always falls within [0, max - 1]
    // ------------------------------------------------------------------

    #[test]
    fn test_result_always_in_range() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 6u64; // simulates a six-sided die

        for i in 0u64..20 {
            let s = seed(&env, i as u8);
            client.request_random(&game, &i, &max);
            client.fulfill_random(&oracle, &i, &s);
            let entry = client.get_result(&i);
            assert!(entry.result < max, "result {} out of range [0, {})", entry.result, max);
        }
    }

    // ------------------------------------------------------------------
    // 9. Different seeds produce varying results (smoke test for bias)
    // ------------------------------------------------------------------

    #[test]
    fn test_different_seeds_produce_varied_results() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 1_000_000u64;
        let mut results = [0u64; 8];

        for i in 0u64..8 {
            let s = seed(&env, (i * 37) as u8); // spread out seed bytes
            client.request_random(&game, &i, &max);
            client.fulfill_random(&oracle, &i, &s);
            results[i as usize] = client.get_result(&i).result;
        }

        // All 8 results should be distinct. With max=1_000_000 and only 8
        // samples a collision would indicate a broken hash function.
        for i in 0..8 {
            for j in (i + 1)..8 {
                assert_ne!(results[i], results[j], "collision at indices {} and {}", i, j);
            }
        }
    }

    // ------------------------------------------------------------------
    // 10. Fulfill non-existent request rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_fulfill_nonexistent_request_rejected() {
        let env = Env::default();
        let (client, _, oracle, _) = setup(&env);
        env.mock_all_auths();

        let result = client.try_fulfill_random(&oracle, &99u64, &seed(&env, 0));
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 11. Invalid bound (max < 2) rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_invalid_bound_rejected() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        assert!(client.try_request_random(&game, &1u64, &0u64).is_err());
        assert!(client.try_request_random(&game, &2u64, &1u64).is_err());
    }

    // ------------------------------------------------------------------
    // 12. Revoked caller can no longer request
    // ------------------------------------------------------------------

    #[test]
    fn test_revoked_caller_rejected() {
        let env = Env::default();
        let (client, admin, _, game) = setup(&env);
        env.mock_all_auths();

        client.revoke(&admin, &game);

        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 13. get_result on pending request returns error
    // ------------------------------------------------------------------

    #[test]
    fn test_get_result_while_pending_returns_error() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        client.request_random(&game, &1u64, &4u64);

        // Pending, not yet fulfilled — must return RequestNotFound.
        let result = client.try_get_result(&1u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 14. Re-init rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_reinit_rejected() {
        let env = Env::default();
        let (client, admin, oracle, _) = setup(&env);
        env.mock_all_auths();

        let result = client.try_init(&admin, &oracle);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 15. Multiple independent requests fulfilled correctly
    // ------------------------------------------------------------------

    #[test]
    fn test_multiple_requests_independent() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max_a = 2u64;
        let max_b = 100u64;
        let seed_a = seed(&env, 0x11);
        let seed_b = seed(&env, 0x22);

        client.request_random(&game, &10u64, &max_a);
        client.request_random(&game, &20u64, &max_b);

        client.fulfill_random(&oracle, &10u64, &seed_a);
        client.fulfill_random(&oracle, &20u64, &seed_b);

        let entry_a = client.get_result(&10u64);
        let entry_b = client.get_result(&20u64);

        assert!(entry_a.result < max_a);
        assert!(entry_b.result < max_b);
        assert_eq!(entry_a.result, expected_result(&env, &seed_a, 10, max_a));
        assert_eq!(entry_b.result, expected_result(&env, &seed_b, 20, max_b));
    }
}
