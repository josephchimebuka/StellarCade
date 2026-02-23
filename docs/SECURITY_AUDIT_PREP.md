# Security Audit Preparation

**Project:** StellarCade
**Platform:** Stellar Soroban Smart Contracts
**Version:** 0.1.0 (Pre-Mainnet)
**Last Updated:** 2026-02-22

---

## 1. Executive Summary

StellarCade is a decentralized arcade gaming platform on Stellar with 6 core smart contracts managing user balances, game logic, randomness, prize pools, access control, and emergency pausing. This document prepares auditors by detailing the threat model, asset inventory, trust boundaries, and security assumptions.

---

## 2. Asset Inventory

### 2.1 Smart Contracts

| Contract | Status | Asset Custody | Critical Functions |
|----------|--------|---------------|-------------------|
| **Prize Pool** | Implemented | Holds all game prize tokens | `fund`, `reserve`, `payout`, `release` |
| **User Balance** | Implemented | Holds user deposit tokens | `deposit`, `withdraw`, `credit`, `debit` |
| **Pattern Puzzle** | Implemented | No direct custody | `submit_solution`, `resolve_round`, `claim_reward` |
| **Coin Flip** | Implemented | Holds wagers during games | `place_bet`, `resolve_bet` |
| **Random Generator** | Implemented | No custody | `request_random`, `fulfill_random` |
| **Emergency Pause** | Implemented | No custody | `pause`, `unpause` |
| **Access Control** | Implemented | No custody | `grant_role`, `revoke_role` |

### 2.2 On-Chain Assets

**SEP-41 Tokens:**
- Primary game currency (e.g., USDC on Stellar)
- Held in Prize Pool contract (~platform treasury)
- Held in User Balance contract (~user deposits)
- Held in Coin Flip contract during active games

**User Balances:**
- Internal accounting in User Balance contract
- Invariant: `sum(all_user_balances) == token.balance(user_balance_contract)`

**Prize Pool Reserves:**
- Per-game reservations tracked in Prize Pool
- Invariant: `available + total_reserved == token.balance(prize_pool_contract)`

---

## 3. Threat Model

### 3.1 Attack Surfaces

#### 3.1.1 Token Flow Attacks
- **Reentrancy on withdrawals:** User Balance and Prize Pool update state before external token transfers
- **Double-spending:** Game IDs are unique; duplicate bets/claims rejected
- **Overdrafts:** All debit operations check sufficient balance/reserves

#### 3.1.2 Randomness Manipulation
- **Oracle Collusion:** Oracle commits seed hash off-chain before request submission (commit-reveal)
- **Result Prediction:** SHA-256(server_seed || request_id) prevents prediction; seed must be chosen before request
- **Seed Reuse:** Each request_id is unique; duplicate requests rejected

#### 3.1.3 Authorization Bypass
- **Privilege Escalation:** All privileged methods call `require_admin` or `require_game_contract`
- **Role Confusion:** Access Control contract manages roles; only admin can grant/revoke
- **Unauthorized Settlement:** User Balance credit/debit only callable by whitelisted game contracts

#### 3.1.4 Game Logic Exploits
- **Pattern Puzzle Answer Tampering:** Admin commits SHA-256 hash before players submit; plaintext revealed only at resolution
- **Coin Flip Outcome Manipulation:** Outcome determined by RNG contract; game contract has no control
- **Duplicate Claims:** Pattern Puzzle tracks claimed flags per (round_id, player)

#### 3.1.5 Economic Attacks
- **House Edge Bypass:** Immutable at init; payout calculation uses checked arithmetic
- **Fee Circumvention:** Prize Pool handles all payouts; direct token transfers break accounting invariant (documented risk)
- **Wager Limit Bypass:** Min/max enforced at `place_bet`; limits immutable post-init

#### 3.1.6 Denial of Service
- **Storage Exhaustion:** TTL extension on every write (30 days); admin can pause to halt new games
- **Gas Griefing:** Pattern Puzzle caps MAX_PLAYERS_PER_ROUND at 500
- **Emergency Stop:** Emergency Pause contract allows admin to halt all critical operations

### 3.2 Trust Assumptions

| Entity | Trust Level | Powers | Mitigations |
|--------|-------------|--------|-------------|
| **Admin** | High | Initialize contracts, authorize games, pause platform | Multi-sig recommended for mainnet |
| **Oracle (RNG)** | Medium | Fulfill randomness with server seed | Off-chain seed commitment; on-chain verification |
| **Game Contracts** | Medium | Credit/debit user balances | Must be authorized by admin; audited before whitelisting |
| **Players** | Untrusted | Submit bets, claim rewards | All inputs validated; auth required for withdrawals |
| **Token Contract** | High (External) | SEP-41 compliance | Assumed to be Stellar Asset Contract |

---

## 4. Trust Boundaries

### 4.1 Inter-Contract Calls

```
User Balance ←→ Game Contracts (Coin Flip, Pattern Puzzle)
    ↑ credit/debit only by whitelisted games

Prize Pool ←→ Game Contracts
    ↑ reserve/payout only by admin (games must route through admin or backend)

Random Generator ←→ Game Contracts
    ↑ request_random only by whitelisted callers
    ↑ fulfill_random only by oracle

Emergency Pause → All Contracts
    ↑ Contracts should import require_not_paused guard
```

### 4.2 External Dependencies

**Stellar Asset Contract (SEP-41):**
- Trust: Assumed correct implementation by Stellar
- Failure Mode: If token.transfer panics after state update, accounting may drift
- Mitigation: State updates before external calls (reentrancy pattern)

**Oracle Service (RNG):**
- Trust: Must publish seed commitment before accepting requests
- Failure Mode: Oracle can censor requests by not fulfilling
- Mitigation: Admin can replace oracle; requests timeout after TTL

---

## 5. Security Invariants

### 5.1 Global Invariants

| Invariant | Contract | Verification |
|-----------|----------|--------------|
| `available + total_reserved == token.balance(pool_addr)` | Prize Pool | Tested; assumes all inflows via `fund` |
| `sum(user_balances) == token.balance(balance_addr)` | User Balance | Tested; assumes all inflows via `deposit` |
| Each game_id can be resolved exactly once | Coin Flip, Pattern Puzzle | Tested with `resolved` flag |
| Each request_id can be fulfilled exactly once | Random Generator | Tested with `AlreadyFulfilled` error |
| Payout never exceeds reservation | Prize Pool | Tested with `PayoutExceedsReservation` error |

### 5.2 Arithmetic Safety

- All contracts use `checked_add`, `checked_sub`, `checked_mul`, `checked_div`
- Overflow returns `Error::Overflow`
- No unchecked arithmetic in any contract
- Soroban SDK enforces overflow checks in release builds

### 5.3 Authorization Model

**Admin Actions (require admin auth):**
- Contract initialization
- Role grants/revokes (Access Control)
- Game authorization (User Balance, RNG)
- Emergency pause/unpause
- Prize pool reserve/release/payout

**Game Contract Actions (require whitelist):**
- User Balance credit/debit
- RNG request submission

**Player Actions (require user auth):**
- Deposits, withdrawals
- Bet placement
- Reward claims

---

## 6. Known Limitations & Risks

### 6.1 Direct Token Transfers

**Risk:** If tokens are sent directly to Prize Pool or User Balance contracts (not via `fund`/`deposit`), accounting invariants break.

**Impact:** `available + total_reserved` or `sum(user_balances)` will not match actual token balance.

**Mitigation:** Document prominently; future: add `sweep_excess` admin function.

### 6.2 Oracle Centralization

**Risk:** Single oracle address can censor RNG fulfillment.

**Impact:** Games relying on pending RNG requests cannot resolve.

**Mitigation:**
- Admin can update oracle address
- Future: Multi-oracle commit-reveal aggregation

### 6.3 Admin Key Compromise

**Risk:** Single admin private key controls all privileged operations.

**Impact:** Attacker can drain Prize Pool, manipulate roles, pause platform permanently.

**Mitigation:**
- Use multi-sig wallet for admin (e.g., 3-of-5)
- Implement timelocks on critical operations (future)

### 6.4 Pattern Puzzle Scalability

**Risk:** `MAX_PLAYERS_PER_ROUND = 500` caps participation.

**Impact:** Popular rounds may hit limit and reject new players.

**Mitigation:** Document limit; consider sharding rounds in future.

### 6.5 No Upgrade Mechanism

**Risk:** Contracts are immutable once deployed.

**Impact:** Bugs cannot be patched; requires redeployment and migration.

**Mitigation:**
- Thorough audit before mainnet
- Emergency Pause for damage control
- Clear migration plan documented

---

## 7. Deployment Architecture

### 7.1 Mainnet Configuration

**Network:** Stellar Mainnet (Soroban)

**Admin Account:**
- **Type:** Multi-sig wallet (recommended 3-of-5 or higher)
- **Powers:** All contract initializations, role management, emergency pause

**Oracle Account (RNG):**
- **Type:** Backend service with HSM-protected key
- **Powers:** Fulfill randomness requests
- **Commitment:** Publish SHA-256(server_seed) before each game round begins

**Token:**
- SEP-41 Stellar Asset Contract (e.g., USDC)

### 7.2 Contract Addresses (Placeholder - TBD at Deployment)

```
Prize Pool:       C...
User Balance:     C...
Random Generator: C...
Coin Flip:        C...
Pattern Puzzle:   C...
Emergency Pause:  C...
Access Control:   C...
```

---

## 8. Incident Response

### 8.1 Emergency Procedures

**Level 1: Suspected Exploit**
1. Admin calls `emergency_pause.pause(admin)`
2. All contracts importing `require_not_paused` halt new operations
3. Investigate root cause
4. If false alarm: `emergency_pause.unpause(admin)`

**Level 2: Confirmed Exploit**
1. Pause platform immediately
2. Snapshot all contract state (ledger entry export)
3. Calculate affected user balances
4. Deploy patched contracts
5. Migrate user balances via admin-signed airdrops
6. Announce migration plan

**Level 3: Admin Key Compromise**
1. If detected early: pause and rotate admin via existing multi-sig
2. If detected late (attacker has drained funds): coordinate with Stellar validators for potential rollback (extreme measure)
3. Deploy new contracts with new admin
4. Reimburse users from insurance fund or protocol treasury

### 8.2 Communication Channels

- **Primary:** Official Discord/Telegram announcements
- **Secondary:** On-chain events (monitor `Paused`/`Unpaused` events)
- **Tertiary:** Website banner + API status endpoint

---

## 9. Testing Coverage

### 9.1 Unit Tests

| Contract | Tests | Coverage |
|----------|-------|----------|
| Prize Pool | 9 tests | Initialization, fund, reserve, release, payout, auth, overflow |
| User Balance | 18 tests | Deposit, withdraw, credit, debit, auth, overflow, limits |
| Pattern Puzzle | ~15 tests | Create, submit, resolve, claim, commit-reveal, max players |
| Coin Flip | 13 tests | Place bet, resolve win/loss, RNG integration, limits, duplicates |
| Random Generator | 15 tests | Request, fulfill, duplicate IDs, unauthorized, bounds, determinism |
| Emergency Pause | 10 tests | Init, pause, unpause, duplicates, auth, guard behavior |

### 9.2 Integration Test Gaps (To Address)

- [ ] Cross-contract: Coin Flip → User Balance → Prize Pool full cycle
- [ ] Cross-contract: Pattern Puzzle → User Balance → Prize Pool full cycle
- [ ] Emergency Pause integration with all game contracts
- [ ] High-load scenario: 500 players in Pattern Puzzle
- [ ] Concurrent RNG requests from multiple games

---

## 10. Compliance & Best Practices

### 10.1 Soroban Best Practices

- ✅ All contracts use `#![no_std]`
- ✅ Authorization via `Address::require_auth()` on caller-sensitive functions
- ✅ Instance storage for config; persistent storage for per-user/per-game data
- ✅ TTL extension on every persistent write (30 days)
- ✅ Events emitted for all state changes
- ✅ Safe arithmetic with `checked_*` operations
- ✅ Reentrancy protection (state update before external call)
- ✅ Release profile: `opt-level = "z"`, `overflow-checks = true`, `lto = true`

### 10.2 Code Quality

- ✅ All contracts pass `cargo clippy -- -D warnings`
- ✅ All contracts have comprehensive unit tests (`cargo test`)
- ✅ CI/CD pipeline enforces tests + clippy on all PRs
- ✅ Git hooks for pre-commit formatting

---

## 11. Audit Scope

### 11.1 In-Scope Contracts

1. **Prize Pool** (`contracts/prize-pool/src/lib.rs`) — 827 lines
2. **User Balance** (`contracts/user-balance/src/lib.rs`) — 333 lines
3. **Pattern Puzzle** (`contracts/pattern-puzzle/src/lib.rs`) — 848 lines
4. **Coin Flip** (`contracts/coin-flip/src/lib.rs`) — 314 lines
5. **Random Generator** (`contracts/random-generator/src/lib.rs`) — 717 lines
6. **Emergency Pause** (`contracts/emergency-pause/src/lib.rs`) — 166 lines
7. **Access Control** (`contracts/access-control/src/lib.rs`) — 118 lines

**Total:** ~3,323 lines of Rust smart contract code

### 11.2 Out-of-Scope

- Backend API (Node.js) — separate security review
- Frontend (React) — separate security review
- Stellar core protocol
- SEP-41 token implementation

### 11.3 Focus Areas for Auditors

**High Priority:**
1. Token custody correctness (Prize Pool, User Balance)
2. Randomness fairness (RNG commit-reveal, Coin Flip integration)
3. Authorization bypasses (all privileged methods)
4. Arithmetic overflow/underflow
5. Reentrancy vulnerabilities
6. Game logic correctness (duplicate claims, state machine)

**Medium Priority:**
7. Storage TTL management
8. Event emission completeness
9. Gas optimization opportunities
10. Emergency pause integration gaps

**Low Priority:**
11. Code style and readability
12. Documentation completeness

---

## 12. Post-Audit Action Plan

1. **Findings Received:** Triage using severity matrix (see SECURITY_AUDIT_CHECKLIST.md)
2. **Critical/High Fixes:** Implement immediately, re-audit if needed
3. **Medium Fixes:** Implement before mainnet launch
4. **Low/Informational:** Document as known issues or defer to v2
5. **Retest:** Auditor verifies fixes
6. **Public Disclosure:** Publish audit report + remediation status
7. **Mainnet Deploy:** Only after all Critical/High issues resolved

---

## 13. Contact Information

**Project Team:**
- Security Lead: [TBD]
- Smart Contract Lead: [TBD]
- Technical Contact: [TBD]

**Auditor:** [TBD]

**Audit Timeline:** [TBD]

---

## Appendix A: Contract Call Graphs

```
Player Actions:
  Player → User Balance.deposit(tokens)
  Player → Coin Flip.place_bet() → User Balance (future) → RNG.request_random()
  Player → Pattern Puzzle.submit_solution()
  Player → User Balance.withdraw(tokens)

Admin Actions:
  Admin → Prize Pool.fund()
  Admin → Prize Pool.reserve(game_id)
  Admin → Prize Pool.payout(winner) → Token.transfer()
  Admin → User Balance.authorize_game(game_addr)
  Admin → RNG.authorize(caller)
  Admin → Emergency Pause.pause/unpause()

Oracle Actions:
  Oracle → RNG.fulfill_random(seed)

Game Resolution:
  Anyone → Coin Flip.resolve_bet() → RNG.get_result() → Token.transfer(winner)
  Admin → Pattern Puzzle.resolve_round(answer)
  Player → Pattern Puzzle.claim_reward() → Prize Pool.payout()
```

---

**End of Security Audit Preparation Document**
