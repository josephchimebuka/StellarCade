use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use stellarcade_treasury::{Treasury, TreasuryClient};

#[contract]
struct Receiver;

#[contractimpl]
impl Receiver {
    pub fn ping() -> u32 {
        1
    }
}

fn create_token<'a>(env: &'a Env, token_admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = StellarAssetClient::new(env, &token_contract.address());
    (token_contract.address(), token_client)
}

#[test]
fn test_allocate_to_contract_address_integration() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token_addr, token_sac) = create_token(&env, &token_admin);

    let treasury_id = env.register(Treasury, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    let receiver_id = env.register(Receiver, ());
    let receiver_addr = receiver_id.clone();

    env.mock_all_auths();
    treasury.init(&admin, &token_addr);

    token_sac.mint(&funder, &10_000i128);
    treasury.deposit(&funder, &2_500i128, &symbol_short!("fundit"));
    treasury.allocate(&receiver_addr, &900i128, &symbol_short!("game01"));

    let token = TokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&receiver_addr), 900);

    let state = treasury.treasury_state();
    assert_eq!(state.available_balance, 1_600);
    assert_eq!(state.total_deposited, 2_500);
    assert_eq!(state.total_allocated, 900);
}
