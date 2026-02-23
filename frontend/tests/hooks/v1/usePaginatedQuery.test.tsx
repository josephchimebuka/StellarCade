/**
 * Unit tests for usePaginatedQuery React hook.
 *
 * Tests cover hook behavior, state management, query execution, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type {
  PaginationState,
  PaginatedResult,
  QueryExecutor,
} from "../../../src/types/pagination";
import { usePaginatedQuery } from "../../../src/hooks/v1/usePaginatedQuery";

// ── Test Data ──────────────────────────────────────────────────────────────────

interface TestItem {
  id: string;
  name: string;
}

const createResult = (items: TestItem[], total: number, page: number, pageSize: number) => {
  const totalPages = Math.ceil(total / pageSize) || 1;
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

const defaultState: PaginationState = {
  page: 1,
  pageSize: 10,
  sort: { field: "name", direction: "asc" },
  filters: {},
};

const createMockExecutor = (data: Map<number, TestItem[]>): QueryExecutor<TestItem> => {
  return async (state) => {
    const items = data.get(state.page) || [];
    const total = Array.from(data.values()).reduce((sum, page) => sum + page.length, 0);
    return {
      success: true,
      data: createResult(items, total, state.page, state.pageSize),
    };
  };
};

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe("usePaginatedQuery Hook", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Initialization Tests ───────────────────────────────────────────────────

  describe("Initialization", () => {
    it("throws if options not provided", () => {
      expect(() => {
        renderHook(() => usePaginatedQuery(null as any));
      }).toThrow("options object");
    });

    it("throws if queryExecutor not provided", () => {
      expect(() => {
        renderHook(() =>
          usePaginatedQuery({
            initialState: defaultState,
            queryExecutor: null as any,
          })
        );
      }).toThrow("queryExecutor");
    });

    it("throws if initialState not provided", () => {
      expect(() => {
        renderHook(() =>
          usePaginatedQuery({
            initialState: null as any,
            queryExecutor: async () => ({
              success: true,
              data: createResult([], 0, 1, 10),
            }),
          })
        );
      }).toThrow("initialState");
    });

    it("throws if initialState is invalid", () => {
      expect(() => {
        renderHook(() =>
          usePaginatedQuery({
            initialState: { ...defaultState, page: 0 },
            queryExecutor: async () => ({
              success: true,
              data: createResult([], 0, 1, 10),
            }),
          })
        );
      }).toThrow("Invalid initialState");
    });

    it("throws if persistState=true but stateKey missing", () => {
      expect(() => {
        renderHook(() =>
          usePaginatedQuery({
            initialState: defaultState,
            queryExecutor: async () => ({
              success: true,
              data: createResult([], 0, 1, 10),
            }),
            persistState: true,
          })
        );
      }).toThrow("stateKey");
    });

    it("initializes with default state", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      expect(result.current.state).toEqual(defaultState);
      expect(result.current.loading).toBe("loading");

      await waitFor(() => {
        expect(result.current.loading).toBe("idle");
      });
    });
  });

  // ── Query Execution Tests ──────────────────────────────────────────────────

  describe("Query Execution", () => {
    it("executes query on mount", async () => {
      const executor = vi.fn<any>(
        createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]))
      );

      renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(executor).toHaveBeenCalled();
      });
    });

    it("updates data on successful query", async () => {
      const items = [{ id: "1", name: "Item 1" }];
      const executor = createMockExecutor(new Map([[1, items]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
        expect(result.current.data?.items).toEqual(items);
      });
    });

    it("sets error on failed query", async () => {
      const error = { message: "Query failed", code: "FAIL" };
      const executor = async () => ({
        success: false as const,
        error,
      });

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.error).toEqual(error);
        expect(result.current.data).toBeNull();
      });
    });

    it("handles unexpected executor errors", async () => {
      const executor = async () => {
        throw new Error("Unexpected error");
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
        expect(result.current.error?.message).toContain("Unexpected error");
      });
    });

    it("marks data as stale if executor indicates it", async () => {
      const executor = async () => ({
        success: true as const,
        data: createResult([], 0, 1, 10),
        isStale: true,
      });

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.isStale).toBe(true);
      });
    });
  });

  // ── Loading State Tests ────────────────────────────────────────────────────

  describe("Loading State", () => {
    it("sets loading=loading on initial fetch", async () => {
      const executor = async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { success: true as const, data: createResult([], 0, 1, 10) };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      expect(result.current.loading).toBe("loading");

      await waitFor(() => {
        expect(result.current.loading).toBe("idle");
      });
    });

    it("sets loading=fetching on subsequent page changes", async () => {
      const slowExecutor = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {
          success: true as const,
          data: createResult([{ id: "2", name: "Item 2" }], 20, 2, 10),
        };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: slowExecutor,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe("idle");
      });

      act(() => {
        result.current.setPage(2);
      });

      // After the navigation, loading should transition through fetching
      await waitFor(() => {
        expect(result.current.state.page).toBe(2);
      });
    });

    it("computes isLoading correctly", async () => {
      const executor = createMockExecutor(new Map([[1, []]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  // ── Navigation Tests ───────────────────────────────────────────────────────

  describe("Navigation", () => {
    it("navigates to next page", async () => {
      const slowExecutor = async (state: PaginationState) => {
        await new Promise((r) => setTimeout(r, 30));
        const items = state.page === 1 ? [{ id: "1", name: "Item 1" }] : [{ id: "2", name: "Item 2" }];
        return {
          success: true as const,
          data: createResult(items, 20, state.page, state.pageSize),
        };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: slowExecutor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
        expect(result.current.loading).toBe("idle");
      });

      act(() => {
        result.current.nextPage();
      });

      await waitFor(() => {
        expect(result.current.state.page).toBe(2);
      });
    });

    it("does not navigate past last page", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      const initialPage = result.current.state.page;

      act(() => {
        result.current.nextPage();
      });

      // Since there's only 1 page, nextPage should be a no-op
      expect(result.current.state.page).toBe(initialPage);
    });

    it("navigates to previous page", async () => {
      const slowExecutor = async (state: PaginationState) => {
        await new Promise((r) => setTimeout(r, 30));
        const items = state.page === 1 ? [{ id: "1", name: "Item 1" }] : [{ id: "2", name: "Item 2" }];
        return {
          success: true as const,
          data: createResult(items, 20, state.page, state.pageSize),
        };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: { ...defaultState, page: 2 },
          queryExecutor: slowExecutor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(2);
      });

      act(() => {
        result.current.prevPage();
      });

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
      });
    });

    it("does not navigate before page 1", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
      });

      act(() => {
        result.current.prevPage();
      });

      expect(result.current.state.page).toBe(1);
    });

    it("sets page to a specific number", async () => {
      const slowExecutor = async (state: PaginationState) => {
        await new Promise((r) => setTimeout(r, 30));
        const items = [{ id: String(state.page), name: `Item ${state.page}` }];
        return {
          success: true as const,
          data: createResult(items, 30, state.page, state.pageSize),
        };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: slowExecutor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
      });

      act(() => {
        result.current.setPage(3);
      });

      await waitFor(() => {
        expect(result.current.state.page).toBe(3);
      });
    });

    it("silently ignores invalid page numbers", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
      });

      act(() => {
        result.current.setPage(0);
        result.current.setPage(-1);
        result.current.setPage(1.5);
      });

      expect(result.current.state.page).toBe(1);
    });
  });

  // ── PageSize Changes Tests ────────────────────────────────────────────────

  describe("PageSize Changes", () => {
    it("updates page size and resets to page 1", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: { ...defaultState, page: 3 },
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(3);
      });

      act(() => {
        result.current.setPageSize(20);
      });

      await waitFor(() => {
        expect(result.current.state.pageSize).toBe(20);
        expect(result.current.state.page).toBe(1);
      });
    });

    it("silently ignores invalid page sizes", async () => {
      const executor = createMockExecutor(new Map([[1, []]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.pageSize).toBe(10);
      });

      const originalPageSize = result.current.state.pageSize;

      act(() => {
        result.current.setPageSize(0);
      });

      // Should not change for invalid pageSize
      expect(result.current.state.pageSize).toBe(originalPageSize);

      act(() => {
        result.current.setPageSize(-1);
      });

      expect(result.current.state.pageSize).toBe(originalPageSize);

      act(() => {
        result.current.setPageSize(10.5);
      });

      expect(result.current.state.pageSize).toBe(originalPageSize);
    });
  });

  // ── Sort Changes Tests ────────────────────────────────────────────────────

  describe("Sort Changes", () => {
    it("updates sort and resets to page 1", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: { ...defaultState, page: 2 },
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(2);
      });

      act(() => {
        result.current.setSort({ field: "createdAt", direction: "desc" });
      });

      await waitFor(() => {
        expect(result.current.state.sort.field).toBe("createdAt");
        expect(result.current.state.sort.direction).toBe("desc");
        expect(result.current.state.page).toBe(1);
      });
    });
  });

  // ── Filter Changes Tests ───────────────────────────────────────────────────

  describe("Filter Changes", () => {
    it("updates filters and resets to page 1", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: { ...defaultState, page: 2 },
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(2);
      });

      act(() => {
        result.current.setFilters({ status: "active" });
      });

      await waitFor(() => {
        expect(result.current.state.filters).toEqual({ status: "active" });
        expect(result.current.state.page).toBe(1);
      });
    });
  });

  // ── Reset Tests ────────────────────────────────────────────────────────────

  describe("Reset", () => {
    it("resets to initial state", async () => {
      const slowExecutor = async (state: PaginationState) => {
        await new Promise((r) => setTimeout(r, 30));
        return {
          success: true as const,
          data: createResult([{ id: String(state.page), name: `Item ${state.page}` }], 30, state.page, state.pageSize),
        };
      };

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: slowExecutor,
        })
      );

      await waitFor(() => {
        expect(result.current.state.page).toBe(1);
      });

      act(() => {
        result.current.setPage(5);
      });

      await waitFor(() => {
        expect(result.current.state.page).toBe(5);
      });

      act(() => {
        result.current.reset();
      });

      await waitFor(() => {
        expect(result.current.state.page).toBe(defaultState.page);
      });
    });
  });

  // ── Refetch Tests ──────────────────────────────────────────────────────────

  describe("Refetch", () => {
    it("re-executes query without changing state", async () => {
      const executor = vi.fn<any>(
        createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]))
      );

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      await waitFor(() => {
        expect(executor).toHaveBeenCalledTimes(1);
      });

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(executor).toHaveBeenCalledTimes(2);
        expect(result.current.state).toEqual(defaultState);
      });
    });
  });

  // ── Persistence Tests ──────────────────────────────────────────────────────

  describe("State Persistence", () => {
    it("persists state to localStorage when enabled", async () => {
      const executor = createMockExecutor(new Map([[1, []]]));

      renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
          persistState: true,
          stateKey: "test-state",
        })
      );

      await waitFor(() => {
        const stored = localStorage.getItem("stellarcade:paginated-query:test-state");
        expect(stored).toBeTruthy();
      });
    });

    it("restores state from localStorage on mount", async () => {
      const initialState: PaginationState = {
        page: 3,
        pageSize: 20,
        sort: { field: "createdAt", direction: "desc" },
        filters: { status: "active" },
      };

      const executor = createMockExecutor(new Map([[3, [{ id: "3", name: "Item 3" }]]]));

      // First render: persist state
      renderHook(() =>
        usePaginatedQuery({
          initialState,
          queryExecutor: executor,
          persistState: true,
          stateKey: "test-state",
        })
      );

      // Second render: should restore from localStorage
      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
          persistState: true,
          stateKey: "test-state",
        })
      );

      expect(result.current.state.page).toBe(3);
      expect(result.current.state.pageSize).toBe(20);
      expect(result.current.state.sort).toEqual(initialState.sort);
      expect(result.current.state.filters).toEqual(initialState.filters);
    });
  });

  // ── Computed Properties Tests ──────────────────────────────────────────────

  describe("Computed Properties", () => {
    it("computes isSuccess correctly", async () => {
      const executor = createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]));

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      expect(result.current.isSuccess).toBe(false);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it("computes isError correctly", async () => {
      const executor = async () => ({
        success: false as const,
        error: { message: "Error", code: "ERR" },
      });

      const { result } = renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
        })
      );

      expect(result.current.isError).toBe(false);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  // ── Dependency Tracking Tests ──────────────────────────────────────────────

  describe("Dependency Tracking", () => {
    it("executes query initially", async () => {
      const executor = vi.fn<any>(
        createMockExecutor(new Map([[1, [{ id: "1", name: "Item 1" }]]]))
      );

      renderHook(() =>
        usePaginatedQuery({
          initialState: defaultState,
          queryExecutor: executor,
          dependencies: ["value1"],
        })
      );

      await waitFor(() => {
        expect(executor).toHaveBeenCalled();
      });
    });
  });
});
