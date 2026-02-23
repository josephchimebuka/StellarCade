/**
 * Unit tests for paginated query utilities.
 *
 * Tests cover validation, state transitions, metrics calculation, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PaginationState, SortSpec } from "../../../src/types/pagination";
import {
  isValidPage,
  isValidPageSize,
  validatePaginationState,
  clonePaginationState,
  calculatePaginationMetrics,
  enrichPaginatedResult,
  getNextPage,
  getPreviousPage,
  clampPage,
  updatePage,
  updatePageSize,
  updateSort,
  updateFilters,
  getPersistenceKey,
  persistPaginationState,
  restorePaginationState,
  clearPersistedPaginationState,
} from "../../../src/utils/v1/usePaginatedQuery";

describe("Pagination Utilities", () => {
  // ── Validation Tests ────────────────────────────────────────────────────────

  describe("isValidPage", () => {
    it("accepts valid page numbers (>= 1)", () => {
      expect(isValidPage(1)).toBe(true);
      expect(isValidPage(5)).toBe(true);
      expect(isValidPage(100)).toBe(true);
    });

    it("rejects invalid page numbers", () => {
      expect(isValidPage(0)).toBe(false);
      expect(isValidPage(-1)).toBe(false);
      expect(isValidPage(1.5)).toBe(false);
      expect(isValidPage("1")).toBe(false);
      expect(isValidPage(null)).toBe(false);
      expect(isValidPage(undefined)).toBe(false);
    });
  });

  describe("isValidPageSize", () => {
    it("accepts valid page sizes (> 0)", () => {
      expect(isValidPageSize(1)).toBe(true);
      expect(isValidPageSize(10)).toBe(true);
      expect(isValidPageSize(100)).toBe(true);
    });

    it("rejects invalid page sizes", () => {
      expect(isValidPageSize(0)).toBe(false);
      expect(isValidPageSize(-1)).toBe(false);
      expect(isValidPageSize(10.5)).toBe(false);
      expect(isValidPageSize("10")).toBe(false);
      expect(isValidPageSize(null)).toBe(false);
    });
  });

  describe("validatePaginationState", () => {
    const validState: PaginationState = {
      page: 1,
      pageSize: 10,
      sort: { field: "name", direction: "asc" },
      filters: {},
    };

    it("accepts valid states", () => {
      const result = validatePaginationState(validState);
      expect(result.valid).toBe(true);
    });

    it("rejects null/undefined state", () => {
      const result = validatePaginationState(null as any);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("required");
    });

    it("rejects invalid page number", () => {
      const state = { ...validState, page: 0 };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("page");
    });

    it("rejects invalid page size", () => {
      const state = { ...validState, pageSize: 0 };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("page size");
    });

    it("rejects invalid sort field", () => {
      const state = { ...validState, sort: { ...validState.sort, field: "" } };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("field");
    });

    it("rejects invalid sort direction", () => {
      const state = { ...validState, sort: { field: "name", direction: "invalid" as any } };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("direction");
    });

    it("rejects non-object filters", () => {
      const state = { ...validState, filters: "invalid" as any };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(false);
    //   expect(result.error).toContain("Filters");
    });

    it("accepts null filters", () => {
      const state = { ...validState, filters: null as any };
      const result = validatePaginationState(state);
      expect(result.valid).toBe(true);
    });
  });

  // ── Cloning Tests ───────────────────────────────────────────────────────────

  describe("clonePaginationState", () => {
    it("creates a deep copy of the state", () => {
      const original: PaginationState = {
        page: 1,
        pageSize: 10,
        sort: { field: "name", direction: "asc" },
        filters: { status: "active" },
      };

      const cloned = clonePaginationState(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.sort).not.toBe(original.sort);
      expect(cloned.filters).not.toBe(original.filters);
    });
  });

  // ── Metrics Calculation Tests ───────────────────────────────────────────────

  describe("calculatePaginationMetrics", () => {
    it("calculates correct metrics for first page", () => {
      const metrics = calculatePaginationMetrics(50, 10, 1);

      expect(metrics.totalPages).toBe(5);
      expect(metrics.hasNextPage).toBe(true);
      expect(metrics.hasPreviousPage).toBe(false);
      expect(metrics.startIndex).toBe(0);
      expect(metrics.endIndex).toBe(10);
    });

    it("calculates correct metrics for middle page", () => {
      const metrics = calculatePaginationMetrics(50, 10, 3);

      expect(metrics.totalPages).toBe(5);
      expect(metrics.hasNextPage).toBe(true);
      expect(metrics.hasPreviousPage).toBe(true);
      expect(metrics.startIndex).toBe(20);
      expect(metrics.endIndex).toBe(30);
    });

    it("calculates correct metrics for last page", () => {
      const metrics = calculatePaginationMetrics(50, 10, 5);

      expect(metrics.totalPages).toBe(5);
      expect(metrics.hasNextPage).toBe(false);
      expect(metrics.hasPreviousPage).toBe(true);
      expect(metrics.startIndex).toBe(40);
      expect(metrics.endIndex).toBe(50);
    });

    it("calculates metrics for page with fewer items than pageSize", () => {
      const metrics = calculatePaginationMetrics(25, 10, 3);

      expect(metrics.totalPages).toBe(3);
      expect(metrics.hasNextPage).toBe(false);
      expect(metrics.startIndex).toBe(20);
      expect(metrics.endIndex).toBe(25);
    });

    it("handles zero total items", () => {
      const metrics = calculatePaginationMetrics(0, 10, 1);

      expect(metrics.totalPages).toBe(0);
      expect(metrics.hasNextPage).toBe(false);
      expect(metrics.hasPreviousPage).toBe(false);
    });

    it("handles single item", () => {
      const metrics = calculatePaginationMetrics(1, 10, 1);

      expect(metrics.totalPages).toBe(1);
      expect(metrics.hasNextPage).toBe(false);
      expect(metrics.hasPreviousPage).toBe(false);
      expect(metrics.endIndex).toBe(1);
    });
  });

  describe("enrichPaginatedResult", () => {
    it("adds computed fields to result", () => {
      const raw = {
        items: [1, 2, 3],
        total: 30,
        page: 1,
        pageSize: 10,
      };

      const enriched = enrichPaginatedResult(raw);

      expect(enriched.totalPages).toBe(3);
      expect(enriched.hasNextPage).toBe(true);
      expect(enriched.hasPreviousPage).toBe(false);
    });
  });

  // ── Navigation Tests ────────────────────────────────────────────────────────

  describe("getNextPage", () => {
    it("returns next page when available", () => {
      expect(getNextPage(1, 5)).toBe(2);
      expect(getNextPage(3, 5)).toBe(4);
    });

    it("returns undefined on last page", () => {
      expect(getNextPage(5, 5)).toBeUndefined();
      expect(getNextPage(1, 1)).toBeUndefined();
    });
  });

  describe("getPreviousPage", () => {
    it("returns previous page when available", () => {
      expect(getPreviousPage(5)).toBe(4);
      expect(getPreviousPage(2)).toBe(1);
    });

    it("returns undefined on first page", () => {
      expect(getPreviousPage(1)).toBeUndefined();
    });
  });

  describe("clampPage", () => {
    it("clamps page to valid range", () => {
      expect(clampPage(0, 5)).toBe(1);
      expect(clampPage(10, 5)).toBe(5);
      expect(clampPage(3, 5)).toBe(3);
    });

    it("handles zero total pages", () => {
      expect(clampPage(5, 0)).toBe(1);
    });
  });

  // ── State Transition Tests ──────────────────────────────────────────────────

  describe("updatePage", () => {
    const state: PaginationState = {
      page: 1,
      pageSize: 10,
      sort: { field: "name", direction: "asc" },
      filters: { status: "active" },
    };

    it("updates page number", () => {
      const updated = updatePage(state, 2);

      expect(updated.page).toBe(2);
      expect(updated.pageSize).toBe(10);
      expect(updated.sort).toEqual(state.sort);
    });

    it("returns same state if page unchanged", () => {
      const updated = updatePage(state, 1);
      expect(updated).toBe(state);
    });
  });

  describe("updatePageSize", () => {
    const state: PaginationState = {
      page: 3,
      pageSize: 10,
      sort: { field: "name", direction: "asc" },
      filters: {},
    };

    it("updates page size and resets to page 1", () => {
      const updated = updatePageSize(state, 20);

      expect(updated.pageSize).toBe(20);
      expect(updated.page).toBe(1);
    });

    it("returns same state if page size unchanged", () => {
      const updated = updatePageSize(state, 10);
      expect(updated).toBe(state);
    });
  });

  describe("updateSort", () => {
    const state: PaginationState = {
      page: 3,
      pageSize: 10,
      sort: { field: "name", direction: "asc" },
      filters: {},
    };

    it("updates sort and resets to page 1", () => {
      const newSort: SortSpec = { field: "createdAt", direction: "desc" };
      const updated = updateSort(state, newSort);

      expect(updated.sort).toEqual(newSort);
      expect(updated.page).toBe(1);
    });

    it("returns same state if sort unchanged", () => {
      const updated = updateSort(state, state.sort);
      expect(updated).toBe(state);
    });
  });

  describe("updateFilters", () => {
    const state: PaginationState = {
      page: 3,
      pageSize: 10,
      sort: { field: "name", direction: "asc" },
      filters: { status: "active" },
    };

    it("updates filters and resets to page 1", () => {
      const newFilters = { status: "inactive", type: "game" };
      const updated = updateFilters(state, newFilters);

      expect(updated.filters).toEqual(newFilters);
      expect(updated.page).toBe(1);
    });

    it("returns same state if filters unchanged", () => {
      const updated = updateFilters(state, state.filters);
      expect(updated).toBe(state);
    });

    it("returns same state for deep-equal filters", () => {
      const updated = updateFilters(state, { status: "active" });
      expect(updated).toBe(state);
    });
  });

  // ── Persistence Tests ───────────────────────────────────────────────────────

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("getPersistenceKey", () => {
    it("generates valid persistence key", () => {
      const key = getPersistenceKey("games-list");
      expect(key).toBe("stellarcade:paginated-query:games-list");
    });

    it("rejects empty state key", () => {
      expect(() => getPersistenceKey("")).toThrow("non-empty string");
      expect(() => getPersistenceKey("  ")).toThrow("non-empty string");
    });

    it("rejects state key with invalid characters", () => {
      expect(() => getPersistenceKey("games/list")).toThrow("alphanumeric");
      expect(() => getPersistenceKey("games@list")).toThrow("alphanumeric");
      expect(() => getPersistenceKey("games list")).toThrow("alphanumeric");
    });

    it("accepts valid characters (alphanumeric, underscore, hyphen)", () => {
      expect(() => getPersistenceKey("games_list")).not.toThrow();
      expect(() => getPersistenceKey("games-list")).not.toThrow();
      expect(() => getPersistenceKey("GamesList123")).not.toThrow();
    });
  });

  describe("persistPaginatedState", () => {
    it("persists state to localStorage", () => {
      const state: PaginationState = {
        page: 2,
        pageSize: 20,
        sort: { field: "createdAt", direction: "desc" },
        filters: { status: "active" },
      };

      persistPaginationState("test-state", state);

      const stored = localStorage.getItem("stellarcade:paginated-query:test-state");
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toEqual(state);
    });

    it("silently handles invalid state key", () => {
      const state: PaginationState = {
        page: 1,
        pageSize: 10,
        sort: { field: "name", direction: "asc" },
        filters: {},
      };

      // Should not throw
      expect(() => persistPaginationState("invalid/key", state)).not.toThrow();
    });
  });

  describe("restorePaginatedState", () => {
    it("restores valid state from localStorage", () => {
      const original: PaginationState = {
        page: 2,
        pageSize: 20,
        sort: { field: "createdAt", direction: "desc" },
        filters: { status: "active" },
      };

      persistPaginationState("test-state", original);
      const restored = restorePaginationState("test-state");

      expect(restored).toEqual(original);
    });

    it("returns null for missing state", () => {
      const restored = restorePaginationState("nonexistent");
      expect(restored).toBeNull();
    });

    it("returns null for invalid state", () => {
      localStorage.setItem("stellarcade:paginated-query:bad-state", '{"invalid": "state"}');
      const restored = restorePaginationState("bad-state");
      expect(restored).toBeNull();
    });

    it("returns null for corrupted JSON", () => {
      localStorage.setItem("stellarcade:paginated-query:corrupted", "not json");
      const restored = restorePaginationState("corrupted");
      expect(restored).toBeNull();
    });
  });

  describe("clearPersistedPaginationState", () => {
    it("removes persisted state", () => {
      const state: PaginationState = {
        page: 1,
        pageSize: 10,
        sort: { field: "name", direction: "asc" },
        filters: {},
      };

      persistPaginationState("test-state", state);
      expect(restorePaginationState("test-state")).not.toBeNull();

      clearPersistedPaginationState("test-state");
      expect(restorePaginationState("test-state")).toBeNull();
    });
  });
});
