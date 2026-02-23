/**
 * Unit tests for formatters (amount, address, date).
 *
 * Tests cover normal behavior, edge cases, and failure paths.
 */

import { describe, it, expect } from "vitest";
import {
  formatAmount,
  formatAddress,
  formatDate,
  STROOPS_PER_XLM,
  FALLBACK_AMOUNT,
  FALLBACK_ADDRESS,
  FALLBACK_DATE,
} from "../../../src/utils/v1/formatters";

// ── formatAmount ─────────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("formats stroops as XLM with default precision", () => {
    expect(formatAmount(50_000_000n)).toBe("5");
    expect(formatAmount(10_000_000n)).toBe("1");
    expect(formatAmount(0n)).toBe("0");
  });

  it("accepts number in stroops", () => {
    expect(formatAmount(50_000_000)).toBe("5");
    expect(formatAmount(12_500_000)).toBe("1.25");
  });

  it("accepts string in stroops", () => {
    expect(formatAmount("50000000")).toBe("5");
    expect(formatAmount("10000000")).toBe("1");
  });

  it("appends symbol when provided", () => {
    expect(formatAmount(10_000_000n, { symbol: "XLM" })).toBe("1 XLM");
    expect(formatAmount(5_000_000n, { symbol: "XLM" })).toBe("0.5 XLM");
  });

  it("respects precision option", () => {
    expect(formatAmount(12_345_678n, { precision: 2 })).toBe("1.23");
    expect(formatAmount(12_345_678n, { precision: 0 })).toBe("1");
    expect(formatAmount(99_999_999n, { precision: 7 })).toBe("9.9999999");
  });

  it("fromStroops false treats value as whole units", () => {
    expect(formatAmount(100, { fromStroops: false })).toBe("100");
    expect(formatAmount(1.5, { fromStroops: false, precision: 1 })).toBe("1.5");
  });

  it("returns fallback for null", () => {
    expect(formatAmount(null)).toBe(FALLBACK_AMOUNT);
  });

  it("returns fallback for undefined", () => {
    expect(formatAmount(undefined)).toBe(FALLBACK_AMOUNT);
  });

  it("returns fallback for negative value", () => {
    expect(formatAmount(-1n)).toBe(FALLBACK_AMOUNT);
    expect(formatAmount(-100)).toBe(FALLBACK_AMOUNT);
  });

  it("returns fallback for invalid string", () => {
    expect(formatAmount("not-a-number")).toBe(FALLBACK_AMOUNT);
    expect(formatAmount("")).toBe(FALLBACK_AMOUNT);
  });

  it("returns fallback for NaN/Infinity", () => {
    expect(formatAmount(Number.NaN)).toBe(FALLBACK_AMOUNT);
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe(FALLBACK_AMOUNT);
  });

  it("clamps precision to safe range when invalid option", () => {
    expect(formatAmount(12_345_678n, { precision: -1 })).toBe("1.2345678");
    expect(formatAmount(12_345_678n, { precision: 100 })).toBe("1.2345678");
  });

  it("is deterministic across repeated calls", () => {
    const a = formatAmount(50_000_000n, { symbol: "XLM" });
    const b = formatAmount(50_000_000n, { symbol: "XLM" });
    expect(a).toBe(b);
  });
});

// ── formatAddress ────────────────────────────────────────────────────────────────

describe("formatAddress", () => {
  const validAddress = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJ";

  it("truncates with default 4…4", () => {
    expect(formatAddress(validAddress)).toBe("GABC…GHIJ");
  });

  it("respects startChars and endChars", () => {
    expect(formatAddress(validAddress, { startChars: 6, endChars: 4 })).toBe(
      "GABCDE…GHIJ",
    );
    expect(formatAddress(validAddress, { startChars: 2, endChars: 2 })).toBe(
      "GA…IJ",
    );
  });

  it("respects custom separator", () => {
    expect(formatAddress(validAddress, { separator: "..." })).toBe(
      "GABC...GHIJ",
    );
  });

  it("returns full string when shorter than start+end", () => {
    const exact = "GABC234567AB"; // 12 chars; with 6+6 we show full
    expect(formatAddress(exact, { startChars: 6, endChars: 6 })).toBe(exact);
  });

  it("returns fallback for null", () => {
    expect(formatAddress(null)).toBe(FALLBACK_ADDRESS);
  });

  it("returns fallback for undefined", () => {
    expect(formatAddress(undefined)).toBe(FALLBACK_ADDRESS);
  });

  it("returns fallback for empty string", () => {
    expect(formatAddress("")).toBe(FALLBACK_ADDRESS);
  });

  it("returns fallback for too-short string", () => {
    expect(formatAddress("GAB")).toBe(FALLBACK_ADDRESS);
  });

  it("returns fallback for invalid characters", () => {
    expect(formatAddress("GABC1234567890!!!")).toBe(FALLBACK_ADDRESS);
    expect(formatAddress("gabcdefghijkl")).toBe(FALLBACK_ADDRESS);
  });

  it("trims whitespace before validating", () => {
    expect(formatAddress(`  ${validAddress}  `)).toBe("GABC…GHIJ");
  });

  it("clamps startChars/endChars to 0-20", () => {
    expect(formatAddress(validAddress, { startChars: 100, endChars: 0 })).toBe(
      validAddress.slice(0, 20) + "…",
    );
  });

  it("is deterministic across repeated calls", () => {
    const a = formatAddress(validAddress);
    const b = formatAddress(validAddress);
    expect(a).toBe(b);
  });
});

// ── formatDate ───────────────────────────────────────────────────────────────────

describe("formatDate", () => {
  const epochMs = 0;
  const someMs = 1_700_000_000_000; // 2023 Nov 15-ish

  it("formats epoch ms in local by default", () => {
    const out = formatDate(epochMs);
    expect(out).toBeTruthy();
    expect(out).not.toBe(FALLBACK_DATE);
    expect(out).toContain("1970");
  });

  it("formats with useUtc true", () => {
    const out = formatDate(someMs, { useUtc: true });
    expect(out).toBeTruthy();
    expect(out).not.toBe(FALLBACK_DATE);
  });

  it("accepts seconds and treats as ms when value < 1e12", () => {
    const out = formatDate(1_700_000_000, { useUtc: true });
    expect(out).toBeTruthy();
    expect(out).not.toBe(FALLBACK_DATE);
  });

  it("returns fallback for null", () => {
    expect(formatDate(null)).toBe(FALLBACK_DATE);
  });

  it("returns fallback for undefined", () => {
    expect(formatDate(undefined)).toBe(FALLBACK_DATE);
  });

  it("returns fallback for NaN", () => {
    expect(formatDate(Number.NaN)).toBe(FALLBACK_DATE);
  });

  it("returns fallback for negative timestamp", () => {
    expect(formatDate(-1)).toBe(FALLBACK_DATE);
  });

  it("uses custom fallback when provided", () => {
    expect(formatDate(null, { fallback: "N/A" })).toBe("N/A");
    expect(formatDate(Number.NaN, { fallback: "Invalid" })).toBe("Invalid");
  });

  it("respects dateStyle", () => {
    const short = formatDate(someMs, { dateStyle: "short" });
    const long = formatDate(someMs, { dateStyle: "long" });
    expect(short).toBeTruthy();
    expect(long).toBeTruthy();
  });

  it("is deterministic for same input", () => {
    const a = formatDate(someMs);
    const b = formatDate(someMs);
    expect(a).toBe(b);
  });
});

// ── Constants ───────────────────────────────────────────────────────────────────

describe("formatter constants", () => {
  it("STROOPS_PER_XLM is 10^7", () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000);
  });

  it("fallback constants are non-empty strings", () => {
    expect(typeof FALLBACK_AMOUNT).toBe("string");
    expect(typeof FALLBACK_ADDRESS).toBe("string");
    expect(typeof FALLBACK_DATE).toBe("string");
    expect(FALLBACK_AMOUNT.length).toBeGreaterThan(0);
    expect(FALLBACK_ADDRESS.length).toBeGreaterThan(0);
    expect(FALLBACK_DATE.length).toBeGreaterThan(0);
  });
});
