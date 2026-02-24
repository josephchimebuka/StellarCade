//! Stellarcade Cross-Contract Communication Handler
//!
//! Platform-core contract that routes and tracks cross-contract requests.
//! Admin registers routes (source → target + selector); authorized callers
//! dispatch requests and targets (or admin) acknowledge with results.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    RegistryContract,
    NextRouteId,
    Route(u32),
    Request(Symbol),
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Route {
    pub source_contract: Address,
    pub target_contract: Address,
    pub selector: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending(u32, Bytes),
    Acknowledged(Bytes),
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    RouteNotFound = 4,
    RequestNotFound = 5,
    DuplicateRequestId = 6,
    RequestAlreadyAcknowledged = 7,
    InvalidRoute = 8,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub registry_contract: Address,
}

#[contractevent]
pub struct RouteRegistered {
    pub route_id: u32,
    pub source_contract: Address,
    pub target_contract: Address,
    pub selector: Symbol,
}

#[contractevent]
pub struct Dispatched {
    #[topic]
    pub request_id: Symbol,
    pub route_id: u32,
    pub payload: Bytes,
}

#[contractevent]
pub struct Acknowledged {
    #[topic]
    pub request_id: Symbol,
    pub result: Bytes,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct CrossContractHandler;

#[contractimpl]
impl CrossContractHandler {
    /// Initialize with admin and optional registry contract. Call once.
    pub fn init(env: Env, admin: Address, registry_contract: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry_contract);
        env.storage().instance().set(&DataKey::NextRouteId, &0u32);
        Initialized {
            admin,
            registry_contract,
        }
        .publish(&env);
        Ok(())
    }

    /// Register a route: source_contract may dispatch to target_contract via selector. Admin only.
    pub fn register_route(
        env: Env,
        admin: Address,
        source_contract: Address,
        target_contract: Address,
        selector: Symbol,
    ) -> Result<u32, Error> {
        require_admin(&env, &admin)?;
        if source_contract == target_contract {
            return Err(Error::InvalidRoute);
        }
        let next: u32 = env
            .storage()
            .instance()
            .get(&DataKey::NextRouteId)
            .unwrap_or(0);
        let route_id = next.checked_add(1).ok_or(Error::InvalidRoute)?;
        env.storage()
            .instance()
            .set(&DataKey::NextRouteId, &route_id);
        let route = Route {
            source_contract: source_contract.clone(),
            target_contract: target_contract.clone(),
            selector: selector.clone(),
        };
        env.storage().instance().set(&DataKey::Route(route_id), &route);
        RouteRegistered {
            route_id,
            source_contract,
            target_contract,
            selector,
        }
        .publish(&env);
        Ok(route_id)
    }

    /// Dispatch a request along a registered route. Caller must be admin or source_contract for that route.
    pub fn dispatch(
        env: Env,
        caller: Address,
        request_id: Symbol,
        route_id: u32,
        payload: Bytes,
    ) -> Result<(), Error> {
        caller.require_auth();
        let route: Route = env
            .storage()
            .instance()
            .get(&DataKey::Route(route_id))
            .ok_or(Error::RouteNotFound)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin && caller != route.source_contract {
            return Err(Error::NotAuthorized);
        }
        if env.storage().instance().has(&DataKey::Request(request_id.clone())) {
            return Err(Error::DuplicateRequestId);
        }
        let status = RequestStatus::Pending(route_id, payload.clone());
        env.storage()
            .instance()
            .set(&DataKey::Request(request_id.clone()), &status);
        Dispatched {
            request_id,
            route_id,
            payload,
        }
        .publish(&env);
        Ok(())
    }

    /// Acknowledge a pending request with a result. Caller must be admin or target_contract for that request's route.
    pub fn acknowledge(
        env: Env,
        caller: Address,
        request_id: Symbol,
        result: Bytes,
    ) -> Result<(), Error> {
        caller.require_auth();
        let status: RequestStatus = env
            .storage()
            .instance()
            .get(&DataKey::Request(request_id.clone()))
            .ok_or(Error::RequestNotFound)?;
        let route_id = match &status {
            RequestStatus::Pending(rid, _) => *rid,
            RequestStatus::Acknowledged(_) => return Err(Error::RequestAlreadyAcknowledged),
        };
        let route: Route = env
            .storage()
            .instance()
            .get(&DataKey::Route(route_id))
            .ok_or(Error::RouteNotFound)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if caller != admin && caller != route.target_contract {
            return Err(Error::NotAuthorized);
        }
        let new_status = RequestStatus::Acknowledged(result.clone());
        env.storage()
            .instance()
            .set(&DataKey::Request(request_id.clone()), &new_status);
        Acknowledged {
            request_id,
            result,
        }
        .publish(&env);
        Ok(())
    }

    /// Return the route for a given route_id, or None if not found.
    pub fn get_route(env: Env, route_id: u32) -> Result<Route, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Route(route_id))
            .ok_or(Error::RouteNotFound)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if *caller != admin {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
