import { useState, useCallback, useRef } from 'react';
import { RngRequestOptions, RngRequestResult, RngRequestStatus } from '../../types/contracts/rng';

export interface UseRngContractProps {
    contractId: string;
    walletAddress?: string;
    defaultPollInterval?: number;
}

export function useRngContract({ contractId, walletAddress, defaultPollInterval = 3000 }: UseRngContractProps) {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    // In-memory cache tracking requests locally
    const requestsRef = useRef<Map<string, RngRequestResult>>(new Map());

    const requestRandomNumber = useCallback(async (options?: RngRequestOptions): Promise<string> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) {
                throw new Error("Contract ID is required to request RNG.");
            }
            if (!walletAddress) {
                throw new Error("Wallet must be connected to request RNG.");
            }
            if (options) {
                if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
                    throw new Error("Minimum value cannot be greater than maximum value.");
                }
            }

            // MOCK network simulation for deterministic cross-contract interaction
            const requestId = `RNG_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            const newRequest: RngRequestResult = {
                requestId,
                status: RngRequestStatus.Pending,
                requestedAt: Date.now(),
            };

            requestsRef.current.set(requestId, newRequest);

            return requestId;
        } catch (err: any) {
            const wrappedError = new Error(err.message || "Failed to make RNG request");
            setError(wrappedError);
            throw wrappedError;
        } finally {
            setLoading(false);
        }
    }, [contractId, walletAddress]);

    const getRequestResult = useCallback(async (requestId: string): Promise<RngRequestResult | null> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) throw new Error("Contract ID is required.");
            if (!requestId) throw new Error("Invalid RNG request ID.");

            const cached = requestsRef.current.get(requestId);

            // MOCK fetching metadata from backend caching / block RPC directly
            // Simulate fulfillment dynamically if pending
            if (cached && cached.status === RngRequestStatus.Pending) {
                const fulfilled: RngRequestResult = {
                    ...cached,
                    status: RngRequestStatus.Fulfilled,
                    result: Math.floor(Math.random() * 100), // Random mock output
                    fulfilledAt: Date.now()
                };
                requestsRef.current.set(requestId, fulfilled);
                return fulfilled;
            }

            // Return historical lookup safely
            if (cached) return cached;

            // MOCK fallback for untracked requests
            return {
                requestId,
                status: RngRequestStatus.Fulfilled,
                result: 42,
                requestedAt: Date.now(),
                fulfilledAt: Date.now()
            };
        } catch (err: any) {
            setError(new Error(err.message || "Failed to fetch RNG result"));
            return null;
        } finally {
            setLoading(false);
        }
    }, [contractId]);

    return {
        requestRandomNumber,
        getRequestResult,
        loading,
        error,
        clearError: () => setError(null)
    };
}
