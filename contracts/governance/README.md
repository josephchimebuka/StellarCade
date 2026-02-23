# Governance Contract (Future DAO)

Timelock-based on-chain governance for the StellarCade platform. Token holders
propose, vote on, and execute governance actions.

## Public Interface

| Function | Description |
|----------|-------------|
| `init(admin, gov_token, voting_period, timelock_delay, quorum_bps, threshold_bps)` | Initialize governance parameters |
| `propose(proposer, proposal_id, payload_hash)` | Create a proposal (anyone can propose) |
| `vote(proposal_id, voter, support)` | Cast a weighted vote (true=for, false=against) |
| `queue(proposal_id)` | Queue a successful proposal into timelock (anyone) |
| `execute(proposal_id, payload_hash)` | Execute after timelock expires (anyone) |
| `cancel(admin, proposal_id)` | Admin emergency cancellation |
| `get_proposal(proposal_id)` | View proposal state |
| `has_voted(proposal_id, voter)` | Check if address voted |

## Governance Flow

```
1. PROPOSE
   proposer.propose(id, payload_hash)
   → state = ACTIVE
   → voting period begins

2. VOTE
   voter.vote(id, support)
   → weight = voter's token balance
   → for_votes or against_votes incremented

3. QUEUE (after voting ends)
   anyone.queue(id)
   → check quorum (total votes > 0)
   → check threshold (for_votes / total >= 60%)
   → if passed: state = QUEUED, eta = now + timelock
   → if failed: state = DEFEATED

4. EXECUTE (after timelock)
   anyone.execute(id, payload_hash)
   → verify payload_hash matches stored hash
   → state = EXECUTED
   → payload action executed (e.g., contract upgrade, param change)
```

## Proposal States

| State | Value | Description |
|-------|-------|-------------|
| PENDING | 0 | Created but not yet active (unused) |
| ACTIVE | 1 | Voting period open |
| DEFEATED | 2 | Voting ended, did not meet threshold |
| SUCCEEDED | 3 | Voting ended, met threshold (unused, goes straight to QUEUED) |
| QUEUED | 4 | In timelock, awaiting execution |
| EXECUTED | 5 | Action executed |
| CANCELLED | 6 | Admin cancelled |

## Parameters

**Voting Period:** Ledgers for voting (e.g., 17,280 = ~1 day at 5s/ledger)

**Timelock Delay:** Ledgers before execution (e.g., 86,400 = ~5 days)

**Quorum (BPS):** Minimum participation (e.g., 400 = 4% of supply must vote)
- Currently simplified: requires at least 1 vote
- Production: should compare `(total_votes * 10000 / token.total_supply()) >= quorum_bps`

**Threshold (BPS):** Minimum approval (e.g., 6000 = 60% of votes cast must be "for")
- Calculated as: `(for_votes * 10000 / total_votes) >= threshold_bps`

## Security

**Timelock Protection:**
- Prevents instant execution of malicious proposals
- Gives community time to review and react

**Payload Hash Commitment:**
- Proposer commits SHA-256(payload) at proposal time
- Executor must provide matching payload at execution
- Prevents bait-and-switch attacks

**Vote Weight:**
- Weight = voter's governance token balance at vote time
- Checked on-chain via `token.balance(voter)`

**No Double Voting:**
- Each address can vote once per proposal
- Enforced via `DataKey::Vote(proposal_id, voter)` flag

**Admin Override:**
- Admin can cancel any non-executed proposal (emergency function)

## Storage & Invariants

**Instance Storage:**
- Admin, GovernanceToken, VotingPeriod, TimelockDelay, QuorumBps, ThresholdBps

**Persistent Storage:**
- Proposal(id) → Proposal struct
- Vote(proposal_id, voter) → bool (voted flag)

**Invariants:**
- Each proposal_id is unique
- Votes can only be cast during voting period (`current_ledger < end_ledger`)
- Execution requires `payload_hash_verify == proposal.payload_hash`
- Execution only after `current_ledger >= proposal.eta`

## Events

| Event | Fields | Description |
|-------|--------|-------------|
| ProposalCreated | proposal_id, proposer, payload_hash | New proposal |
| VoteCast | proposal_id, voter, support, weight | Vote recorded |
| ProposalQueued | proposal_id, eta | Queued into timelock |
| ProposalExecuted | proposal_id | Action executed |
| ProposalCancelled | proposal_id | Admin cancelled |

## Example: Upgrade Contract Proposal

```rust
// 1. Proposer creates proposal
let payload = b"action:upgrade_prize_pool,new_addr:C...";
let payload_hash = env.crypto().sha256(payload);
gov.propose(proposer, 1, payload_hash);

// 2. Token holders vote
gov.vote(1, voter1, true);  // for
gov.vote(1, voter2, true);  // for
gov.vote(1, voter3, false); // against

// 3. After voting period: queue if passed
gov.queue(1);
// → if (for_votes / total_votes) >= 60%: state = QUEUED

// 4. After timelock: execute
gov.execute(1, payload_hash);
// → verify hash, mark executed, perform action
```

## Future Enhancements

- [ ] Delegation (vote on behalf of another address)
- [ ] Voting power snapshots (prevent vote buying mid-period)
- [ ] Proposal deposit/threshold (prevent spam)
- [ ] Multi-sig execution quorum
- [ ] On-chain payload decoding and automated execution

## Running Tests

```bash
cd contracts/governance
cargo test
```
