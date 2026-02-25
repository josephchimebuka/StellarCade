import { useState, useCallback, useRef, useEffect } from 'react';
import { ContractReadOptions, ContractReadResult } from '../../types/contracts/read';

export interface UseContractReadProps {
    contractId: string;
    networkUrl?: string; // Optional network guard
}

export function useContractRead<T = any>({ contractId, networkUrl }: UseContractReadProps): ContractReadResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    // Use refs for tracking current polling and avoiding duplicate reads
    const activeReadRef = useRef<{ method: string; params?: any[]; options?: ContractReadOptions } | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isFetchingRef = useRef<boolean>(false);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const executeRead = useCallback(async (
        method: string,
        params?: any[],
        options?: ContractReadOptions
    ): Promise<T | null> => {
        // Dedup: prevent overlapping identical fetch calls
        if (isFetchingRef.current) {
            return data;
        }

        try {
            if (!contractId) {
                throw new Error("Contract ID is required to read from a contract.");
            }
            if (options?.enabled === false) {
                return null;
            }

            isFetchingRef.current = true;
            setLoading(true);
            setError(null);

            // MOCK backend RPC or Soroban direct call here
            // const res = await rpc.simulateTransaction(contractId, method, params);

            // Simulate deterministic response for testing
            const resData = { method, params, result: "mock_read_success" } as unknown as T;

            setData(resData);
            return resData;
        } catch (err: any) {
            const wrappedError = new Error(err.message || `Failed to read ${method} from contract ${contractId}`);
            setError(wrappedError);
            throw wrappedError;
        } finally {
            isFetchingRef.current = false;
            setLoading(false);

            // Setup polling if configured
            if (options?.pollingInterval) {
                clearTimer();
                timerRef.current = setTimeout(() => {
                    if (activeReadRef.current) {
                        void executeRead(
                            activeReadRef.current.method,
                            activeReadRef.current.params,
                            activeReadRef.current.options
                        );
                    }
                }, options.pollingInterval);
            }
        }
    }, [contractId, data, clearTimer]);

    const read = useCallback(async (
        method: string,
        params?: any[],
        options?: ContractReadOptions
    ): Promise<T | null> => {
        activeReadRef.current = { method, params, options };
        return executeRead(method, params, options);
    }, [executeRead]);

    const refetch = useCallback(async (): Promise<void> => {
        if (activeReadRef.current) {
            await executeRead(
                activeReadRef.current.method,
                activeReadRef.current.params,
                activeReadRef.current.options
            );
        } else {
            throw new Error("No active read request to refetch.");
        }
    }, [executeRead]);

    const clear = useCallback(() => {
        setData(null);
        setError(null);
        activeReadRef.current = null;
        clearTimer();
    }, [clearTimer]);

    useEffect(() => {
        return () => {
            clearTimer();
        };
    }, [clearTimer]);

    return {
        data,
        loading,
        error,
        read,
        refetch,
        clear,
    };
}
