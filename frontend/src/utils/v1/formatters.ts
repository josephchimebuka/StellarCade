/**
 * Formatters — amount, address, and date formatting helpers (v1).
 *
 * Pure, UI-agnostic utilities for logs, displays, and analytics.
 * All functions validate inputs and return deterministic fallbacks for invalid data.
 *
 * @module utils/v1/formatters
 */

// ── Constants ───────────────────────────────────────────────────────────────────

/** Stellar native asset: 1 XLM = 10^7 stroops. */
export const STROOPS_PER_XLM = 10_000_000;

/** Default fallback when amount cannot be formatted. */
export const FALLBACK_AMOUNT = "—";

/** Default fallback when address cannot be formatted. */
export const FALLBACK_ADDRESS = "—";

/** Default fallback when date cannot be formatted. */
export const FALLBACK_DATE = "—";

// ── Types ───────────────────────────────────────────────────────────────────────

export interface FormatAmountOptions {
  /** Number of decimal places. Default 7 for stroops-derived XLM. */
  precision?: number;
  /** Symbol to append (e.g. "XLM"). Omitted if not provided. */
  symbol?: string;
  /** If true, value is interpreted as stroops (divide by STROOPS_PER_XLM). Default true for Stellar. */
  fromStroops?: boolean;
  /** Locale for number formatting (e.g. "en-US"). Optional. */
  locale?: string;
}

export interface FormatAddressOptions {
  /** Characters to show at start. Default 4. */
  startChars?: number;
  /** Characters to show at end. Default 4. */
  endChars?: number;
  /** Separator between start and end. Default "…". */
  separator?: string;
}

export interface FormatDateOptions {
  /** If true, format in UTC; otherwise use local time. Default false. */
  useUtc?: boolean;
  /** BCP 47 locale (e.g. "en-US"). Optional; uses Intl default if omitted. */
  locale?: string;
  /** Fallback when timestamp is invalid. Default FALLBACK_DATE. */
  fallback?: string;
  /** DateStyle for Intl.DateTimeFormat. Default "medium". */
  dateStyle?: "full" | "long" | "medium" | "short";
  /** TimeStyle for Intl.DateTimeFormat. Optional. */
  timeStyle?: "full" | "long" | "medium" | "short";
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function isNil(v: unknown): v is null | undefined {
  return v === null || v === undefined;
}

function isSafeInteger(n: number): boolean {
  return Number.isInteger(n) && Number.isSafeInteger(n);
}

/** Stellar public key is 56 chars, base32; we only need to guard length and non-empty. */
function isAddressLike(s: string): boolean {
  return typeof s === "string" && s.length >= 12 && s.length <= 56 && /^[A-Z2-7]+$/.test(s);
}

// ── Amount ───────────────────────────────────────────────────────────────────────

/**
 * Format a token amount with optional precision and symbol.
 *
 * Accepts stroops (bigint/number) or whole units. Invalid input returns FALLBACK_AMOUNT.
 *
 * @param value - Amount in stroops (if fromStroops true) or whole units
 * @param options - Precision, symbol, fromStroops, locale
 * @returns Formatted string or fallback
 *
 * @example
 * ```ts
 * formatAmount(50_000_000n);                    // "5" (5 XLM, default symbol omitted)
 * formatAmount(50_000_000n, { symbol: "XLM" }); // "5 XLM"
 * formatAmount(12_345_678, { precision: 2 });   // "1.23"
 * formatAmount(null);                           // "—"
 * ```
 */
export function formatAmount(
  value: bigint | number | string | null | undefined,
  options: FormatAmountOptions = {},
): string {
  if (isNil(value)) return FALLBACK_AMOUNT;
  if (value === "") return FALLBACK_AMOUNT;

  const {
    precision = 7,
    symbol = "",
    fromStroops = true,
    locale,
  } = options;

  let num: number;
  if (typeof value === "bigint") {
    if (value < 0n) return FALLBACK_AMOUNT;
    num = fromStroops
      ? Number(value) / STROOPS_PER_XLM
      : Number(value);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return FALLBACK_AMOUNT;
    num = fromStroops ? value / STROOPS_PER_XLM : value;
  } else if (typeof value === "string") {
    const parsed = fromStroops
      ? Number(value) / STROOPS_PER_XLM
      : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return FALLBACK_AMOUNT;
    num = parsed;
  } else {
    return FALLBACK_AMOUNT;
  }

  const prec = isSafeInteger(precision) && precision >= 0 && precision <= 20 ? precision : 7;
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: prec,
  };
  if (locale) opts.locale = locale;

  const formatted = new Intl.NumberFormat(locale ?? undefined, opts).format(num);
  return symbol ? `${formatted} ${symbol}`.trim() : formatted;
}

// ── Address ──────────────────────────────────────────────────────────────────────

/**
 * Truncate a wallet address for display (e.g. GABC…xyz1).
 *
 * Validates address-like shape (length 12–56, base32 chars). Invalid input returns FALLBACK_ADDRESS.
 *
 * @param address - Full Stellar public key or similar address string
 * @param options - startChars, endChars, separator
 * @returns Truncated string or fallback
 *
 * @example
 * ```ts
 * formatAddress("GABC1234567890XYZ");           // "GABC…0XYZ" (4…4)
 * formatAddress("GABC1234567890XYZ", { startChars: 6, endChars: 4 }); // "GABC12…0XYZ"
 * formatAddress("");                            // "—"
 * ```
 */
export function formatAddress(
  address: string | null | undefined,
  options: FormatAddressOptions = {},
): string {
  if (isNil(address) || typeof address !== "string") return FALLBACK_ADDRESS;
  const trimmed = address.trim();
  if (!isAddressLike(trimmed)) return FALLBACK_ADDRESS;

  const startChars = Math.max(0, Math.min(20, options.startChars ?? 4));
  const endChars = Math.max(0, Math.min(20, options.endChars ?? 4));
  const separator = typeof options.separator === "string" ? options.separator : "…";

  if (trimmed.length <= startChars + endChars) return trimmed;
  const start = trimmed.slice(0, startChars);
  const end = endChars > 0 ? trimmed.slice(-endChars) : "";
  return `${start}${separator}${end}`;
}

// ── Date ────────────────────────────────────────────────────────────────────────

/**
 * Format a timestamp for display in local or UTC.
 *
 * Accepts ms or seconds (if value &gt; 1e12, treated as ms). Invalid input returns fallback.
 *
 * @param timestamp - Epoch ms or seconds (number)
 * @param options - useUtc, locale, fallback, dateStyle, timeStyle
 * @returns Formatted date string or fallback
 *
 * @example
 * ```ts
 * formatDate(Date.now());                    // "Feb 22, 2025, 4:30:00 PM" (local)
 * formatDate(Date.now(), { useUtc: true });   // "Feb 22, 2025, 9:30:00 PM" (UTC)
 * formatDate(0);                             // "Jan 1, 1970, ..."
 * formatDate(NaN);                           // "—"
 * ```
 */
export function formatDate(
  timestamp: number | null | undefined,
  options: FormatDateOptions = {},
): string {
  if (isNil(timestamp) || typeof timestamp !== "number") return options.fallback ?? FALLBACK_DATE;
  let ms = timestamp;
  if (Number.isFinite(ms) && ms > 0 && ms < 1e12) ms = ms * 1000;
  if (!Number.isFinite(ms) || ms < 0) return options.fallback ?? FALLBACK_DATE;

  const fallback = options.fallback ?? FALLBACK_DATE;
  try {
    const opts: Intl.DateTimeFormatOptions = {
      dateStyle: options.dateStyle ?? "medium",
      timeZone: options.useUtc ? "UTC" : undefined,
    };
    if (options.timeStyle) opts.timeStyle = options.timeStyle;
    const formatter = new Intl.DateTimeFormat(options.locale ?? undefined, opts);
    return formatter.format(ms);
  } catch {
    return fallback;
  }
}
