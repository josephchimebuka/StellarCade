/**
 * React hook for managing paginated queries with client-side state.
 *
 * Provides a reusable, UI-agnostic pagination interface that manages:
 * - Pagination state (page, pageSize, sort, filters)
 * - Query execution and caching
 * - Loading and error states
 * - Optional local storage persistence
 *
 * The hook delegates actual data fetching to a provided executor function,
 * allowing flexible integration with any backend API or query library.
 *
 * @module hooks/v1/usePaginatedQuery
 *
 * @example
 * ```typescript
 * interface Game {
 *   id: string;
 *   title: string;
 *   createdAt: string;
 * }
 *
 * function GamesPage() {
 *   const query = usePaginatedQuery<Game>({
 *     initialState: {
 *       page: 1,
 *       pageSize: 10,
 *       sort: { field: "createdAt", direction: "desc" },
 *       filters: {},
 *     },
 *     queryExecutor: async (state) => {
 *       const response = await fetch(
 *         `/api/games?page=${state.page}&limit=${state.pageSize}`
 *       );
 *       if (!response.ok) {
 *         return {
 *           success: false,
 *           error: { message: "Failed to load games", code: "FETCH_FAILED" },
 *         };
 *       }
 *       return { success: true, data: await response.json() };
 *     },
 *     persistState: true,
 *     stateKey: "games-pagination",
 *   });
 *
 *   if (query.isLoading) return <div>Loading...</div>;
 *   if (query.isError) return <div>Error: {query.error?.message}</div>;
 *   if (!query.data) return <div>No data</div>;
 *
 *   return (
 *     <div>
 *       <ul>
 *         {query.data.items.map((game) => (
 *           <li key={game.id}>{game.title}</li>
 *         ))}
 *       </ul>
 *       <button onClick={() => query.prevPage()} disabled={!query.data.hasPreviousPage}>
 *         Previous
 *       </button>
 *       <span>{query.data.page} / {query.data.totalPages}</span>
 *       <button onClick={() => query.nextPage()} disabled={!query.data.hasNextPage}>
 *         Next
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type {
  PaginationState,
  PaginatedResult,
  PaginatedQueryOptions,
  UsePaginatedQueryResult,
  LoadingState,
  QueryError,
} from "../../types/pagination";
import { LoadingState as LoadingStateEnum } from "../../types/pagination";
import {
  validatePaginationState,
  clonePaginationState,
  enrichPaginatedResult,
  updatePage,
  updatePageSize,
  updateSort,
  updateFilters,
  clampPage,
  getNextPage,
  getPreviousPage,
  persistPaginationState,
  restorePaginationState,
  clearPersistedPaginationState,
} from "../../utils/v1/usePaginatedQuery";

/**
 * Manages paginated query state and execution.
 *
 * The hook provides a complete pagination interface, including:
 * - State management for page, pageSize, sort, and filters
 * - Query execution with loading and error tracking
 * - Navigation helpers (nextPage, prevPage, setPage)
 * - Optional state persistence to localStorage
 * - Automatic query re-execution on state changes
 *
 * @template T - The type of items in the paginated result.
 *
 * @param options - Configuration options:
 *   - initialState: Required. Initial pagination state.
 *   - queryExecutor: Required. Async function that executes the query.
 *   - persistState: Optional. If true, state is persisted to localStorage.
 *   - stateKey: Optional. Key for localStorage persistence (required if persistState=true).
 *   - dependencies: Optional. Dependency array to trigger re-fetches.
 *
 * @returns UsePaginatedQueryResult with state, data, controls, and helpers.
 *
 * @throws Will throw if queryExecutor is not provided.
 * @throws Will throw if initialState is invalid.
 * @throws Will throw if persistState=true but stateKey is missing or invalid.
 */
export function usePaginatedQuery<T>(
  options: PaginatedQueryOptions<T>
): UsePaginatedQueryResult<T> {
  // ── Input Validation ───────────────────────────────────────────────────────

  if (!options || typeof options !== "object") {
    throw new Error("usePaginatedQuery requires an options object");
  }

  const { queryExecutor, initialState, persistState = false, stateKey, dependencies } = options;

  if (!queryExecutor || typeof queryExecutor !== "function") {
    throw new Error("usePaginatedQuery requires a queryExecutor function");
  }

  if (!initialState) {
    throw new Error("usePaginatedQuery requires initialState");
  }

  const initialValidation = validatePaginationState(initialState);
  if (!initialValidation.valid) {
    throw new Error(
      `Invalid initialState: ${
        initialValidation.valid === false ? initialValidation.error : "unknown error"
      }`
    );
  }

  if (persistState && (!stateKey || typeof stateKey !== "string" || stateKey.trim() === "")) {
    throw new Error("persistState=true requires a non-empty stateKey");
  }

  // ── State Management ───────────────────────────────────────────────────────

  // Current pagination state
  const [state, setState] = useState<PaginationState>(() => {
    // On mount, check if we should restore from persistence
    if (persistState && stateKey) {
      const restored = restorePaginationState(stateKey);
      if (restored) {
        return restored;
      }
    }
    return clonePaginationState(initialState);
  });

  // Current query result (data)
  const [data, setData] = useState<PaginatedResult<T> | null>(null);

  // Loading state
  const [loading, setLoading] = useState<LoadingState>(LoadingStateEnum.IDLE);

  // Error state
  const [error, setError] = useState<QueryError | null>(null);

  // Track if data is stale
  const [isStale, setIsStale] = useState(false);

  // Prevent redundant queries
  const lastStateRef = useRef<PaginationState | null>(null);
  const isExecutingRef = useRef(false);

  // ── Query Execution ───────────────────────────────────────────────────────

  /**
   * Executes the paginated query with the current state.
   * Handles loading state, error state, and data updates.
   * Prevents duplicate requests if the state hasn't changed.
   */
  const executeQuery = useCallback(async (): Promise<void> => {
    // Guard: prevent concurrent executions
    if (isExecutingRef.current) {
      return;
    }

    // Guard: prevent duplicate queries if state unchanged
    if (
      lastStateRef.current &&
      states_equal(lastStateRef.current, state)
    ) {
      return;
    }

    isExecutingRef.current = true;

    try {
      // Determine loading state: initial load vs fetching
      const isInitialLoad = data === null;
      setLoading(isInitialLoad ? LoadingStateEnum.LOADING : LoadingStateEnum.FETCHING);

      // Execute the query
      const result = await queryExecutor(state);

      // Update state based on result
      if (result.success === true) {
        const enriched = enrichPaginatedResult(result.data);
        setData(enriched);
        setError(null);
        setIsStale(result.isStale ?? false);
      } else if (result.success === false) {
        setError(result.error);
        setIsStale(true);
      }

      setLoading(LoadingStateEnum.IDLE);
      lastStateRef.current = clonePaginationState(state);
    } catch (err) {
      // Unexpected error (not caught by executor)
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError({
        message: `Unexpected error: ${errorMessage}`,
        code: "UNEXPECTED_ERROR",
      });
      setIsStale(true);
      setLoading(LoadingStateEnum.IDLE);
    } finally {
      isExecutingRef.current = false;
    }
  }, [state, queryExecutor, data]);

  // ── Effects ────────────────────────────────────────────────────────────

  /**
   * Execute query whenever state changes.
   */
  useEffect(() => {
    executeQuery();
  }, [state, executeQuery]);

  /**
   * Execute query when external dependencies change (if provided).
   */
  useEffect(() => {
    if (dependencies && dependencies.length > 0) {
      executeQuery();
    }
  }, dependencies ?? []);

  /**
   * Persist state to localStorage whenever it changes (if enabled).
   */
  useEffect(() => {
    if (persistState && stateKey) {
      persistPaginationState(stateKey, state);
    }
  }, [state, persistState, stateKey]);

  // ── Navigation Methods ───────────────────────────────────────────────────

  const nextPage = useCallback(async (): Promise<void> => {
    if (!data) return;

    const nextPageNum = getNextPage(state.page, data.totalPages);
    if (nextPageNum !== undefined) {
      setState((prev) => updatePage(prev, nextPageNum));
    }
  }, [state, data]);

  const prevPage = useCallback(async (): Promise<void> => {
    const prevPageNum = getPreviousPage(state.page);
    if (prevPageNum !== undefined) {
      setState((prev) => updatePage(prev, prevPageNum));
    }
  }, [state]);

  const setPage = useCallback(async (newPage: number): Promise<void> => {
    if (!isValidPage(newPage)) {
      return; // silently ignore invalid page numbers
    }

    // Clamp to valid range if we have data
    const clamped = data ? clampPage(newPage, data.totalPages) : newPage;
    if (clamped !== state.page) {
      setState((prev) => updatePage(prev, clamped));
    }
  }, [state, data]);

  const setPageSize = useCallback(async (newPageSize: number): Promise<void> => {
    if (typeof newPageSize !== "number" || !Number.isInteger(newPageSize) || newPageSize <= 0) {
      return; // silently ignore invalid page sizes
    }

    if (newPageSize !== state.pageSize) {
      setState((prev) => updatePageSize(prev, newPageSize));
    }
  }, [state]);

  const setSort = useCallback(
    async (newSort:any): Promise<void> => {
      setState((prev) => updateSort(prev, newSort));
    },
    []
  );

  const setFilters = useCallback(
    async (newFilters:any): Promise<void> => {
      setState((prev) => updateFilters(prev, newFilters));
    },
    []
  );

  const reset = useCallback(async (): Promise<void> => {
    setState(clonePaginationState(initialState));
  }, [initialState]);

  const refetch = useCallback(async (): Promise<void> => {
    // Force re-execution by clearing the ref
    lastStateRef.current = null;
    await executeQuery();
  }, [executeQuery]);

  // ── Computed Values ────────────────────────────────────────────────────────

  const isSuccess = useMemo(() => !error && data !== null, [error, data]);
  const isError = useMemo(() => error !== null, [error]);
  const isLoading = useMemo(
    () => loading === LoadingStateEnum.LOADING || loading === LoadingStateEnum.FETCHING,
    [loading]
  );

  // ── Return Object ──────────────────────────────────────────────────────────

  return {
    // State
    state,
    loading,
    error,
    data,

    // Computed
    isSuccess,
    isError,
    isLoading,
    isStale,

    // Navigation
    nextPage,
    prevPage,
    setPage,
    setPageSize,
    setSort,
    setFilters,
    reset,
    refetch,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Checks if a value is a valid page number.
 */
function isValidPage(page: unknown): boolean {
  return typeof page === "number" && Number.isInteger(page) && page >= 1;
}

/**
 * Deep equality check for pagination states.
 *
 * Used to detect if the state has actually changed, preventing redundant queries.
 */
function states_equal(a: PaginationState, b: PaginationState): boolean {
  return (
    a.page === b.page &&
    a.pageSize === b.pageSize &&
    a.sort.field === b.sort.field &&
    a.sort.direction === b.sort.direction &&
    filters_equal(a.filters, b.filters)
  );
}

/**
 * Deep equality check for filter objects.
 */
function filters_equal(a: any, b: any): boolean {
  const keysA = Object.keys(a || {});
  const keysB = Object.keys(b || {});

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!(key in b)) {
      return false;
    }
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}
