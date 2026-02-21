#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use stellarcade_random_generator::{RandomGenerator, RandomGeneratorClient};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let client = StellarAssetClient::new(env, &contract.address());
    (contract.address(), client)
}

fn seed(env: &Env, byte: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = byte;
    BytesN::from_array(env, &arr)
}

struct Setup<'a> {
    flip_client: CoinFlipClient<'a>,
    rng_client: RandomGeneratorClient<'a>,
    admin: Address,
    oracle: Address,
    token_addr: Address,
    token_sac: StellarAssetClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let token_admin = Address::generate(env);

    let (token_addr, token_sac) = create_token(env, &token_admin);

    // Deploy RNG
    let rng_id = env.register(RandomGenerator, ());
    let rng_client = RandomGeneratorClient::new(env, &rng_id);

    // Deploy CoinFlip
    let flip_id = env.register(CoinFlip, ());
    let flip_client = CoinFlipClient::new(env, &flip_id);

    env.mock_all_auths();

    // Init RNG and authorize coin flip as a caller
    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &flip_id);

    // Init CoinFlip: min=10, max=1000, house edge 250 bps (2.5%)
    flip_client.init(&admin, &rng_id, &token_addr, &10i128, &1000i128, &250i128);

    // Fund the contract so it can pay out winners
    token_sac.mint(&flip_id, &100_000i128);

    Setup {
        flip_client,
        rng_client,
        admin,
        oracle,
        token_addr,
        token_sac,
    }
}

fn tc<'a>(env: &'a Env, token: &Address) -> TokenClient<'a> {
    TokenClient::new(env, token)
}

// -------------------------------------------------------------------
// 1. Initialization
// -------------------------------------------------------------------

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let rng = Address::generate(&env);
    let tok = Address::generate(&env);
    let result = s.flip_client.try_init(&s.admin, &rng, &tok, &10, &1000, &250);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 2. Place bet happy path
// -------------------------------------------------------------------

#[test]
fn test_place_bet_stores_game() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    let game = s.flip_client.get_game(&1u64);
    assert_eq!(game.player, player);
    assert_eq!(game.side, HEADS);
    assert_eq!(game.wager, 100);
    assert!(!game.resolved);
}

// -------------------------------------------------------------------
// 3. Resolve win path
// -------------------------------------------------------------------

#[test]
fn test_resolve_win() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // Place bet on Heads (0)
    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    // Fulfill RNG — we need to find a seed that gives result 0 (Heads)
    // result = sha256(seed || request_id)[0..8] % 2
    // Try seeds until we get 0
    let mut winning_seed = seed(&env, 0);
    for i in 0u8..=255 {
        let test_seed = seed(&env, i);
        let result = derive_rng_result(&env, &test_seed, 1u64, 2);
        if result == 0 {
            winning_seed = test_seed;
            break;
        }
    }

    s.rng_client.fulfill_random(&s.oracle, &1u64, &winning_seed);
    s.flip_client.resolve_bet(&1u64);

    let game = s.flip_client.get_game(&1u64);
    assert!(game.resolved);
    assert!(game.won);
    // Payout = 2 * 100 - (100 * 250 / 10000) = 200 - 2 = 198
    assert_eq!(game.payout, 198);

    // Player should have received payout
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598); // 500 - 100 + 198
}

// -------------------------------------------------------------------
// 4. Resolve loss path
// -------------------------------------------------------------------

#[test]
fn test_resolve_loss() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &2u64);

    // Find a seed that gives result 1 (Tails) — player bet Heads, so they lose
    let mut losing_seed = seed(&env, 0);
    for i in 0u8..=255 {
        let test_seed = seed(&env, i);
        let result = derive_rng_result(&env, &test_seed, 2u64, 2);
        if result == 1 {
            losing_seed = test_seed;
            break;
        }
    }

    s.rng_client.fulfill_random(&s.oracle, &2u64, &losing_seed);
    s.flip_client.resolve_bet(&2u64);

    let game = s.flip_client.get_game(&2u64);
    assert!(game.resolved);
    assert!(!game.won);
    assert_eq!(game.payout, 0);

    // Player lost their wager
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
}

// -------------------------------------------------------------------
// 5. Duplicate game_id rejected
// -------------------------------------------------------------------

#[test]
fn test_duplicate_game_id_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);
    let result = s.flip_client.try_place_bet(&player, &TAILS, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 6. Invalid side rejected
// -------------------------------------------------------------------

#[test]
fn test_invalid_side_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.flip_client.try_place_bet(&player, &2u32, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 7. Wager limits enforced
// -------------------------------------------------------------------

#[test]
fn test_wager_too_low_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.flip_client.try_place_bet(&player, &HEADS, &5, &1u64); // min is 10
    assert!(result.is_err());
}

#[test]
fn test_wager_too_high_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5000);

    let result = s.flip_client.try_place_bet(&player, &HEADS, &1001, &1u64); // max is 1000
    assert!(result.is_err());
}

#[test]
fn test_zero_wager_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    let result = s.flip_client.try_place_bet(&player, &HEADS, &0, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 8. Resolve before RNG fulfillment rejected
// -------------------------------------------------------------------

#[test]
fn test_resolve_before_rng_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    // Don't fulfill RNG — try to resolve
    let result = s.flip_client.try_resolve_bet(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 9. Double resolution rejected
// -------------------------------------------------------------------

#[test]
fn test_double_resolve_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    let rng_seed = seed(&env, 42);
    s.rng_client.fulfill_random(&s.oracle, &1u64, &rng_seed);
    s.flip_client.resolve_bet(&1u64);

    let result = s.flip_client.try_resolve_bet(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 10. Game not found
// -------------------------------------------------------------------

#[test]
fn test_get_nonexistent_game() {
    let env = Env::default();
    let s = setup(&env);

    let result = s.flip_client.try_get_game(&99u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 11. Multiple independent games
// -------------------------------------------------------------------

#[test]
fn test_multiple_games() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    s.token_sac.mint(&player1, &500);
    s.token_sac.mint(&player2, &500);

    s.flip_client.place_bet(&player1, &HEADS, &100, &10u64);
    s.flip_client.place_bet(&player2, &TAILS, &200, &20u64);

    let g1 = s.flip_client.get_game(&10u64);
    let g2 = s.flip_client.get_game(&20u64);
    assert_eq!(g1.player, player1);
    assert_eq!(g2.player, player2);
    assert_eq!(g1.wager, 100);
    assert_eq!(g2.wager, 200);
}

// -------------------------------------------------------------------
// Helper: reproduce RNG derivation for test seed selection
// -------------------------------------------------------------------

fn derive_rng_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
    use soroban_sdk::Bytes;
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&server_seed.to_array());
    preimage[32..].copy_from_slice(&request_id.to_be_bytes());
    let digest: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage))
        .into();
    let arr = digest.to_array();
    let raw =
        u64::from_be_bytes([arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7]]);
    raw % max
}
