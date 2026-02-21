/**
 * Soroban Contract Client — StellarCade Abstraction Layer
 *
 * Production-grade TypeScript client that wraps Soroban RPC interactions for
 * all StellarCade contracts (AchievementBadge, PrizePool, AccessControl,
 * CoinFlip).
 *
 * ## Design principles
 * - **UI-agnostic**: no React/DOM imports; hooks live in `src/hooks/`.
 * - **Validated inputs**: every public method validates parameters before
 *   touching the network; errors are `SorobanClientError` instances.
 * - **Unified result envelope**: all methods return `ContractResult<T>`,
 *   forcing callers to handle both success and failure paths at compile time.
 * - **Retry with backoff**: retryable errors (network, rate-limit) are
 *   automatically retried with exponential backoff; terminal errors are not.
 * - **Idempotency key tracking**: duplicate keys within a session emit a
 *   console warning to catch accidental double-submissions.
 *
 * ## Dependencies
 * - `@stellar/stellar-sdk` for XDR building, transaction assembly, and RPC.
 * - `WalletProvider` interface (implemented by Freighter adapter or test mock).
 * - `ContractAddressRegistry` for address lookups.
 */

import {
  Contract,
  Networks,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  xdr,
  SorobanRpc,
  type Keypair,
} from "@stellar/stellar-sdk";

import type { ContractAddressRegistry } from "../store/contractAddressRegistry";
import { SorobanClientError, SorobanErrorCode } from "../types/errors";
import type {
  CallOptions,
  ContractResult,
  DefineBadgeParams,
  PoolState,
  WalletProvider,
} from "../types/contracts";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_FEE = 100; // stroops
const DEFAULT_TIMEOUT_SECS = 30;
const DEFAULT_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

/** Stellar/Soroban public key format: G + 55 base32 chars. */
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
/** Soroban contract address: C + 55 base32 chars. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;
/** Hex SHA-256 hash: exactly 64 lowercase hex chars. */
const HEX_HASH_RE = /^[0-9a-f]{64}$/;

// ── Internal helpers ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof SorobanClientError) {
    return err.retryable;
  }
  // Treat generic network errors (fetch failures) as retryable.
  if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
    return true;
  }
  return false;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ── Main Client ────────────────────────────────────────────────────────────────

/**
 * `SorobanContractClient` is the single entry point for all on-chain
 * interactions in the StellarCade frontend.
 *
 * Instantiate once per session (e.g., inside a React context) and share the
 * instance across hooks/components.
 *
 * @example
 * ```ts
 * const registry = ContractAddressRegistry.fromEnv();
 * const wallet = new FreighterWalletAdapter();
 * const client = new SorobanContractClient(
 *   "https://soroban-testnet.stellar.org",
 *   Networks.TESTNET,
 *   registry,
 *   wallet,
 * );
 *
 * const result = await client.pool_getState();
 * if (result.success) console.log(result.data.available);
 * ```
 */
export class SorobanContractClient {
  private readonly rpc: SorobanRpc.Server;
  private readonly seenIdempotencyKeys = new Set<string>();

  constructor(
    private readonly rpcUrl: string,
    private readonly networkPassphrase: string,
    private readonly addressRegistry: ContractAddressRegistry,
    private readonly walletProvider: WalletProvider,
  ) {
    this.rpc = new SorobanRpc.Server(rpcUrl);
  }

  // ── Precondition guards ──────────────────────────────────────────────────────

  /**
   * Enforce wallet is connected and on the correct network.
   * Must be called before any state-mutating operation.
   */
  private async requireWallet(): Promise<string> {
    const connected = await this.walletProvider.isConnected();
    if (!connected) {
      throw SorobanClientError.walletNotConnected();
    }

    const { networkPassphrase: walletPassphrase } =
      await this.walletProvider.getNetwork();

    if (walletPassphrase !== this.networkPassphrase) {
      throw SorobanClientError.networkMismatch(
        this.networkPassphrase,
        walletPassphrase,
      );
    }

    return this.walletProvider.getPublicKey();
  }

  // ── Input validation ─────────────────────────────────────────────────────────

  private validateStellarAddress(paramName: string, address: string): void {
    if (!STELLAR_ADDRESS_RE.test(address)) {
      throw SorobanClientError.invalidParam(
        paramName,
        `"${address}" is not a valid Stellar address (must be G + 55 base32 chars)`,
      );
    }
  }

  private validateContractAddress(paramName: string, address: string): void {
    if (!CONTRACT_ADDRESS_RE.test(address)) {
      throw SorobanClientError.invalidParam(
        paramName,
        `"${address}" is not a valid contract address (must be C + 55 base32 chars)`,
      );
    }
  }

  private validatePositiveAmount(paramName: string, amount: bigint): void {
    if (amount <= 0n) {
      throw SorobanClientError.invalidParam(
        paramName,
        `amount must be > 0, got ${amount}`,
      );
    }
  }

  private validateNonNegativeAmount(paramName: string, amount: bigint): void {
    if (amount < 0n) {
      throw SorobanClientError.invalidParam(
        paramName,
        `amount must be ≥ 0, got ${amount}`,
      );
    }
  }

  private validateHexHash(paramName: string, hash: string): void {
    if (!HEX_HASH_RE.test(hash)) {
      throw SorobanClientError.invalidParam(
        paramName,
        `"${hash}" is not a valid 32-byte SHA-256 hash (expected 64 lowercase hex chars)`,
      );
    }
  }

  // ── Idempotency tracking ─────────────────────────────────────────────────────

  private trackIdempotencyKey(key: string | undefined): void {
    if (!key) return;
    if (this.seenIdempotencyKeys.has(key)) {
      console.warn(
        `[SorobanContractClient] Idempotency key "${key}" has been used before in this session. ` +
          "Possible duplicate invocation — check for accidental re-submissions.",
      );
    }
    this.seenIdempotencyKeys.add(key);
  }

  // ── Retry with exponential back-off ─────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryableError(err) || attempt === maxRetries) {
          break;
        }
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }

    if (lastErr instanceof SorobanClientError) throw lastErr;

    throw new SorobanClientError({
      code: SorobanErrorCode.RetryExhausted,
      message: `Operation failed after ${maxRetries} retries.`,
      retryable: false,
      originalError: lastErr,
    });
  }

  // ── Result wrapper ───────────────────────────────────────────────────────────

  /**
   * Wraps an async supplier so that any thrown `SorobanClientError` (including
   * those thrown by validation helpers) is caught and returned as a failure
   * result instead of propagating as a thrown exception.
   *
   * This ensures every public method always returns `ContractResult<T>` rather
   * than throwing, fulfilling the API contract.
   */
  private async wrapResult<T>(fn: () => Promise<ContractResult<T>>): Promise<ContractResult<T>> {
    try {
      return await fn();
    } catch (err) {
      return { success: false, error: this.mapError(err) };
    }
  }

  // ── Error mapping ────────────────────────────────────────────────────────────

  private mapError(raw: unknown): SorobanClientError {
    if (raw instanceof SorobanClientError) return raw;

    const message = raw instanceof Error ? raw.message : String(raw);

    // User rejected signing in wallet
    if (message.toLowerCase().includes("user declined") ||
        message.toLowerCase().includes("user rejected")) {
      return new SorobanClientError({
        code: SorobanErrorCode.UserRejected,
        message: "Transaction was rejected by the user.",
        retryable: false,
        originalError: raw,
      });
    }

    // Soroban contract error (contains error code in result)
    if (message.includes("HostError") || message.includes("scErrorType")) {
      const codeMatch = /Error\(Contract, #(\d+)\)/.exec(message);
      const contractErrorCode = codeMatch ? parseInt(codeMatch[1], 10) : undefined;
      return new SorobanClientError({
        code: SorobanErrorCode.ContractError,
        message: `Contract returned an error${contractErrorCode !== undefined ? ` (code ${contractErrorCode})` : ""}: ${message}`,
        retryable: false,
        contractErrorCode,
        originalError: raw,
      });
    }

    // Simulation failure
    if (message.includes("simulation") || message.includes("simulate")) {
      return new SorobanClientError({
        code: SorobanErrorCode.SimulationFailed,
        message: `Transaction simulation failed: ${message}`,
        retryable: true,
        originalError: raw,
      });
    }

    // Generic network error (retryable)
    if (
      raw instanceof TypeError ||
      message.includes("fetch") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ENOTFOUND")
    ) {
      return new SorobanClientError({
        code: SorobanErrorCode.NetworkError,
        message: `Network error: ${message}`,
        retryable: true,
        originalError: raw,
      });
    }

    // Transaction submission failure
    if (message.includes("transaction") || message.includes("submit")) {
      return new SorobanClientError({
        code: SorobanErrorCode.TransactionFailed,
        message: `Transaction failed: ${message}`,
        retryable: false,
        originalError: raw,
      });
    }

    // Fallback: generic RPC error
    return new SorobanClientError({
      code: SorobanErrorCode.RpcError,
      message: `RPC error: ${message}`,
      retryable: true,
      originalError: raw,
    });
  }

  // ── Core simulation ──────────────────────────────────────────────────────────

  /**
   * Simulate a contract call without submitting a transaction.
   * Use this for read-only methods or preflight checks.
   */
  async simulate<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    opts: CallOptions = {},
  ): Promise<ContractResult<T>> {
    const { retries = DEFAULT_RETRIES } = opts;
    this.trackIdempotencyKey(opts.idempotencyKey);

    const execute = async (): Promise<ContractResult<T>> => {
      try {
        const sourceAccount = await this.rpc.getAccount(
          // Use a dummy source account for simulation — any funded account works.
          "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        );

        const contract = new Contract(contractId);
        const tx = new TransactionBuilder(sourceAccount, {
          fee: String(opts.fee ?? DEFAULT_FEE),
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(opts.timeoutSecs ?? DEFAULT_TIMEOUT_SECS)
          .build();

        const simResult = await this.rpc.simulateTransaction(tx);

        if (SorobanRpc.Api.isSimulationError(simResult)) {
          throw new SorobanClientError({
            code: SorobanErrorCode.SimulationFailed,
            message: `Simulation failed: ${simResult.error}`,
            retryable: false,
          });
        }

        const returnVal = simResult.result?.retval;
        const data = returnVal ? (scValToNative(returnVal) as T) : (undefined as T);

        return { success: true, data };
      } catch (err) {
        throw this.mapError(err);
      }
    };

    try {
      return await this.withRetry(execute, retries);
    } catch (err) {
      return { success: false, error: this.mapError(err) };
    }
  }

  // ── Core invocation ──────────────────────────────────────────────────────────

  /**
   * Simulate, sign, and submit a state-mutating contract call.
   * Requires a connected wallet on the correct network.
   */
  async invoke<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    opts: CallOptions = {},
  ): Promise<ContractResult<T>> {
    const { retries = DEFAULT_RETRIES } = opts;
    this.trackIdempotencyKey(opts.idempotencyKey);

    const execute = async (): Promise<ContractResult<T>> => {
      try {
        const sourcePublicKey = await this.requireWallet();
        const sourceAccount = await this.rpc.getAccount(sourcePublicKey);

        const contract = new Contract(contractId);
        const builtTx = new TransactionBuilder(sourceAccount, {
          fee: String(opts.fee ?? DEFAULT_FEE),
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(opts.timeoutSecs ?? DEFAULT_TIMEOUT_SECS)
          .build();

        // Simulate first to get the footprint + resource estimates.
        const simResult = await this.rpc.simulateTransaction(builtTx);

        if (SorobanRpc.Api.isSimulationError(simResult)) {
          throw new SorobanClientError({
            code: SorobanErrorCode.SimulationFailed,
            message: `Simulation failed: ${simResult.error}`,
            retryable: false,
          });
        }

        // Assemble the transaction with the simulation data (footprint, auth).
        const preparedTx = SorobanRpc.assembleTransaction(builtTx, simResult).build();

        // Sign via wallet provider.
        const signedXdr = await this.walletProvider.signTransaction(
          preparedTx.toXDR(),
          { networkPassphrase: this.networkPassphrase },
        );

        // Submit the signed transaction.
        const submitResult = await this.rpc.sendTransaction(
          TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase),
        );

        if (submitResult.status === "ERROR") {
          throw new SorobanClientError({
            code: SorobanErrorCode.TransactionFailed,
            message: `Transaction submission failed: ${JSON.stringify(submitResult.errorResult)}`,
            retryable: false,
          });
        }

        // Poll until the transaction is included in a ledger.
        const txHash = submitResult.hash;
        const txResult = await this.pollTransaction(txHash);

        const returnVal = txResult.returnValue;
        const data = returnVal ? (scValToNative(returnVal) as T) : (undefined as T);

        return {
          success: true,
          data,
          txHash,
          ledger: txResult.ledger,
        };
      } catch (err) {
        throw this.mapError(err);
      }
    };

    try {
      return await this.withRetry(execute, retries);
    } catch (err) {
      return { success: false, error: this.mapError(err) };
    }
  }

  // ── Transaction polling ──────────────────────────────────────────────────────

  private async pollTransaction(
    txHash: string,
    maxAttempts = 30,
    intervalMs = 2_000,
  ): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      const txResult = await this.rpc.getTransaction(txHash);

      if (txResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return txResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
      }

      if (txResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new SorobanClientError({
          code: SorobanErrorCode.TransactionFailed,
          message: `Transaction ${txHash} failed on-chain.`,
          retryable: false,
        });
      }

      // Status is NOT_FOUND or still pending — wait and retry.
      await sleep(intervalMs);
    }

    throw new SorobanClientError({
      code: SorobanErrorCode.TransactionFailed,
      message: `Transaction ${txHash} was not confirmed within the polling window.`,
      retryable: false,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AchievementBadge contract methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the AchievementBadge contract. May only be called once.
   *
   * @param admin - Admin address that will control badge operations.
   * @param rewardContract - Address of the downstream PrizePool contract.
   */
  async badge_init(
    admin: string,
    rewardContract: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateContractAddress("rewardContract", rewardContract);
      const contractId = this.addressRegistry.getAddress("achievementBadge");
      return this.invoke<void>(
        contractId,
        "init",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(rewardContract, { type: "address" }),
        ],
        opts,
      );
    });
  }

  /**
   * Define a new achievement badge. Admin only.
   *
   * @param admin - Admin address (must match stored admin).
   * @param params - Badge definition parameters.
   */
  async badge_define(
    admin: string,
    params: DefineBadgeParams,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateHexHash("criteriaHash", params.criteriaHash);
      this.validateNonNegativeAmount("reward", params.reward);
      if (params.badgeId < 0n) {
        throw SorobanClientError.invalidParam("badgeId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("achievementBadge");
      const criteriaBytes = hexToBytes(params.criteriaHash);
      return this.invoke<void>(
        contractId,
        "define_badge",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(params.badgeId, { type: "u64" }),
          xdr.ScVal.scvBytes(Buffer.from(criteriaBytes)),
          nativeToScVal(params.reward, { type: "i128" }),
        ],
        opts,
      );
    });
  }

  /**
   * Record that a user has been evaluated against a badge's criteria. Admin only.
   * Does not award the badge — call `badge_award` separately if qualified.
   */
  async badge_evaluateUser(
    admin: string,
    user: string,
    badgeId: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateStellarAddress("user", user);
      if (badgeId < 0n) {
        throw SorobanClientError.invalidParam("badgeId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("achievementBadge");
      return this.invoke<void>(
        contractId,
        "evaluate_user",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(user, { type: "address" }),
          nativeToScVal(badgeId, { type: "u64" }),
        ],
        opts,
      );
    });
  }

  /**
   * Award a badge to a user. Admin only.
   * The badge must be defined and not yet held by the user.
   */
  async badge_award(
    admin: string,
    user: string,
    badgeId: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateStellarAddress("user", user);
      if (badgeId < 0n) {
        throw SorobanClientError.invalidParam("badgeId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("achievementBadge");
      return this.invoke<void>(
        contractId,
        "award_badge",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(user, { type: "address" }),
          nativeToScVal(badgeId, { type: "u64" }),
        ],
        opts,
      );
    });
  }

  /**
   * Return the list of badge IDs awarded to `user`.
   * Read-only — does not require a wallet signature.
   */
  async badge_badgesOf(
    user: string,
    opts?: CallOptions,
  ): Promise<ContractResult<bigint[]>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("user", user);
      const contractId = this.addressRegistry.getAddress("achievementBadge");
      return this.simulate<bigint[]>(
        contractId,
        "badges_of",
        [nativeToScVal(user, { type: "address" })],
        opts,
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PrizePool contract methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the PrizePool contract. May only be called once.
   *
   * @param admin - Admin address that controls reserve/release/payout.
   * @param token - SEP-41 token contract address used for all transfers.
   */
  async pool_init(
    admin: string,
    token: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateContractAddress("token", token);
      const contractId = this.addressRegistry.getAddress("prizePool");
      return this.invoke<void>(
        contractId,
        "init",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(token, { type: "address" }),
        ],
        opts,
      );
    });
  }

  /**
   * Transfer `amount` tokens from `from` into the prize pool.
   * Any address may fund the pool.
   */
  async pool_fund(
    from: string,
    amount: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("from", from);
      this.validatePositiveAmount("amount", amount);
      const contractId = this.addressRegistry.getAddress("prizePool");
      return this.invoke<void>(
        contractId,
        "fund",
        [
          nativeToScVal(from, { type: "address" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
        opts,
      );
    });
  }

  /**
   * Earmark `amount` tokens for a specific game. Admin only.
   * Moves funds from available → reserved.
   */
  async pool_reserve(
    admin: string,
    gameId: bigint,
    amount: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validatePositiveAmount("amount", amount);
      if (gameId < 0n) {
        throw SorobanClientError.invalidParam("gameId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("prizePool");
      return this.invoke<void>(
        contractId,
        "reserve",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(gameId, { type: "u64" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
        opts,
      );
    });
  }

  /**
   * Return `amount` from a game's reservation back to the available pool.
   * Admin only. Used when a game ends with leftover or is cancelled.
   */
  async pool_release(
    admin: string,
    gameId: bigint,
    amount: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validatePositiveAmount("amount", amount);
      if (gameId < 0n) {
        throw SorobanClientError.invalidParam("gameId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("prizePool");
      return this.invoke<void>(
        contractId,
        "release",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(gameId, { type: "u64" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
        opts,
      );
    });
  }

  /**
   * Transfer `amount` tokens from a game's reservation to `to`. Admin only.
   * Multiple partial payouts per game are supported.
   */
  async pool_payout(
    admin: string,
    to: string,
    gameId: bigint,
    amount: bigint,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      this.validateStellarAddress("to", to);
      this.validatePositiveAmount("amount", amount);
      if (gameId < 0n) {
        throw SorobanClientError.invalidParam("gameId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("prizePool");
      return this.invoke<void>(
        contractId,
        "payout",
        [
          nativeToScVal(admin, { type: "address" }),
          nativeToScVal(to, { type: "address" }),
          nativeToScVal(gameId, { type: "u64" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
        opts,
      );
    });
  }

  /**
   * Return a point-in-time snapshot of the pool's accounting state.
   * Read-only — does not require a wallet signature.
   */
  async pool_getState(opts?: CallOptions): Promise<ContractResult<PoolState>> {
    return this.wrapResult(async () => {
      const contractId = this.addressRegistry.getAddress("prizePool");
      const result = await this.simulate<{ available: bigint; reserved: bigint }>(
        contractId,
        "get_pool_state",
        [],
        opts,
      );

      if (!result.success) return result;

      return {
        success: true as const,
        data: {
          available: BigInt(result.data?.available ?? 0),
          reserved: BigInt(result.data?.reserved ?? 0),
        },
        txHash: result.txHash,
        ledger: result.ledger,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AccessControl contract methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the AccessControl contract. May only be called once.
   */
  async acl_init(
    admin: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("admin", admin);
      const contractId = this.addressRegistry.getAddress("accessControl");
      return this.invoke<void>(
        contractId,
        "init",
        [nativeToScVal(admin, { type: "address" })],
        opts,
      );
    });
  }

  /**
   * Grant `role` to `account`. Admin only.
   */
  async acl_grantRole(
    role: string,
    account: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      if (!role.trim()) {
        throw SorobanClientError.invalidParam("role", "must not be empty");
      }
      this.validateStellarAddress("account", account);
      const contractId = this.addressRegistry.getAddress("accessControl");
      return this.invoke<void>(
        contractId,
        "grant_role",
        [
          nativeToScVal(role, { type: "symbol" }),
          nativeToScVal(account, { type: "address" }),
        ],
        opts,
      );
    });
  }

  /**
   * Revoke `role` from `account`. Admin only.
   */
  async acl_revokeRole(
    role: string,
    account: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      if (!role.trim()) {
        throw SorobanClientError.invalidParam("role", "must not be empty");
      }
      this.validateStellarAddress("account", account);
      const contractId = this.addressRegistry.getAddress("accessControl");
      return this.invoke<void>(
        contractId,
        "revoke_role",
        [
          nativeToScVal(role, { type: "symbol" }),
          nativeToScVal(account, { type: "address" }),
        ],
        opts,
      );
    });
  }

  /**
   * Check whether `account` has been granted `role`.
   * Read-only — does not require a wallet signature.
   */
  async acl_hasRole(
    role: string,
    account: string,
    opts?: CallOptions,
  ): Promise<ContractResult<boolean>> {
    return this.wrapResult(async () => {
      if (!role.trim()) {
        throw SorobanClientError.invalidParam("role", "must not be empty");
      }
      this.validateStellarAddress("account", account);
      const contractId = this.addressRegistry.getAddress("accessControl");
      return this.simulate<boolean>(
        contractId,
        "has_role",
        [
          nativeToScVal(role, { type: "symbol" }),
          nativeToScVal(account, { type: "address" }),
        ],
        opts,
      );
    });
  }

  /**
   * Return the current admin address.
   * Read-only — does not require a wallet signature.
   */
  async acl_getAdmin(opts?: CallOptions): Promise<ContractResult<string>> {
    return this.wrapResult(async () => {
      const contractId = this.addressRegistry.getAddress("accessControl");
      return this.simulate<string>(contractId, "get_admin", [], opts);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CoinFlip contract methods (skeleton — contract is not yet fully implemented)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Play the coin flip game.
   *
   * @param player - Stellar address of the player.
   * @param amount - Wager amount in token stroops (must be > 0).
   * @param choice - 0 = heads, 1 = tails.
   * @param seed - 32-byte random seed as a 64-char hex string.
   */
  async coinFlip_play(
    player: string,
    amount: bigint,
    choice: 0 | 1,
    seed: string,
    opts?: CallOptions,
  ): Promise<ContractResult<void>> {
    return this.wrapResult(async () => {
      this.validateStellarAddress("player", player);
      this.validatePositiveAmount("amount", amount);
      if (choice !== 0 && choice !== 1) {
        throw SorobanClientError.invalidParam("choice", "must be 0 (heads) or 1 (tails)");
      }
      this.validateHexHash("seed", seed);
      const contractId = this.addressRegistry.getAddress("coinFlip");
      const seedBytes = hexToBytes(seed);
      return this.invoke<void>(
        contractId,
        "play",
        [
          nativeToScVal(player, { type: "address" }),
          nativeToScVal(amount, { type: "i128" }),
          nativeToScVal(choice, { type: "u32" }),
          xdr.ScVal.scvBytes(Buffer.from(seedBytes)),
        ],
        opts,
      );
    });
  }

  /**
   * Retrieve the result of a previous coin flip game.
   * Read-only — does not require a wallet signature.
   */
  async coinFlip_getGameResult(
    gameId: number,
    opts?: CallOptions,
  ): Promise<ContractResult<number>> {
    return this.wrapResult(async () => {
      if (gameId < 0) {
        throw SorobanClientError.invalidParam("gameId", "must be ≥ 0");
      }
      const contractId = this.addressRegistry.getAddress("coinFlip");
      return this.simulate<number>(
        contractId,
        "get_game_result",
        [nativeToScVal(gameId, { type: "u32" })],
        opts,
      );
    });
  }
}

// ── Freighter Wallet Adapter ───────────────────────────────────────────────────

/**
 * Adapter that implements `WalletProvider` using the Stellar Freighter browser
 * extension API.
 *
 * Import `@stellar/freighter-api` and pass an instance to
 * `SorobanContractClient` in a browser environment.
 *
 * In tests, use `MockWalletProvider` from `tests/__mocks__/wallet.ts` instead.
 */
export class FreighterWalletAdapter implements WalletProvider {
  // Dynamically loaded to avoid bundling issues in SSR/Node environments.
  private freighter: typeof import("@stellar/freighter-api") | null = null;

  private async getFreighter() {
    if (!this.freighter) {
      this.freighter = await import("@stellar/freighter-api");
    }
    return this.freighter;
  }

  async isConnected(): Promise<boolean> {
    try {
      const f = await this.getFreighter();
      const result = await f.isConnected();
      return typeof result === "object" ? result.isConnected : result;
    } catch {
      return false;
    }
  }

  async getPublicKey(): Promise<string> {
    const f = await this.getFreighter();
    const result = await f.getPublicKey();
    if (typeof result === "object" && "error" in result) {
      throw SorobanClientError.walletNotConnected();
    }
    return typeof result === "string" ? result : (result as { publicKey: string }).publicKey;
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    const f = await this.getFreighter();
    const result = await f.getNetwork();
    if (typeof result === "object" && "error" in result) {
      throw SorobanClientError.walletNotConnected();
    }
    return result as { network: string; networkPassphrase: string };
  }

  async signTransaction(
    txXdr: string,
    opts?: { network?: string; networkPassphrase?: string },
  ): Promise<string> {
    const f = await this.getFreighter();
    const result = await f.signTransaction(txXdr, {
      network: opts?.network,
      networkPassphrase: opts?.networkPassphrase,
    });

    if (typeof result === "object" && "error" in result) {
      const errMsg = (result as { error: string }).error;
      if (errMsg.toLowerCase().includes("decline") || errMsg.toLowerCase().includes("reject")) {
        throw new SorobanClientError({
          code: SorobanErrorCode.UserRejected,
          message: "User declined to sign the transaction.",
          retryable: false,
        });
      }
      throw new SorobanClientError({
        code: SorobanErrorCode.RpcError,
        message: errMsg,
        retryable: false,
      });
    }

    return typeof result === "string" ? result : (result as { signedTxXdr: string }).signedTxXdr;
  }
}

// ── Re-exports for convenience ─────────────────────────────────────────────────

export { Networks };
export type { Keypair };
