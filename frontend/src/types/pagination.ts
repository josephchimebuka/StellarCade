/**
 * Type definitions for pagination and paginated queries.
 *
 * Provides structured types for managing pagination state, sort order,
 * filtering, and query execution in a type-safe manner.
 *
 * @module types/pagination
 */

// ── Pagination State Types ─────────────────────────────────────────────────────

/**
 * Enumeration of valid sort directions.
 */
export const SortDirection = {
  ASC: "asc",
  DESC: "desc",
} as const;

export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

/**
 * Describes a sort order for a paginated query.
 * The field being sorted depends on context (e.g., "createdAt", "score", "name").
 */
export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/**
 * Mutable filter object passed to query executor.
 * Structure is application-specific; filters are opaque to the hook.
 */
export type Filters = Record<string, unknown>;

/**
 * Core pagination state: page number, page size, sort order, and filters.
 *
 * Page numbering is 1-indexed (page 1 is the first page).
 */
export interface PaginationState {
  /**
   * Current page number (1-indexed).
   * Must be >= 1 when used in queries.
   */
  page: number;

  /**
   * Number of items per page.
   * Must be > 0 when used in queries.
   */
  pageSize: number;

  /**
   * Active sort specification.
   * Defines field name and sort direction.
   */
  sort: SortSpec;

  /**
   * Application-specific filters applied to the query.
   * Structure depends on the query executor.
   */
  filters: Filters;
}

/**
 * Result of a single page fetch operation.
 *
 * @template T The shape of items returned from the query.
 */
export interface PaginatedResult<T> {
  /**
   * Array of items for this page.
   */
  items: T[];

  /**
   * Total number of items matching the current filters.
   * Used to calculate whether there is a next page.
   */
  total: number;

  /**
   * Current page number that was requested.
   * Allows verification of which page was fetched.
   */
  page: number;

  /**
   * Page size that was requested.
   */
  pageSize: number;

  /**
   * Computed: Total number of pages available (rounded up from total/pageSize).
   * If total <= 0, this is 0.
   */
  totalPages: number;

  /**
   * Computed: Whether there is a next page.
   * True if page < totalPages.
   */
  hasNextPage: boolean;

  /**
   * Computed: Whether there is a previous page.
   * True if page > 1.
   */
  hasPreviousPage: boolean;
}

/**
 * Loading state for a paginated query.
 *
 * Distinguishes between initial load and subsequent page fetches.
 */
export const LoadingState = {
  /** No fetch in progress. */
  IDLE: "idle",
  /** Initial data is being loaded (page 1). */
  LOADING: "loading",
  /** Fetching a new page while existing data is displayed. */
  FETCHING: "fetching",
} as const;

export type LoadingState = (typeof LoadingState)[keyof typeof LoadingState];

/**
 * Error state for a failed query.
 */
export interface QueryError {
  /**
   * Human-readable error message.
   */
  message: string;

  /**
   * Machine-readable error code.
   * Allows callers to handle specific error types.
   */
  code: string;

  /**
   * Optional additional context about the error.
   */
  context?: Record<string, unknown>;
}

/**
 * Result of executing a paginated query.
 *
 * Discriminated union: either data is present (with possible stale markers)
 * or an error is present.
 *
 * @template T The shape of items in the paginated result.
 */
export type QueryExecutionResult<T> =
  | {
      success: true;
      data: PaginatedResult<T>;
      /**
       * Set to true if the data was served from cache or is potentially stale.
       * The hook may display a refresh indicator or disable navigation.
       */
      isStale?: boolean;
    }
  | {
      success: false;
      error: QueryError;
    };

// ── Query Executor and Options ─────────────────────────────────────────────────

/**
 * Type signature for a function that executes a paginated query.
 *
 * The executor is responsible for:
 * 1. Validating pagination state (e.g., page >= 1, pageSize > 0)
 * 2. Executing the query with the provided parameters
 * 3. Returning a promise that resolves to the paginated result
 * 4. Returning or throwing a QueryError on failure
 *
 * The hook does not retry or cache at the hook level; those concerns
 * are delegated to the executor or an outer query library.
 *
 * @template T The shape of items in the result.
 *
 * @example
 * ```typescript
 * const fetchGames: QueryExecutor<Game> = async (state) => {
 *   const response = await fetch(
 *     `/api/games?page=${state.page}&pageSize=${state.pageSize}` +
 *     `&sort=${state.sort.field}&order=${state.sort.direction}` +
 *     filterParams(state.filters)
 *   );
 *   if (!response.ok) {
 *     throw {
 *       success: false,
 *       error: {
 *         message: "Failed to fetch games",
 *         code: "FETCH_GAMES_FAILED",
 *       },
 *     };
 *   }
 *   return response.json();
 * };
 * ```
 */
export type QueryExecutor<T> = (
  state: PaginationState
) => Promise<QueryExecutionResult<T>>;

/**
 * Configuration options for usePaginatedQuery hook.
 *
 * @template T The shape of items in the paginated result.
 */
export interface PaginatedQueryOptions<T = unknown> {
  /**
   * Initial pagination state.
   * All fields are required and will be validated by the hook.
   */
  initialState: PaginationState;

  /**
   * Executor function that performs the actual query.
   * Called whenever pagination state changes (page, pageSize, sort, filters).
   */
  queryExecutor: QueryExecutor<T>;

  /**
   * If true, pagination state is persisted to localStorage and restored on mount.
   *
   * State is stored under key:
   * `stellarcade:paginated-query:${stateKey}`
   *
   * @default false
   */
  persistState?: boolean;

  /**
   * Unique key for persisting state (used if persistState=true).
   * If not provided, the feature is disabled even if persistState=true.
   *
   * Must be a valid localStorage key (no slashes or special characters).
   */
  stateKey?: string;

  /**
   * Optional dependency array for the hook.
   * If provided and any dependency changes, the hook will re-execute the query.
   *
   * Use this to trigger refetches when external data dependencies change.
   *
   * @default undefined (no dependency tracking)
   */
  dependencies?: unknown[];
}

/**
 * Configuration for persisting pagination state.
 */
export interface PersistenceConfig {
  enabled: boolean;
  key: string;
}

// ── Hook Return Type ───────────────────────────────────────────────────────────

/**
 * Return value of the usePaginatedQuery hook.
 *
 * Provides current state, data, loading/error status, and control methods.
 *
 * @template T The shape of items in the paginated result.
 */
export interface UsePaginatedQueryResult<T> {
  // ── State ──
  /**
   * Current pagination state (page, pageSize, sort, filters).
   */
  state: PaginationState;

  /**
   * Current loading state: "idle", "loading", or "fetching".
   */
  loading: LoadingState;

  /**
   * Current error, if any. Null if the last fetch succeeded.
   * Persists until a new query is executed.
   */
  error: QueryError | null;

  /**
   * Current page of data. Null if no successful query has been executed.
   */
  data: PaginatedResult<T> | null;

  /**
   * Computed: true if data is available and no error is present.
   */
  isSuccess: boolean;

  /**
   * Computed: true if an error is currently set.
   */
  isError: boolean;

  /**
   * Computed: true if loading is in progress.
   */
  isLoading: boolean;

  /**
   * Computed: true if the data is stale (e.g., served from cache).
   */
  isStale: boolean;

  // ── Navigation ──
  /**
   * Navigate to the next page (if available).
   * No-op if already on the last page.
   * Resets error state and sets loading to "fetching".
   */
  nextPage: () => Promise<void>;

  /**
   * Navigate to the previous page (if available).
   * No-op if already on page 1.
   * Resets error state and sets loading to "fetching".
   */
  prevPage: () => Promise<void>;

  /**
   * Navigate directly to a specific page number (1-indexed).
   *
   * If the page number is invalid (< 1 or > totalPages),
   * the hook will not change state and returns a promise
   * that resolves without effect.
   *
   * Resets error state and sets loading to "fetching" if page changed.
   */
  setPage: (page: number) => Promise<void>;

  /**
   * Change the page size and reset to page 1.
   * Resets error state and triggers a fetch.
   */
  setPageSize: (pageSize: number) => Promise<void>;

  /**
   * Update the sort specification.
   * Resets to page 1 and triggers a fetch.
   */
  setSort: (sort: SortSpec) => Promise<void>;

  /**
   * Update the filters object.
   * Resets to page 1 and triggers a fetch.
   */
  setFilters: (filters: Filters) => Promise<void>;

  /**
   * Reset all state to the initialState and re-execute the query.
   */
  reset: () => Promise<void>;

  /**
   * Manually trigger a re-fetch of the current page.
   * Does not change page, pageSize, sort, or filters.
   */
  refetch: () => Promise<void>;
}

// ── Validation and Utility Types ───────────────────────────────────────────────

/**
 * Result of validating pagination state.
 *
 * Validates that page >= 1, pageSize > 0, etc.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Computed pagination metrics.
 *
 * Used internally to derive values like totalPages and hasNextPage.
 */
export interface PaginationMetrics {
  /**
   * Total number of pages (computed from total / pageSize, rounded up).
   */
  totalPages: number;

  /**
   * Whether there is a next page.
   */
  hasNextPage: boolean;

  /**
   * Whether there is a previous page.
   */
  hasPreviousPage: boolean;

  /**
   * Start index of the first item on this page (0-indexed).
   * Useful for offset-based APIs.
   */
  startIndex: number;

  /**
   * End index of the last item on this page (0-indexed, exclusive).
   */
  endIndex: number;
}
