#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    Address, Bytes, BytesN, Env, Vec,
};

#[contract]
pub struct OracleIntegration;

//
// ─────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────
//

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    OracleSources,
    Request(BytesN<32>),
    Latest(BytesN<32>),
}

#[derive(Clone)]
#[contracttype]
pub struct OracleRequest {
    pub feed_id: BytesN<32>,
    pub fulfilled: bool,
    pub payload: Bytes,
}

//
// ─────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────
//

#[contractevent]
pub struct Initialized {
    pub admin: Address,
}

#[contractevent]
pub struct RequestCreated {
    pub request_id: BytesN<32>,
    pub feed_id: BytesN<32>,
}

#[contractevent]
pub struct RequestFulfilled {
    pub request_id: BytesN<32>,
    pub feed_id: BytesN<32>,
}

//
// ─────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────
//

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    RequestExists = 3,
    RequestNotFound = 4,
    AlreadyFulfilled = 5,
    InvalidInput = 6,
    OracleNotWhitelisted = 7,
    Overflow = 8,
}

//
// ─────────────────────────────────────────────
// TTL CONFIG
// ─────────────────────────────────────────────
//

const TTL_RENEW_WINDOW: u32 = 1_000;

fn renew_persistent_ttl(env: &Env, key: &DataKey) -> Result<(), Error> {
    let max_ttl = env.storage().max_ttl();

    let threshold = max_ttl
        .checked_sub(TTL_RENEW_WINDOW)
        .ok_or(Error::Overflow)?;

    env.storage()
        .persistent()
        .extend_ttl(key, threshold, max_ttl);

    Ok(())
}

//
// ─────────────────────────────────────────────
// CONTRACT IMPLEMENTATION
// ─────────────────────────────────────────────
//

#[contractimpl]
impl OracleIntegration {

    // ───────── INIT ─────────

    pub fn init(
        env: Env,
        admin: Address,
        oracle_sources_config: Vec<Address>,
    ) -> Result<(), Error> {

        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        if oracle_sources_config.is_empty() {
            return Err(Error::InvalidInput);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleSources, &oracle_sources_config);

        Initialized { admin }.publish(&env);

        Ok(())
    }

    // ───────── REQUEST DATA ─────────

    pub fn request_data(
        env: Env,
        caller: Address,
        feed_id: BytesN<32>,
        request_id: BytesN<32>,
    ) -> Result<(), Error> {

        caller.require_auth();

        let zero = BytesN::from_array(&env, &[0; 32]);
        if feed_id == zero || request_id == zero {
            return Err(Error::InvalidInput);
        }

        let key = DataKey::Request(request_id.clone());

        if env.storage().persistent().has(&key) {
            return Err(Error::RequestExists);
        }

        let request = OracleRequest {
            feed_id: feed_id.clone(),
            fulfilled: false,
            payload: Bytes::new(&env),
        };

        env.storage().persistent().set(&key, &request);
        renew_persistent_ttl(&env, &key)?;

        RequestCreated {
            request_id,
            feed_id,
        }
        .publish(&env);

        Ok(())
    }

    // ───────── FULFILL DATA ─────────

    pub fn fulfill_data(
        env: Env,
        caller: Address,
        request_id: BytesN<32>,
        payload: Bytes,
        _proof: Bytes,
    ) -> Result<(), Error> {

        caller.require_auth();

        if payload.is_empty() {
            return Err(Error::InvalidInput);
        }

        let sources: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::OracleSources)
            .ok_or(Error::NotAuthorized)?;

        if !sources.contains(&caller) {
            return Err(Error::OracleNotWhitelisted);
        }

        let req_key = DataKey::Request(request_id.clone());

        let mut request: OracleRequest = env
            .storage()
            .persistent()
            .get(&req_key)
            .ok_or(Error::RequestNotFound)?;

        if request.fulfilled {
            return Err(Error::AlreadyFulfilled);
        }

        request.fulfilled = true;
        request.payload = payload.clone();

        env.storage().persistent().set(&req_key, &request);
        renew_persistent_ttl(&env, &req_key)?;

        let latest_key = DataKey::Latest(request.feed_id.clone());

        env.storage().persistent().set(&latest_key, &payload);
        renew_persistent_ttl(&env, &latest_key)?;

        let feed_id = request.feed_id.clone();

        RequestFulfilled {
            request_id,
            feed_id,
        }
        .publish(&env);

        Ok(())
    }

    // ───────── READ METHODS ─────────

    pub fn latest(env: Env, feed_id: BytesN<32>) -> Option<Bytes> {
        let key = DataKey::Latest(feed_id);
        let result = env.storage().persistent().get(&key);

        if result.is_some() {
            renew_persistent_ttl(&env, &key).ok();
        }

        result
    }

    pub fn get_request(
        env: Env,
        request_id: BytesN<32>,
    ) -> Option<OracleRequest> {

        let key = DataKey::Request(request_id);
        let result = env.storage().persistent().get(&key);

        if result.is_some() {
            renew_persistent_ttl(&env, &key).ok();
        }

        result
    }
}