//! Stellarcade Treasury Contract
//!
//! Core platform treasury for custody and controlled settlement of SEP-41
//! funds. Supports deposits from external funders and admin-authorized
//! allocations/releases to downstream contracts and recipients.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient,
    Address, Env, Symbol,
};

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    InsufficientFunds = 5,
    DuplicateOperation = 6,
    Overflow = 7,
    ContractPaused = 8,
    AlreadyPaused = 9,
    NotPaused = 10,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Paused,
    Available,
    TotalDeposited,
    TotalAllocated,
    TotalReleased,
    ProcessedDeposit(DepositOp),
    ProcessedAllocation(AllocateOp),
    ProcessedRelease(ReleaseOp),
}

#[contracttype]
#[derive(Clone)]
pub struct DepositOp {
    pub from: Address,
    pub reason: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct AllocateOp {
    pub to_contract: Address,
    pub purpose: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct ReleaseOp {
    pub to: Address,
    pub purpose: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryState {
    pub admin: Address,
    pub token_address: Address,
    pub paused: bool,
    pub available_balance: i128,
    pub total_deposited: i128,
    pub total_allocated: i128,
    pub total_released: i128,
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub token_address: Address,
}

#[contractevent]
pub struct Deposited {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub reason: Symbol,
}

#[contractevent]
pub struct Allocated {
    #[topic]
    pub to_contract: Address,
    pub amount: i128,
    pub purpose: Symbol,
}

#[contractevent]
pub struct Released {
    #[topic]
    pub to: Address,
    pub amount: i128,
    pub purpose: Symbol,
}

#[contractevent]
pub struct PauseChanged {
    pub paused: bool,
    pub admin: Address,
}

#[contract]
pub struct Treasury;

#[contractimpl]
impl Treasury {
    pub fn init(env: Env, admin: Address, token_address: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Token, &token_address);
        env.storage().instance().set(&DataKey::Paused, &false);

        set_i128(&env, DataKey::Available, 0);
        set_i128(&env, DataKey::TotalDeposited, 0);
        set_i128(&env, DataKey::TotalAllocated, 0);
        set_i128(&env, DataKey::TotalReleased, 0);

        Initialized {
            admin,
            token_address,
        }
        .publish(&env);

        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        if is_paused(&env) {
            return Err(Error::AlreadyPaused);
        }

        env.storage().instance().set(&DataKey::Paused, &true);
        PauseChanged {
            paused: true,
            admin,
        }
        .publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        if !is_paused(&env) {
            return Err(Error::NotPaused);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        PauseChanged {
            paused: false,
            admin,
        }
        .publish(&env);
        Ok(())
    }

    pub fn deposit(env: Env, from: Address, amount: i128, reason: Symbol) -> Result<(), Error> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let op = DepositOp {
            from: from.clone(),
            reason: reason.clone(),
        };
        let op_key = DataKey::ProcessedDeposit(op);
        if env.storage().persistent().has(&op_key) {
            return Err(Error::DuplicateOperation);
        }

        from.require_auth();

        let token = get_token(&env);
        let contract_address = env.current_contract_address();
        TokenClient::new(&env, &token).transfer(&from, &contract_address, &amount);

        let available = get_available(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let total_deposited = get_total_deposited(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        set_i128(&env, DataKey::Available, available);
        set_i128(&env, DataKey::TotalDeposited, total_deposited);

        env.storage().persistent().set(&op_key, &());
        extend_persistent_ttl(&env, &op_key);

        Deposited {
            from,
            amount,
            reason,
        }
        .publish(&env);

        Ok(())
    }

    pub fn allocate(
        env: Env,
        to_contract: Address,
        amount: i128,
        purpose: Symbol,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        require_admin_as_invoker(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let op = AllocateOp {
            to_contract: to_contract.clone(),
            purpose: purpose.clone(),
        };
        let op_key = DataKey::ProcessedAllocation(op);
        if env.storage().persistent().has(&op_key) {
            return Err(Error::DuplicateOperation);
        }

        let available = get_available(&env);
        if available < amount {
            return Err(Error::InsufficientFunds);
        }

        let new_available = available.checked_sub(amount).ok_or(Error::Overflow)?;
        let total_allocated = get_total_allocated(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        set_i128(&env, DataKey::Available, new_available);
        set_i128(&env, DataKey::TotalAllocated, total_allocated);

        env.storage().persistent().set(&op_key, &());
        extend_persistent_ttl(&env, &op_key);

        let token = get_token(&env);
        let contract_address = env.current_contract_address();
        TokenClient::new(&env, &token).transfer(&contract_address, &to_contract, &amount);

        Allocated {
            to_contract,
            amount,
            purpose,
        }
        .publish(&env);

        Ok(())
    }

    pub fn release(env: Env, to: Address, amount: i128, purpose: Symbol) -> Result<(), Error> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        require_admin_as_invoker(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let op = ReleaseOp {
            to: to.clone(),
            purpose: purpose.clone(),
        };
        let op_key = DataKey::ProcessedRelease(op);
        if env.storage().persistent().has(&op_key) {
            return Err(Error::DuplicateOperation);
        }

        let available = get_available(&env);
        if available < amount {
            return Err(Error::InsufficientFunds);
        }

        let new_available = available.checked_sub(amount).ok_or(Error::Overflow)?;
        let total_released = get_total_released(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        set_i128(&env, DataKey::Available, new_available);
        set_i128(&env, DataKey::TotalReleased, total_released);

        env.storage().persistent().set(&op_key, &());
        extend_persistent_ttl(&env, &op_key);

        let token = get_token(&env);
        let contract_address = env.current_contract_address();
        TokenClient::new(&env, &token).transfer(&contract_address, &to, &amount);

        Released {
            to,
            amount,
            purpose,
        }
        .publish(&env);

        Ok(())
    }

    pub fn treasury_state(env: Env) -> Result<TreasuryState, Error> {
        require_initialized(&env)?;

        let state = TreasuryState {
            admin: get_admin(&env),
            token_address: get_token(&env),
            paused: is_paused(&env),
            available_balance: get_available(&env),
            total_deposited: get_total_deposited(&env),
            total_allocated: get_total_allocated(&env),
            total_released: get_total_released(&env),
        };

        let expected_available = state
            .total_deposited
            .checked_sub(state.total_allocated)
            .and_then(|v| v.checked_sub(state.total_released))
            .ok_or(Error::Overflow)?;

        if expected_available != state.available_balance {
            return Err(Error::Overflow);
        }

        Ok(state)
    }
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin = get_admin(env);
    caller.require_auth();
    if &admin != caller {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

fn require_admin_as_invoker(env: &Env) -> Result<(), Error> {
    let admin = get_admin(env);
    admin.require_auth();
    Ok(())
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Treasury: admin not set")
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("Treasury: token not set")
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn get_available(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Available)
        .unwrap_or(0)
}

fn get_total_deposited(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalDeposited)
        .unwrap_or(0)
}

fn get_total_allocated(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalAllocated)
        .unwrap_or(0)
}

fn get_total_released(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalReleased)
        .unwrap_or(0)
}

fn set_i128(env: &Env, key: DataKey, value: i128) {
    env.storage().persistent().set(&key, &value);
    extend_persistent_ttl(env, &key);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Events as _},
        token::{StellarAssetClient, TokenClient},
        Address, Env,
    };

    fn create_token<'a>(env: &'a Env, token_admin: &Address) -> (Address, StellarAssetClient<'a>) {
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_client = StellarAssetClient::new(env, &token_contract.address());
        (token_contract.address(), token_client)
    }

    fn setup(env: &Env) -> (TreasuryClient<'_>, Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let funder = Address::generate(env);
        let token_admin = Address::generate(env);

        let (token_address, token_sac) = create_token(env, &token_admin);
        let contract_id = env.register(Treasury, ());
        let client = TreasuryClient::new(env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &token_address);
        token_sac.mint(&funder, &50_000i128);

        (client, admin, funder, token_address, contract_id)
    }

    fn token_client<'a>(env: &'a Env, token: &Address) -> TokenClient<'a> {
        TokenClient::new(env, token)
    }

    fn event_count_for_contract(env: &Env, contract: &Address) -> usize {
        env.events()
            .all()
            .filter_by_contract(contract)
            .events()
            .len()
    }

    #[test]
    fn test_init_rejects_reinit() {
        let env = Env::default();
        let (client, admin, _, token_addr, _) = setup(&env);
        env.mock_all_auths();

        let result = client.try_init(&admin, &token_addr);
        assert!(result.is_err());
    }

    #[test]
    fn test_deposit_updates_state_and_emits_event() {
        let env = Env::default();
        let (client, _, funder, _, treasury_addr) = setup(&env);
        env.mock_all_auths();

        client.deposit(&funder, &1_000, &symbol_short!("seed1"));
        assert!(event_count_for_contract(&env, &treasury_addr) >= 1);

        let state = client.treasury_state();
        assert_eq!(state.available_balance, 1_000);
        assert_eq!(state.total_deposited, 1_000);
        assert_eq!(state.total_allocated, 0);
        assert_eq!(state.total_released, 0);
    }

    #[test]
    fn test_deposit_duplicate_reason_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        client.deposit(&funder, &100, &symbol_short!("depdup"));
        let result = client.try_deposit(&funder, &100, &symbol_short!("depdup"));
        assert!(result.is_err());
    }

    #[test]
    fn test_deposit_invalid_amount_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        assert!(client
            .try_deposit(&funder, &0, &symbol_short!("bad0"))
            .is_err());
        assert!(client
            .try_deposit(&funder, &-1, &symbol_short!("badn"))
            .is_err());
    }

    #[test]
    fn test_allocate_transfers_tokens_and_updates_state() {
        let env = Env::default();
        let (client, _, funder, token_addr, treasury_addr) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        let token = token_client(&env, &token_addr);

        client.deposit(&funder, &2_000, &symbol_short!("seed2"));
        client.allocate(&recipient, &500, &symbol_short!("ops500"));
        assert!(event_count_for_contract(&env, &treasury_addr) >= 1);

        let state = client.treasury_state();
        assert_eq!(state.available_balance, 1_500);
        assert_eq!(state.total_allocated, 500);
        assert_eq!(token.balance(&recipient), 500);
    }

    #[test]
    fn test_allocate_duplicate_purpose_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        client.deposit(&funder, &2_000, &symbol_short!("seed3"));
        client.allocate(&recipient, &200, &symbol_short!("same1"));

        let result = client.try_allocate(&recipient, &200, &symbol_short!("same1"));
        assert!(result.is_err());
    }

    #[test]
    fn test_allocate_insufficient_funds_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        client.deposit(&funder, &100, &symbol_short!("seed4"));
        let result = client.try_allocate(&recipient, &101, &symbol_short!("big01"));
        assert!(result.is_err());
    }

    #[test]
    fn test_release_transfers_tokens_and_updates_state() {
        let env = Env::default();
        let (client, _, funder, token_addr, treasury_addr) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        let token = token_client(&env, &token_addr);

        client.deposit(&funder, &1_000, &symbol_short!("seed5"));
        client.release(&recipient, &300, &symbol_short!("refund"));
        assert!(event_count_for_contract(&env, &treasury_addr) >= 1);

        let state = client.treasury_state();
        assert_eq!(state.available_balance, 700);
        assert_eq!(state.total_released, 300);
        assert_eq!(token.balance(&recipient), 300);
    }

    #[test]
    fn test_release_duplicate_purpose_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        client.deposit(&funder, &1_000, &symbol_short!("seed6"));
        client.release(&recipient, &100, &symbol_short!("same2"));

        let result = client.try_release(&recipient, &100, &symbol_short!("same2"));
        assert!(result.is_err());
    }

    #[test]
    fn test_release_insufficient_funds_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        client.deposit(&funder, &100, &symbol_short!("seed7"));
        let result = client.try_release(&recipient, &200, &symbol_short!("oops1"));
        assert!(result.is_err());
    }

    #[test]
    fn test_pause_blocks_mutations_then_unpause_restores() {
        let env = Env::default();
        let (client, admin, funder, _, _) = setup(&env);
        env.mock_all_auths();

        client.pause(&admin);

        assert!(client
            .try_deposit(&funder, &100, &symbol_short!("hold1"))
            .is_err());
        assert!(client
            .try_allocate(&Address::generate(&env), &10, &symbol_short!("hold2"))
            .is_err());
        assert!(client
            .try_release(&Address::generate(&env), &10, &symbol_short!("hold3"))
            .is_err());

        client.unpause(&admin);
        client.deposit(&funder, &100, &symbol_short!("okok1"));
        let state = client.treasury_state();
        assert_eq!(state.available_balance, 100);
    }

    #[test]
    fn test_pause_event_emitted() {
        let env = Env::default();
        let (client, admin, _, _, treasury_addr) = setup(&env);
        env.mock_all_auths();

        client.pause(&admin);
        assert!(event_count_for_contract(&env, &treasury_addr) >= 1);
    }

    #[test]
    fn test_unauthorized_paths_rejected() {
        let env = Env::default();
        let (client, _, funder, _, _) = setup(&env);
        env.mock_all_auths();

        let outsider = Address::generate(&env);
        client.deposit(&funder, &1_000, &symbol_short!("seed8"));

        let bad_pause = client.try_pause(&outsider);
        assert!(bad_pause.is_err());

        let bad_unpause = client.try_unpause(&outsider);
        assert!(bad_unpause.is_err());
    }
}
