import { useState, useCallback } from 'react';
import { PrizePoolState, ReservePayload, PayoutPayload } from '../../types/contracts/prizePool';

export interface UsePrizePoolContractProps {
    contractId: string;
    walletAddress?: string;
}

export function usePrizePoolContract({ contractId, walletAddress }: UsePrizePoolContractProps) {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    const getPoolState = useCallback(async (): Promise<PrizePoolState | null> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) {
                throw new Error("Contract ID is required.");
            }

            // MOCK fetching metadata from backend caching / block RPC directly
            // In a real scenario, this would rely on useContractRead mapping
            return {
                balance: '10000',
                totalReserved: '500',
                admin: 'GADMIN_MOCK'
            };
        } catch (err: any) {
            setError(new Error(err.message || "Failed to fetch pool state"));
            return null;
        } finally {
            setLoading(false);
        }
    }, [contractId]);

    const reserveFunds = useCallback(async ({ gameId, amount }: ReservePayload): Promise<PrizePoolState> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) throw new Error("Contract ID is required.");
            if (!walletAddress) throw new Error("Wallet must be connected to reserve funds.");
            if (!gameId) throw new Error("Invalid game ID.");
            if (!amount || parseFloat(amount) <= 0) throw new Error("Invalid amount.");

            // MOCK reserve mutation deterministic bounds
            return {
                balance: '10000',
                totalReserved: (500 + parseFloat(amount)).toString(),
                admin: 'GADMIN_MOCK'
            };
        } catch (err: any) {
            const wrappedError = new Error(err.message || "Failed to reserve funds");
            setError(wrappedError);
            throw wrappedError;
        } finally {
            setLoading(false);
        }
    }, [contractId, walletAddress]);

    const processPayout = useCallback(async ({ gameId, playerAddress, amount }: PayoutPayload): Promise<PrizePoolState> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) throw new Error("Contract ID is required.");
            if (!walletAddress) throw new Error("Wallet must be connected to process payout.");
            if (!gameId) throw new Error("Invalid game ID.");
            if (!playerAddress) throw new Error("Invalid player address.");
            if (!amount || parseFloat(amount) <= 0) throw new Error("Invalid amount.");

            const parsedAmount = parseFloat(amount);
            const newTotal = 500 - parsedAmount;
            const newBalance = 10000 - parsedAmount;

            // MOCK payout mutation resolving updated constraints
            return {
                balance: newBalance.toString(),
                totalReserved: newTotal.toString(),
                admin: 'GADMIN_MOCK'
            };
        } catch (err: any) {
            const wrappedError = new Error(err.message || "Failed to process payout");
            setError(wrappedError);
            throw wrappedError;
        } finally {
            setLoading(false);
        }
    }, [contractId, walletAddress]);

    return {
        getPoolState,
        reserveFunds,
        processPayout,
        loading,
        error,
        clearError: () => setError(null)
    };
}
