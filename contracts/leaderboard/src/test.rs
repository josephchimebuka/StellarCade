#![cfg(test)]

use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (LeaderboardContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(LeaderboardContract, ());
    let client = LeaderboardContractClient::new(env, &contract_id);
    client.init(&admin);
    (client, admin)
}

#[test]
fn test_init() {
    let env = Env::default();
    let (_, _admin) = setup(&env);
}

#[test]
fn test_submit_score() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let player = Address::generate(&env);
    let game_id = symbol_short!("game1");

    env.mock_all_auths();
    client.set_game_active(&admin, &game_id, &true);

    // Auth admin to submit scores
    client.set_authorized(&admin, &admin, &true);

    client.submit_score(&admin, &player, &game_id, &100);
    assert_eq!(client.get_player_score(&game_id, &player), 100);

    // Rank should be 1
    assert_eq!(client.player_rank(&game_id, &player), 1);

    // Top players should include this player
    let top = client.top_players(&game_id, &10);
    assert_eq!(top.len(), 1);
    assert_eq!(top.get(0).unwrap().player, player);
    assert_eq!(top.get(0).unwrap().score, 100);
}

#[test]
fn test_multiple_scores() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let game_id = symbol_short!("game1");

    env.mock_all_auths();
    client.set_game_active(&admin, &game_id, &true);
    client.set_authorized(&admin, &admin, &true);

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);

    client.submit_score(&admin, &p1, &game_id, &100);
    client.submit_score(&admin, &p2, &game_id, &200);
    client.submit_score(&admin, &p3, &game_id, &150);

    let top = client.top_players(&game_id, &10);
    assert_eq!(top.len(), 3);
    assert_eq!(top.get(0).unwrap().player, p2); // 200
    assert_eq!(top.get(1).unwrap().player, p3); // 150
    assert_eq!(top.get(2).unwrap().player, p1); // 100

    assert_eq!(client.player_rank(&game_id, &p2), 1);
    assert_eq!(client.player_rank(&game_id, &p3), 2);
    assert_eq!(client.player_rank(&game_id, &p1), 3);
}

#[test]
fn test_update_score() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let game_id = symbol_short!("game1");
    let player = Address::generate(&env);

    env.mock_all_auths();
    client.set_game_active(&admin, &game_id, &true);
    client.set_authorized(&admin, &admin, &true);

    client.submit_score(&admin, &player, &game_id, &50);
    assert_eq!(client.player_rank(&game_id, &player), 1);

    client.submit_score(&admin, &player, &game_id, &150);
    assert_eq!(client.get_player_score(&game_id, &player), 150);

    // Score should not decrease
    client.submit_score(&admin, &player, &game_id, &100);
    assert_eq!(client.get_player_score(&game_id, &player), 150);
}

#[test]
fn test_unauthorized_submit() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let game_id = symbol_short!("game1");
    let player = Address::generate(&env);
    let intruder = Address::generate(&env);

    env.mock_all_auths();
    client.set_game_active(&admin, &game_id, &true);

    let result = client.try_submit_score(&intruder, &player, &game_id, &500);
    assert_eq!(result.is_err(), true);
}

#[test]
fn test_inactive_game() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let game_id = symbol_short!("game1");
    let player = Address::generate(&env);

    env.mock_all_auths();
    client.set_authorized(&admin, &admin, &true);

    let result = client.try_submit_score(&admin, &player, &game_id, &500);
    assert_eq!(result, Err(Ok(Error::GameNotFound)));
}
