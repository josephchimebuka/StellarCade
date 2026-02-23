# Security Audit Checklist

**Project:** StellarCade
**Audit Date:** [TBD]
**Auditor:** [TBD]
**Version:** 0.1.0

---

## 1. Pre-Audit Checklist (Team)

- [ ] All contracts compile without warnings (`cargo clippy -- -D warnings`)
- [ ] All unit tests pass (`cargo test` in each contract)
- [ ] Code freeze on audited commit hash
- [ ] Documentation complete (README per contract + SECURITY_AUDIT_PREP.md)
- [ ] Deployment scripts reviewed and tested on testnet
- [ ] Multi-sig admin wallet configured for mainnet
- [ ] Oracle service tested and operational on testnet
- [ ] Emergency pause procedures documented and rehearsed

---

## 2. Auditor Checklist

### 2.1 Access Control & Authorization

**Prize Pool Contract:**
- [ ] Only admin can call `reserve`, `release`, `payout`
- [ ] `require_admin` properly validates caller
- [ ] `admin.require_auth()` called before state mutations
- [ ] Cannot re-init after first `init`

**User Balance Contract:**
- [ ] Only admin can `authorize_game` and `revoke_game`
- [ ] Only whitelisted games can call `credit` and `debit`
- [ ] Users can only withdraw their own balances
- [ ] `deposit` and `withdraw` require user auth

**Random Generator Contract:**
- [ ] Only admin can `authorize` and `revoke` callers
- [ ] Only oracle can call `fulfill_random`
- [ ] Only whitelisted callers can `request_random`

**Pattern Puzzle Contract:**
- [ ] Only admin can `create_puzzle` and `resolve_round`
- [ ] Players can only claim their own rewards
- [ ] Cannot claim twice for same (round_id, player)

**Coin Flip Contract:**
- [ ] Only player can place their own bet
- [ ] Anyone can resolve (deterministic, no auth needed)

**Emergency Pause Contract:**
- [ ] Only admin can `pause` and `unpause`
- [ ] `require_not_paused` guard blocks operations when paused

---

### 2.2 Token Custody & Accounting

**Prize Pool:**
- [ ] Invariant holds: `available + total_reserved == token.balance(contract)`
- [ ] Cannot reserve more than available balance
- [ ] Cannot payout more than reserved for a game
- [ ] State updated before `token.transfer` (reentrancy protection)
- [ ] Reservation removed when `remaining == 0`
- [ ] Duplicate `reserve` for same `game_id` rejected

**User Balance:**
- [ ] Invariant holds: `sum(user_balances) == token.balance(contract)`
- [ ] Cannot withdraw more than user's balance
- [ ] Cannot debit more than user's balance
- [ ] State updated before `token.transfer` on withdrawal
- [ ] `deposit` increases balance atomically with token transfer
- [ ] Overflow checks on all balance mutations

**Coin Flip:**
- [ ] Wager transferred from player before game stored
- [ ] Payout transferred to player only if won
- [ ] Loss wager stays in contract (house keeps it)
- [ ] Payout calculation correct: `2 * wager - (wager * edge_bps / 10000)`
- [ ] State updated before `token.transfer` on payout

---

### 2.3 Randomness & Fairness

**Random Generator:**
- [ ] `derive_result` is deterministic and reproducible
- [ ] Result always in range `[0, max - 1]`
- [ ] Same `request_id` cannot be used twice (pending or fulfilled)
- [ ] `fulfill_random` can only be called once per `request_id`
- [ ] Seed commitment model documented (off-chain commitment required)
- [ ] `request_id` and `server_seed` combined in SHA-256 preimage prevents reuse
- [ ] Non-oracle cannot fulfill
- [ ] Unauthorized caller cannot request

**Coin Flip:**
- [ ] Outcome determined by RNG result (no game contract manipulation)
- [ ] RNG request submitted atomically with bet placement
- [ ] `resolve_bet` reads RNG result correctly
- [ ] Cannot resolve before RNG fulfillment
- [ ] Cannot resolve twice for same game

**Pattern Puzzle:**
- [ ] Admin commits SHA-256 hash before players submit
- [ ] Plaintext answer only revealed at resolution
- [ ] Verification: `sha256(plaintext) == stored_hash`
- [ ] Admin cannot change hash after players submit

---

### 2.4 Game Logic Correctness

**Coin Flip:**
- [ ] Side values restricted to 0 (Heads) or 1 (Tails)
- [ ] Invalid side rejected
- [ ] Wager within min/max limits
- [ ] Zero or negative wager rejected
- [ ] Duplicate `game_id` rejected
- [ ] Game state transitions: not started → pending → resolved
- [ ] Cannot re-resolve

**Pattern Puzzle:**
- [ ] Round states: Open → Resolved
- [ ] Cannot submit after round resolved
- [ ] Cannot resolve before round open
- [ ] Cannot claim before round resolved
- [ ] Duplicate submission by same player handled (last submission wins or error?)
- [ ] Duplicate claim rejected
- [ ] Reward calculation: `prize_pool / winner_count`
- [ ] MAX_PLAYERS_PER_ROUND enforced (500)

---

### 2.5 Arithmetic Safety

**All Contracts:**
- [ ] All arithmetic uses `checked_add`, `checked_sub`, `checked_mul`, `checked_div`
- [ ] Overflow/underflow returns `Error::Overflow`
- [ ] No unchecked arithmetic (`+`, `-`, `*`, `/` without `checked_*`)
- [ ] Division by zero handled (e.g., fee calculation, reward distribution)
- [ ] Basis points division correct: `amount * bps / 10000`

**Specific Checks:**
- [ ] Prize Pool: `available + total_reserved` cannot overflow
- [ ] User Balance: `balance + credit` cannot overflow
- [ ] Coin Flip: `2 * wager - fee` cannot underflow
- [ ] Pattern Puzzle: `prize_pool / winner_count` handles zero winners

---

### 2.6 Reentrancy Protection

**All Token Transfers:**
- [ ] Prize Pool `payout`: state updated before `token.transfer`
- [ ] User Balance `withdraw`: state updated before `token.transfer`
- [ ] Coin Flip `resolve_bet` (win path): state updated before `token.transfer`
- [ ] No external calls before critical state mutations

---

### 2.7 Storage & State Management

**All Contracts:**
- [ ] `instance()` storage used for config (admin, addresses, constants)
- [ ] `persistent()` storage used for per-user/per-game data
- [ ] TTL extended on every persistent write (30 days = 518,400 ledgers)
- [ ] Storage keys unique and collision-free
- [ ] No stale data (removed when no longer needed)

**Specific Checks:**
- [ ] Prize Pool: Reservation removed when `remaining == 0`
- [ ] Random Generator: Pending entry removed after fulfillment
- [ ] Pattern Puzzle: Claimed flags persist (no double-claim)

---

### 2.8 Event Emission

**All Contracts:**
- [ ] Events emitted for all state changes
- [ ] Event fields include relevant actors (player, admin, game_id)
- [ ] Topics used for indexing (e.g., `#[topic] game_id`)

**Prize Pool:**
- [ ] `Funded`, `Reserved`, `Released`, `PaidOut` events

**User Balance:**
- [ ] `Deposited`, `Withdrawn`, `Credited`, `Debited` events

**Coin Flip:**
- [ ] `BetPlaced`, `BetResolved` events

**Pattern Puzzle:**
- [ ] `RoundCreated`, `SolutionSubmitted`, `RoundResolved`, `RewardClaimed` events

**Random Generator:**
- [ ] `RandomRequested`, `RandomFulfilled` events

**Emergency Pause:**
- [ ] `Paused`, `Unpaused` events

---

### 2.9 Error Handling

**All Contracts:**
- [ ] Errors are explicit and descriptive
- [ ] No panics except for unrecoverable state (e.g., storage corruption)
- [ ] All user-facing errors return `Result<T, Error>`
- [ ] `expect()` only used for internal invariants that cannot fail

**Common Errors Checked:**
- [ ] `AlreadyInitialized`
- [ ] `NotInitialized`
- [ ] `NotAuthorized`
- [ ] `InvalidAmount`
- [ ] `InsufficientFunds`
- [ ] `Overflow`
- [ ] Duplicate actions (bet, claim, fulfill)

---

### 2.10 Emergency Procedures

**Emergency Pause Integration:**
- [ ] All game contracts import `require_not_paused` guard
- [ ] Critical functions check pause state
- [ ] Admin can pause platform globally
- [ ] Pause state persists in `instance()` storage
- [ ] `is_paused()` is publicly readable

**Failure Scenarios:**
- [ ] What happens if RNG oracle goes offline? (pending requests timeout)
- [ ] What happens if admin key lost? (multi-sig allows recovery)
- [ ] What happens if token contract paused? (platform halts, no workaround)

---

### 2.11 Gas & DoS Resistance

**Pattern Puzzle:**
- [ ] MAX_PLAYERS_PER_ROUND = 500 prevents unbounded loops
- [ ] Reward claim is pull-based (players claim, not admin pushes)
- [ ] Resolution handles up to 500 players without running out of gas

**Random Generator:**
- [ ] Fulfillment is O(1) (no loops)
- [ ] Request storage is per-request (no shared arrays)

**Prize Pool:**
- [ ] Payout is per-call (no batch payouts that could hit gas limit)

---

## 3. Findings Triage Matrix

### 3.1 Severity Definitions

| Severity | Definition | Response Time |
|----------|-----------|---------------|
| **Critical** | Direct loss of funds or total platform compromise | Immediate (halt mainnet launch) |
| **High** | Potential loss of funds under specific conditions | 1-7 days (fix before launch) |
| **Medium** | Incorrect behavior or DoS without fund loss | 7-30 days (fix before launch or v1.1) |
| **Low** | Gas inefficiency, minor UX issues | 30+ days (defer to v2) |
| **Informational** | Code quality, style, documentation | As time permits |

### 3.2 Severity Examples

**Critical:**
- Reentrancy allowing double withdrawal
- Authorization bypass allowing admin actions by any user
- Arithmetic overflow leading to free mints

**High:**
- Randomness manipulation allowing guaranteed wins
- Game logic bug allowing duplicate claims
- Unchecked external call failure leading to state inconsistency

**Medium:**
- Missing event emission
- Storage TTL not extended (premature expiration)
- Gas-inefficient loop (but bounded)

**Low:**
- Redundant storage reads
- Suboptimal data structure choice
- Missing input validation on view functions

**Informational:**
- Code comments unclear
- Variable naming inconsistent
- Documentation incomplete

---

## 4. Remediation Workflow

### 4.1 For Each Finding:

1. **Acknowledge:** Team confirms understanding of issue
2. **Classify:** Assign severity using matrix above
3. **Plan:** Design fix, estimate effort, schedule
4. **Implement:** Code fix, add regression test
5. **Test:** Run full test suite + new test
6. **Document:** Update SECURITY_AUDIT_PREP.md with mitigation
7. **Verify:** Auditor re-tests fixed code
8. **Close:** Mark as resolved in audit report

### 4.2 Critical/High Issue Protocol:

- **Halt Mainnet Launch:** Do not deploy until fixed
- **Emergency Meeting:** Team + auditor discuss fix
- **Fast-Track Review:** Auditor re-tests within 48 hours
- **Public Disclosure:** Announce fix in audit report (no exploit details pre-fix)

### 4.3 Medium Issue Protocol:

- **Evaluate:** Defer to v1.1 or fix before launch
- **Risk Assessment:** Does this block mainnet? Usually no.
- **Fix Before Launch:** If impacts user trust or UX

### 4.4 Low/Informational:

- **Track:** Log in issue tracker
- **Defer:** Address in future release or never

---

## 5. Post-Audit Verification

### 5.1 Retest Checklist:

- [ ] All Critical findings resolved and verified
- [ ] All High findings resolved and verified
- [ ] All Medium findings resolved or documented as deferred
- [ ] Regression tests added for each fix
- [ ] `cargo test` passes on all contracts
- [ ] `cargo clippy -- -D warnings` passes
- [ ] No new issues introduced by fixes

### 5.2 Final Sign-Off:

- [ ] Auditor provides final report
- [ ] Team publishes audit report publicly
- [ ] Commit hash of audited code documented
- [ ] Mainnet deployment plan updated with audit results
- [ ] Multi-sig admin wallet configured
- [ ] Oracle service operational
- [ ] Emergency contacts documented

---

## 6. Continuous Monitoring (Post-Launch)

### 6.1 On-Chain Monitoring:

- [ ] Event indexer tracking all contract events
- [ ] Alert on unexpected `Paused` events
- [ ] Alert on large token transfers (> threshold)
- [ ] Alert on failed transactions (potential exploits)

### 6.2 Off-Chain Monitoring:

- [ ] Oracle uptime monitoring (RNG service)
- [ ] Admin wallet activity logs
- [ ] User support tickets for anomalies

### 6.3 Scheduled Reviews:

- [ ] Quarterly contract state audit (verify invariants)
- [ ] Annual re-audit after major upgrades
- [ ] Bug bounty program (post-launch)

---

## 7. Auditor Resources

### 7.1 Code Repository:

**Location:** https://github.com/TheBlockCade/StellarCade

**Audited Commit:** [TBD - freeze commit hash]

**Branch:** `main`

### 7.2 Documentation:

- `README.md` — Project overview
- `docs/SECURITY_AUDIT_PREP.md` — This document
- `contracts/<contract>/README.md` — Per-contract documentation
- `docs/ARCHITECTURE.md` — System design
- `docs/GAME_RULES.md` — Game mechanics

### 7.3 Testing:

**Run All Tests:**
```bash
cd contracts/<contract>
cargo test
cargo clippy -- -D warnings
```

**Deploy to Testnet:**
```bash
./scripts/deploy-contracts.sh --build --network testnet --source default
```

### 7.4 Contact:

**Security Lead:** [Email TBD]
**Smart Contract Lead:** [Email TBD]
**Slack/Discord:** [TBD]

---

## 8. Acceptance Criteria

Audit is considered complete when:

- [ ] All in-scope contracts reviewed
- [ ] All findings documented with severity
- [ ] Critical/High issues resolved and retested
- [ ] Final audit report delivered
- [ ] Team has signed off on report
- [ ] Public disclosure plan agreed
- [ ] Mainnet deploy checklist updated

---

**End of Security Audit Checklist**
