//! Unit tests for Cross-Contract Handler.
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, Symbol};

fn setup(
    env: &Env,
) -> (
    CrossContractHandlerClient<'_>,
    Address,
    Address,
    Address,
    Address,
) {
    let admin = Address::generate(env);
    let registry = Address::generate(env);
    let source = Address::generate(env);
    let target = Address::generate(env);
    let contract_id = env.register(CrossContractHandler, ());
    let client = CrossContractHandlerClient::new(env, &contract_id);
    env.mock_all_auths();
    client.init(&admin, &registry);
    (client, admin, registry, source, target)
}

#[test]
fn test_init_succeeds() {
    let env = Env::default();
    let (_, _, _, _, _) = setup(&env);
}

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let (client, admin, registry, _, _) = setup(&env);
    env.mock_all_auths();
    let result = client.try_init(&admin, &registry);
    assert!(result.is_err());
}

#[test]
fn test_register_route_returns_route_id() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(
        &admin,
        &source,
        &target,
        &Symbol::new(&env, "handle"),
    );
    assert_eq!(route_id, 1);
}

#[test]
fn test_register_route_increments_route_id() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let s2 = Address::generate(&env);
    let t2 = Address::generate(&env);
    let id1 = client.register_route(&admin, &source, &target, &Symbol::new(&env, "a"));
    let id2 = client.register_route(&admin, &s2, &t2, &Symbol::new(&env, "b"));
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_get_route_returns_registered_route() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let selector = Symbol::new(&env, "handle");
    let route_id = client.register_route(&admin, &source, &target, &selector);
    let route = client.get_route(&route_id);
    assert_eq!(route.source_contract, source);
    assert_eq!(route.target_contract, target);
    assert_eq!(route.selector, selector);
}

#[test]
fn test_get_route_not_found() {
    let env = Env::default();
    let (client, _, _, _, _) = setup(&env);
    let result = client.try_get_route(&999);
    assert!(result.is_err());
}

#[test]
fn test_dispatch_by_source_succeeds() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(&admin, &source, &target, &Symbol::new(&env, "handle"));
    let request_id = Symbol::new(&env, "req1");
    let payload = Bytes::from_slice(&env, &[1, 2, 3]);
    client.dispatch(&source, &request_id, &route_id, &payload);
}

#[test]
fn test_dispatch_by_admin_succeeds() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(&admin, &source, &target, &Symbol::new(&env, "handle"));
    let request_id = Symbol::new(&env, "req1");
    let payload = Bytes::from_slice(&env, &[1, 2, 3]);
    client.dispatch(&admin, &request_id, &route_id, &payload);
}

#[test]
fn test_dispatch_duplicate_request_id_rejected() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(&admin, &source, &target, &Symbol::new(&env, "handle"));
    let request_id = Symbol::new(&env, "req1");
    let payload = Bytes::from_slice(&env, &[1, 2, 3]);
    client.dispatch(&source, &request_id, &route_id, &payload);
    let result = client.try_dispatch(&source, &request_id, &route_id, &payload);
    assert!(result.is_err());
}

#[test]
fn test_acknowledge_by_target_succeeds() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(&admin, &source, &target, &Symbol::new(&env, "handle"));
    let request_id = Symbol::new(&env, "req1");
    let payload = Bytes::from_slice(&env, &[1, 2, 3]);
    client.dispatch(&source, &request_id, &route_id, &payload);
    let result = Bytes::from_slice(&env, &[4, 5, 6]);
    client.acknowledge(&target, &request_id, &result);
}

#[test]
fn test_acknowledge_already_acknowledged_rejected() {
    let env = Env::default();
    let (client, admin, _, source, target) = setup(&env);
    env.mock_all_auths();
    let route_id = client.register_route(&admin, &source, &target, &Symbol::new(&env, "handle"));
    let request_id = Symbol::new(&env, "req1");
    let payload = Bytes::from_slice(&env, &[1, 2, 3]);
    client.dispatch(&source, &request_id, &route_id, &payload);
    let result = Bytes::from_slice(&env, &[4, 5, 6]);
    client.acknowledge(&target, &request_id, &result);
    let result2 = client.try_acknowledge(&target, &request_id, &result);
    assert!(result2.is_err());
}

#[test]
fn test_register_route_same_source_target_rejected() {
    let env = Env::default();
    let (client, admin, _, source, _) = setup(&env);
    env.mock_all_auths();
    let result = client.try_register_route(&admin, &source, &source, &Symbol::new(&env, "handle"));
    assert!(result.is_err());
}
