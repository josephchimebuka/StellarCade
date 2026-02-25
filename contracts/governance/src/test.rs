#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env,
};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let client = StellarAssetClient::new(env, &contract.address());
    (contract.address(), client)
}

fn hash(env: &Env, data: &[u8]) -> BytesN<32> {
    env.crypto().sha256(&Bytes::from_slice(env, data)).into()
}

struct Setup<'a> {
    gov_client: GovernanceClient<'a>,
    admin: Address,
    voter1: Address,
    voter2: Address,
}

fn setup(env: &Env) -> Setup<'_> {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let voter1 = Address::generate(env);
    let voter2 = Address::generate(env);

    let (token_addr, token_sac) = create_token(env, &token_admin);

    let gov_id = env.register(Governance, ());
    let gov_client = GovernanceClient::new(env, &gov_id);

    env.mock_all_auths();

    // Init: voting_period=100, timelock=50, quorum=1000 (10%), threshold=6000 (60%)
    gov_client.init(&admin, &token_addr, &100u32, &50u32, &1000u32, &6000u32);

    // Mint tokens to voters
    token_sac.mint(&voter1, &1000);
    token_sac.mint(&voter2, &500);

    Setup {
        gov_client,
        admin,
        voter1,
        voter2,
    }
}

// -------------------------------------------------------------------
// 1. Initialization
// -------------------------------------------------------------------

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let token = Address::generate(&env);
    let result = s.gov_client.try_init(&s.admin, &token, &100, &50, &1000, &6000);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 2. Propose
// -------------------------------------------------------------------

#[test]
fn test_propose_creates_proposal() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:update_fee");

    s.gov_client.propose(&proposer, &1u64, &payload);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.proposer, proposer);
    assert_eq!(proposal.payload_hash, payload);
    assert_eq!(proposal.state, STATE_ACTIVE);
    assert_eq!(proposal.for_votes, 0);
    assert_eq!(proposal.against_votes, 0);
}

#[test]
fn test_duplicate_proposal_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");

    s.gov_client.propose(&proposer, &1u64, &payload);
    let result = s.gov_client.try_propose(&proposer, &1u64, &payload);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 3. Vote
// -------------------------------------------------------------------

#[test]
fn test_vote_for() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true); // for

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.for_votes, 1000);
    assert_eq!(proposal.against_votes, 0);
    assert!(s.gov_client.has_voted(&1u64, &s.voter1));
}

#[test]
fn test_vote_against() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter2, &false); // against

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.for_votes, 0);
    assert_eq!(proposal.against_votes, 500);
}

#[test]
fn test_vote_multiple_voters() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &false);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.for_votes, 1000);
    assert_eq!(proposal.against_votes, 500);
}

#[test]
fn test_double_vote_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);
    let result = s.gov_client.try_vote(&1u64, &s.voter1, &true);
    assert!(result.is_err());
}

#[test]
fn test_vote_after_period_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    // Advance ledger past voting period (100 ledgers)
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);

    let result = s.gov_client.try_vote(&1u64, &s.voter1, &true);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 4. Queue
// -------------------------------------------------------------------

#[test]
fn test_queue_succeeded_proposal() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    // Vote with 100% for
    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &true);

    // Advance past voting period
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);

    s.gov_client.queue(&1u64);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.state, STATE_QUEUED);
    assert!(proposal.eta > 0);
}

#[test]
fn test_queue_defeated_proposal() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    // Vote with more against than for (doesn't meet 60% threshold)
    s.gov_client.vote(&1u64, &s.voter1, &false); // 1000 against
    s.gov_client.vote(&1u64, &s.voter2, &true);  // 500 for
    // for_votes_bps = 500 * 10000 / 1500 = 3333 bps < 6000 threshold

    // Advance past voting period
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);

    s.gov_client.queue(&1u64);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.state, STATE_DEFEATED);
}

#[test]
fn test_queue_before_voting_ends_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);

    // Try to queue before voting period ends
    let result = s.gov_client.try_queue(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 5. Execute
// -------------------------------------------------------------------

#[test]
fn test_execute_queued_proposal() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &true);

    // Advance past voting period
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);
    s.gov_client.queue(&1u64);

    // Advance past timelock (50 ledgers)
    env.ledger().set_sequence_number(env.ledger().sequence() + 51);

    s.gov_client.execute(&1u64, &payload);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.state, STATE_EXECUTED);
}

#[test]
fn test_execute_before_timelock_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &true);

    env.ledger().set_sequence_number(env.ledger().sequence() + 101);
    s.gov_client.queue(&1u64);

    // Try to execute before timelock expires
    let result = s.gov_client.try_execute(&1u64, &payload);
    assert!(result.is_err());
}

#[test]
fn test_execute_wrong_payload_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &true);

    env.ledger().set_sequence_number(env.ledger().sequence() + 101);
    s.gov_client.queue(&1u64);

    env.ledger().set_sequence_number(env.ledger().sequence() + 51);

    // Try with wrong payload hash
    let wrong_payload = hash(&env, b"action:wrong");
    let result = s.gov_client.try_execute(&1u64, &wrong_payload);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 6. Cancel
// -------------------------------------------------------------------

#[test]
fn test_admin_cancel() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    s.gov_client.cancel(&s.admin, &1u64);

    let proposal = s.gov_client.get_proposal(&1u64);
    assert_eq!(proposal.state, STATE_CANCELLED);
}

#[test]
fn test_non_admin_cannot_cancel() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:test");
    s.gov_client.propose(&proposer, &1u64, &payload);

    let stranger = Address::generate(&env);
    let result = s.gov_client.try_cancel(&stranger, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 7. Full lifecycle
// -------------------------------------------------------------------

#[test]
fn test_full_governance_lifecycle() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let payload = hash(&env, b"action:upgrade_contract");

    // 1. Propose
    s.gov_client.propose(&proposer, &1u64, &payload);
    assert_eq!(s.gov_client.get_proposal(&1u64).state, STATE_ACTIVE);

    // 2. Vote
    s.gov_client.vote(&1u64, &s.voter1, &true);
    s.gov_client.vote(&1u64, &s.voter2, &true);

    // 3. Queue (after voting period)
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);
    s.gov_client.queue(&1u64);
    assert_eq!(s.gov_client.get_proposal(&1u64).state, STATE_QUEUED);

    // 4. Execute (after timelock)
    env.ledger().set_sequence_number(env.ledger().sequence() + 51);
    s.gov_client.execute(&1u64, &payload);
    assert_eq!(s.gov_client.get_proposal(&1u64).state, STATE_EXECUTED);
}
