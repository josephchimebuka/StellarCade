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
    dice_client: DiceRollClient<'a>,
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

    // Deploy DiceRoll
    let dice_id = env.register(DiceRoll, ());
    let dice_client = DiceRollClient::new(env, &dice_id);

    env.mock_all_auths();

    // Init RNG and authorize dice roll as a caller
    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &dice_id);

    // Init DiceRoll: min=10, max=1000, house edge 250 bps (2.5%)
    dice_client.init(&admin, &rng_id, &token_addr, &10i128, &1000i128, &250i128);

    // Fund the contract so it can pay out winners
    token_sac.mint(&dice_id, &100_000i128);

    Setup {
        dice_client,
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

/// Reproduce the RNG derivation to find seeds that produce desired outcomes.
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

/// Find a seed byte that produces the desired die face (1–6) for a given request_id.
fn find_seed_for_face(env: &Env, request_id: u64, desired_face: u32) -> BytesN<32> {
    for i in 0u8..=255 {
        let test_seed = seed(env, i);
        let rng_result = derive_rng_result(env, &test_seed, request_id, DIE_SIDES);
        if (rng_result as u32) + 1 == desired_face {
            return test_seed;
        }
    }
    panic!("Could not find a seed for face {} at request_id {}", desired_face, request_id);
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
    let result = s.dice_client.try_init(&s.admin, &rng, &tok, &10, &1000, &250);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 2. Place roll happy path
// -------------------------------------------------------------------

#[test]
fn test_roll_stores_game() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &3u32, &100, &1u64);

    let roll = s.dice_client.get_roll(&1u64);
    assert_eq!(roll.player, player);
    assert_eq!(roll.prediction, 3);
    assert_eq!(roll.wager, 100);
    assert!(!roll.resolved);
    assert!(!roll.won);
    assert_eq!(roll.result, 0);
    assert_eq!(roll.payout, 0);
}

#[test]
fn test_roll_transfers_wager_from_player() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &1u32, &100, &1u64);

    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
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

    let prediction = 4u32;
    let game_id = 1u64;

    s.dice_client.roll(&player, &prediction, &100, &game_id);

    // Find a seed that produces die face = prediction
    let winning_seed = find_seed_for_face(&env, game_id, prediction);
    s.rng_client.fulfill_random(&s.oracle, &game_id, &winning_seed);
    s.dice_client.resolve_roll(&game_id);

    let roll = s.dice_client.get_roll(&game_id);
    assert!(roll.resolved);
    assert!(roll.won);
    assert_eq!(roll.result, prediction);
    // Payout = 6 * 100 - (5 * 100 * 250 / 10000) = 600 - 12 = 588
    assert_eq!(roll.payout, 588);

    // Player: started 500, wagered 100, received 588 → 988
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 988);
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

    let prediction = 3u32;
    let game_id = 2u64;

    s.dice_client.roll(&player, &prediction, &100, &game_id);

    // Find a seed that does NOT produce the predicted face
    let mut losing_seed = seed(&env, 0);
    for i in 0u8..=255 {
        let test_seed = seed(&env, i);
        let rng_result = derive_rng_result(&env, &test_seed, game_id, DIE_SIDES);
        if (rng_result as u32) + 1 != prediction {
            losing_seed = test_seed;
            break;
        }
    }

    s.rng_client.fulfill_random(&s.oracle, &game_id, &losing_seed);
    s.dice_client.resolve_roll(&game_id);

    let roll = s.dice_client.get_roll(&game_id);
    assert!(roll.resolved);
    assert!(!roll.won);
    assert_eq!(roll.payout, 0);

    // Player lost their wager
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
}

// -------------------------------------------------------------------
// 5. All six faces are valid predictions
// -------------------------------------------------------------------

#[test]
fn test_all_faces_valid() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &10_000);

    for face in MIN_FACE..=MAX_FACE {
        let game_id = face as u64;
        s.dice_client.roll(&player, &face, &100, &game_id);
        let roll = s.dice_client.get_roll(&game_id);
        assert_eq!(roll.prediction, face);
    }
}

// -------------------------------------------------------------------
// 6. Invalid prediction rejected
// -------------------------------------------------------------------

#[test]
fn test_prediction_zero_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.dice_client.try_roll(&player, &0u32, &100, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_prediction_seven_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.dice_client.try_roll(&player, &7u32, &100, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_prediction_large_value_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.dice_client.try_roll(&player, &255u32, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 7. Duplicate game_id rejected
// -------------------------------------------------------------------

#[test]
fn test_duplicate_game_id_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &1u32, &100, &1u64);
    let result = s.dice_client.try_roll(&player, &5u32, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 8. Wager limits enforced
// -------------------------------------------------------------------

#[test]
fn test_wager_too_low_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.dice_client.try_roll(&player, &1u32, &5, &1u64); // min is 10
    assert!(result.is_err());
}

#[test]
fn test_wager_too_high_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5000);

    let result = s.dice_client.try_roll(&player, &1u32, &1001, &1u64); // max is 1000
    assert!(result.is_err());
}

#[test]
fn test_zero_wager_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    let result = s.dice_client.try_roll(&player, &1u32, &0, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_negative_wager_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    let result = s.dice_client.try_roll(&player, &1u32, &-50i128, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 9. Resolve before RNG fulfillment rejected
// -------------------------------------------------------------------

#[test]
fn test_resolve_before_rng_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &1u32, &100, &1u64);

    let result = s.dice_client.try_resolve_roll(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 10. Double resolution rejected
// -------------------------------------------------------------------

#[test]
fn test_double_resolve_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &1u32, &100, &1u64);

    let rng_seed = seed(&env, 42);
    s.rng_client.fulfill_random(&s.oracle, &1u64, &rng_seed);
    s.dice_client.resolve_roll(&1u64);

    let result = s.dice_client.try_resolve_roll(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 11. Game not found
// -------------------------------------------------------------------

#[test]
fn test_get_nonexistent_roll() {
    let env = Env::default();
    let s = setup(&env);

    let result = s.dice_client.try_get_roll(&99u64);
    assert!(result.is_err());
}

#[test]
fn test_resolve_nonexistent_roll() {
    let env = Env::default();
    let s = setup(&env);

    let result = s.dice_client.try_resolve_roll(&99u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 12. Multiple independent games
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

    s.dice_client.roll(&player1, &2u32, &100, &10u64);
    s.dice_client.roll(&player2, &5u32, &200, &20u64);

    let r1 = s.dice_client.get_roll(&10u64);
    let r2 = s.dice_client.get_roll(&20u64);
    assert_eq!(r1.player, player1);
    assert_eq!(r2.player, player2);
    assert_eq!(r1.prediction, 2);
    assert_eq!(r2.prediction, 5);
    assert_eq!(r1.wager, 100);
    assert_eq!(r2.wager, 200);
}

// -------------------------------------------------------------------
// 13. Die face mapping verification (RNG result 0–5 → face 1–6)
// -------------------------------------------------------------------

#[test]
fn test_die_face_mapping() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &100_000);

    // Test each possible RNG result maps to the correct face
    for target_face in 1u32..=6 {
        let game_id = (100 + target_face) as u64;
        s.dice_client.roll(&player, &target_face, &10, &game_id);

        let winning_seed = find_seed_for_face(&env, game_id, target_face);
        s.rng_client.fulfill_random(&s.oracle, &game_id, &winning_seed);
        s.dice_client.resolve_roll(&game_id);

        let roll = s.dice_client.get_roll(&game_id);
        assert_eq!(roll.result, target_face);
        assert!(roll.won);
    }
}

// -------------------------------------------------------------------
// 14. Payout arithmetic verification
// -------------------------------------------------------------------

#[test]
fn test_payout_math_250bps() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &10_000);

    let wager = 1000i128;
    let prediction = 2u32;
    let game_id = 50u64;

    s.dice_client.roll(&player, &prediction, &wager, &game_id);

    let winning_seed = find_seed_for_face(&env, game_id, prediction);
    s.rng_client.fulfill_random(&s.oracle, &game_id, &winning_seed);
    s.dice_client.resolve_roll(&game_id);

    let roll = s.dice_client.get_roll(&game_id);
    assert!(roll.won);
    // Winnings = 5 * 1000 = 5000
    // Fee = 5000 * 250 / 10000 = 125
    // Payout = 6 * 1000 - 125 = 5875
    assert_eq!(roll.payout, 5875);
}

// -------------------------------------------------------------------
// 15. Exact boundary wagers (min and max)
// -------------------------------------------------------------------

#[test]
fn test_exact_min_wager_accepted() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // min wager is 10
    s.dice_client.roll(&player, &1u32, &10, &1u64);
    let roll = s.dice_client.get_roll(&1u64);
    assert_eq!(roll.wager, 10);
}

#[test]
fn test_exact_max_wager_accepted() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5000);

    // max wager is 1000
    s.dice_client.roll(&player, &6u32, &1000, &1u64);
    let roll = s.dice_client.get_roll(&1u64);
    assert_eq!(roll.wager, 1000);
}

// -------------------------------------------------------------------
// 16. Win and loss alternate correctly across games
// -------------------------------------------------------------------

#[test]
fn test_win_then_loss() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5000);

    // Game 1: Win
    let prediction1 = 3u32;
    s.dice_client.roll(&player, &prediction1, &100, &1u64);
    let win_seed = find_seed_for_face(&env, 1u64, prediction1);
    s.rng_client.fulfill_random(&s.oracle, &1u64, &win_seed);
    s.dice_client.resolve_roll(&1u64);

    let r1 = s.dice_client.get_roll(&1u64);
    assert!(r1.won);

    // Game 2: Loss (predict something different from what the seed gives)
    let prediction2 = 2u32;
    s.dice_client.roll(&player, &prediction2, &100, &2u64);
    // Find a seed that does NOT produce face 2
    let mut lose_seed = seed(&env, 0);
    for i in 0u8..=255 {
        let test_seed = seed(&env, i);
        let rng_result = derive_rng_result(&env, &test_seed, 2u64, DIE_SIDES);
        if (rng_result as u32) + 1 != prediction2 {
            lose_seed = test_seed;
            break;
        }
    }
    s.rng_client.fulfill_random(&s.oracle, &2u64, &lose_seed);
    s.dice_client.resolve_roll(&2u64);

    let r2 = s.dice_client.get_roll(&2u64);
    assert!(!r2.won);
}

// -------------------------------------------------------------------
// 17. Minimum boundary face values (1 and 6)
// -------------------------------------------------------------------

#[test]
fn test_predict_face_1_win() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &1u32, &100, &1u64);
    let winning_seed = find_seed_for_face(&env, 1u64, 1);
    s.rng_client.fulfill_random(&s.oracle, &1u64, &winning_seed);
    s.dice_client.resolve_roll(&1u64);

    let roll = s.dice_client.get_roll(&1u64);
    assert!(roll.won);
    assert_eq!(roll.result, 1);
}

#[test]
fn test_predict_face_6_win() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.dice_client.roll(&player, &6u32, &100, &1u64);
    let winning_seed = find_seed_for_face(&env, 1u64, 6);
    s.rng_client.fulfill_random(&s.oracle, &1u64, &winning_seed);
    s.dice_client.resolve_roll(&1u64);

    let roll = s.dice_client.get_roll(&1u64);
    assert!(roll.won);
    assert_eq!(roll.result, 6);
}

// -------------------------------------------------------------------
// 18. Resolve result stored correctly for loss
// -------------------------------------------------------------------

#[test]
fn test_loss_stores_actual_result() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let prediction = 4u32;
    let game_id = 7u64;

    s.dice_client.roll(&player, &prediction, &100, &game_id);

    // Pick a seed that gives a known face different from prediction
    let target_face = if prediction == 1 { 2u32 } else { 1u32 };
    let losing_seed = find_seed_for_face(&env, game_id, target_face);

    s.rng_client.fulfill_random(&s.oracle, &game_id, &losing_seed);
    s.dice_client.resolve_roll(&game_id);

    let roll = s.dice_client.get_roll(&game_id);
    assert!(roll.resolved);
    assert!(!roll.won);
    assert_eq!(roll.result, target_face);
    assert_eq!(roll.payout, 0);
}
