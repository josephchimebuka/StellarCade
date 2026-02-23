/**
 * Utility functions for paginated queries.
 *
 * Provides core pagination logic: state validation, metrics calculation,
 * and safe state transitions. All functions are pure and deterministic.
 *
 * @module utils/v1/usePaginatedQuery
 */

import type {
  PaginationState,
  PaginatedResult,
  PaginationMetrics,
  ValidationResult,
  SortSpec,
  Filters,
} from "../../types/pagination";

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates that a page number is valid (>= 1).
 *
 * @param page - Page number to validate.
 * @returns true if page >= 1, false otherwise.
 */
export function isValidPage(page: unknown): boolean {
  return typeof page === "number" && Number.isInteger(page) && page >= 1;
}

/**
 * Validates that a page size is valid (> 0).
 *
 * @param pageSize - Page size to validate.
 * @returns true if pageSize > 0 and is an integer, false otherwise.
 */
export function isValidPageSize(pageSize: unknown): boolean {
  return typeof pageSize === "number" && Number.isInteger(pageSize) && pageSize > 0;
}

/**
 * Validates a complete PaginationState object.
 *
 * Checks:
 * - page >= 1
 * - pageSize > 0
 * - sort.field is a non-empty string
 * - sort.direction is one of: "asc", "desc"
 * - filters is a plain object (or null/undefined)
 *
 * @param state - State to validate.
 * @returns { valid: true } if all checks pass, or { valid: false; error: string } otherwise.
 */
export function validatePaginationState(state: PaginationState): ValidationResult {
  if (!state) {
    return { valid: false, error: "Pagination state is required" };
  }

  if (!isValidPage(state.page)) {
    return { valid: false, error: `Invalid page number: ${state.page}. Must be an integer >= 1.` };
  }

  if (!isValidPageSize(state.pageSize)) {
    return { valid: false, error: `Invalid page size: ${state.pageSize}. Must be an integer > 0.` };
  }

  if (!state.sort || typeof state.sort !== "object") {
    return { valid: false, error: "Sort specification is required and must be an object" };
  }

  if (typeof state.sort.field !== "string" || state.sort.field.trim() === "") {
    return { valid: false, error: "Sort field must be a non-empty string" };
  }

  if (state.sort.direction !== "asc" && state.sort.direction !== "desc") {
    return {
      valid: false,
      error: `Invalid sort direction: ${state.sort.direction}. Must be "asc" or "desc".`,
    };
  }

  if (state.filters && typeof state.filters !== "object") {
    return { valid: false, error: "Filters must be a plain object" };
  }

  return { valid: true };
}

/**
 * Deep-clones a PaginationState safely.
 *
 * Creates a new object with the same structure, preventing accidental mutations
 * to the original or shared references in nested objects.
 *
 * @param state - State to clone.
 * @returns A new PaginationState object with deep copies of nested objects.
 */
export function clonePaginationState(state: PaginationState): PaginationState {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: {
      field: state.sort.field,
      direction: state.sort.direction,
    },
    filters: state.filters ? { ...state.filters } : {},
  };
}

// ── Metrics Calculation ────────────────────────────────────────────────────────

/**
 * Calculates pagination metrics from current state and result.
 *
 * Derives:
 * - totalPages: Math.ceil(total / pageSize) or 0 if total <= 0
 * - hasNextPage: page < totalPages
 * - hasPreviousPage: page > 1
 * - startIndex: (page - 1) * pageSize (0-indexed offset)
 * - endIndex: startIndex + items.length
 *
 * @param total - Total number of items (from query result).
 * @param pageSize - Current page size.
 * @param page - Current page number.
 * @returns Computed pagination metrics.
 */
export function calculatePaginationMetrics(
  total: number,
  pageSize: number,
  page: number
): PaginationMetrics {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + Math.min(pageSize, total - startIndex);

  return {
    totalPages,
    hasNextPage,
    hasPreviousPage,
    startIndex,
    endIndex,
  };
}

/**
 * Enriches a paginated result with computed fields (totalPages, hasNextPage, etc.).
 *
 * Adds fields to the result object to make navigation logic easier.
 *
 * @template T - Item type.
 * @param result - Raw paginated result from query executor.
 * @returns Result with computed fields added.
 */
export function enrichPaginatedResult<T>(
  result: Omit<PaginatedResult<T>, "totalPages" | "hasNextPage" | "hasPreviousPage">
): PaginatedResult<T> {
  const metrics = calculatePaginationMetrics(result.total, result.pageSize, result.page);
  return {
    ...result,
    totalPages: metrics.totalPages,
    hasNextPage: metrics.hasNextPage,
    hasPreviousPage: metrics.hasPreviousPage,
  };
}

// ── State Transitions ──────────────────────────────────────────────────────────

/**
 * Returns the next page number, if available.
 *
 * @param currentPage - Current page number.
 * @param totalPages - Total number of pages.
 * @returns Next page number, or undefined if already on the last page.
 */
export function getNextPage(currentPage: number, totalPages: number): number | undefined {
  if (currentPage < totalPages) {
    return currentPage + 1;
  }
  return undefined;
}

/**
 * Returns the previous page number, if available.
 *
 * @param currentPage - Current page number.
 * @returns Previous page number, or undefined if on page 1.
 */
export function getPreviousPage(currentPage: number): number | undefined {
  if (currentPage > 1) {
    return currentPage - 1;
  }
  return undefined;
}

/**
 * Clamps a page number to the valid range [1, totalPages].
 *
 * @param page - Page number to clamp.
 * @param totalPages - Total number of pages.
 * @returns Clamped page number.
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.max(1, Math.min(page, totalPages));
}

/**
 * Creates a new pagination state with an updated page, preserving other fields.
 *
 * @param state - Current pagination state.
 * @param newPage - New page number.
 * @returns New state with updated page, or the same state if page is unchanged.
 */
export function updatePage(state: PaginationState, newPage: number): PaginationState {
  if (newPage === state.page) {
    return state;
  }
  return {
    ...state,
    page: newPage,
  };
}

/**
 * Creates a new pagination state with an updated page size, resetting to page 1.
 *
 * @param state - Current pagination state.
 * @param newPageSize - New page size.
 * @returns New state with updated pageSize and page=1.
 */
export function updatePageSize(state: PaginationState, newPageSize: number): PaginationState {
  if (newPageSize === state.pageSize) {
    return state;
  }
  return {
    ...state,
    pageSize: newPageSize,
    page: 1,
  };
}

/**
 * Creates a new pagination state with an updated sort, resetting to page 1.
 *
 * @param state - Current pagination state.
 * @param newSort - New sort specification.
 * @returns New state with updated sort and page=1.
 */
export function updateSort(state: PaginationState, newSort: SortSpec): PaginationState {
  if (newSort.field === state.sort.field && newSort.direction === state.sort.direction) {
    return state;
  }
  return {
    ...state,
    sort: newSort,
    page: 1,
  };
}

/**
 * Creates a new pagination state with updated filters, resetting to page 1.
 *
 * @param state - Current pagination state.
 * @param newFilters - New filters object.
 * @returns New state with updated filters and page=1.
 */
export function updateFilters(state: PaginationState, newFilters: Filters): PaginationState {
  // Quick check: if filters are the same object, no change
  if (newFilters === state.filters) {
    return state;
  }

  // Deep comparison to avoid unnecessary state updates
  if (filters_equal(newFilters, state.filters)) {
    return state;
  }

  return {
    ...state,
    filters: { ...newFilters },
    page: 1,
  };
}

/**
 * Deep equality check for filter objects.
 *
 * Compares all keys and values recursively.
 * Returns true if objects are equivalent.
 *
 * @param a - First object.
 * @param b - Second object.
 * @returns true if equal, false otherwise.
 */
function filters_equal(a: Filters, b: Filters): boolean {
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

// ── Local Storage Persistence ─────────────────────────────────────────────────

/**
 * Generates a localStorage key for paginated query state.
 *
 * @param stateKey - Application-specific state key.
 * @returns Prefixed localStorage key.
 */
export function getPersistenceKey(stateKey: string): string {
  // Validate that the state key is safe for localStorage
  if (!stateKey || typeof stateKey !== "string" || stateKey.trim() === "") {
    throw new Error("State key must be a non-empty string");
  }
  // Ensure the key is URL-safe and doesn't contain special characters that could break localStorage
  if (!/^[a-zA-Z0-9_-]+$/.test(stateKey)) {
    throw new Error("State key must only contain alphanumeric characters, underscores, and hyphens");
  }
  return `stellarcade:paginated-query:${stateKey}`;
}

/**
 * Persists pagination state to localStorage.
 *
 * Serializes the state as JSON. If localStorage is unavailable or quota is exceeded,
 * the error is swallowed silently (non-critical feature).
 *
 * @param stateKey - Application-specific state key.
 * @param state - State to persist.
 */
export function persistPaginationState(stateKey: string, state: PaginationState): void {
  try {
    const key = getPersistenceKey(stateKey);
    const serialized = JSON.stringify(state);
    localStorage.setItem(key, serialized);
  } catch {
    // localStorage unavailable, quota exceeded, or key validation failed
    // silently ignore; persistence is non-critical
  }
}

/**
 * Restores pagination state from localStorage.
 *
 * Deserializes the JSON state and validates it.
 * Returns null if the key doesn't exist, deserialization fails, or validation fails.
 *
 * @param stateKey - Application-specific state key.
 * @returns Restored state, or null if not found or invalid.
 */
export function restorePaginationState(stateKey: string): PaginationState | null {
  try {
    const key = getPersistenceKey(stateKey);
    const serialized = localStorage.getItem(key);

    if (!serialized) {
      return null;
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (!isPaginationState(parsed)) {
      return null;
    }

    const validation = validatePaginationState(parsed);
    if (!validation.valid) {
      return null;
    }

    return parsed;
  } catch {
    // Deserialization or validation failed
    return null;
  }
}

/**
 * Type guard to check if an unknown value is a valid PaginationState.
 *
 * @param value - Value to check.
 * @returns true if value matches the PaginationState shape.
 */
function isPaginationState(value: unknown): value is PaginationState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const isValid: boolean =
    typeof obj.page === "number" &&
    typeof obj.pageSize === "number" &&
    typeof obj.sort === "object" &&
    obj.sort !== null &&
    typeof (obj.sort as Record<string, unknown>).field === "string" &&
    typeof (obj.sort as Record<string, unknown>).direction === "string" &&
    (obj.filters === undefined || obj.filters === null || typeof obj.filters === "object");

  return isValid;
}

/**
 * Clears persisted pagination state from localStorage.
 *
 * @param stateKey - Application-specific state key.
 */
export function clearPersistedPaginationState(stateKey: string): void {
  try {
    const key = getPersistenceKey(stateKey);
    localStorage.removeItem(key);
  } catch {
    // localStorage unavailable or key validation failed
    // silently ignore
  }
}
