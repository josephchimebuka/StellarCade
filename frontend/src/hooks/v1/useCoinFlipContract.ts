import { useState, useCallback } from 'react';
import { CoinFlipSide, CoinFlipGame, CoinFlipGameState } from '../../types/contracts/coinFlip';

export interface UseCoinFlipContractProps {
    contractId: string;
    walletAddress?: string;
}

export function useCoinFlipContract({ contractId, walletAddress }: UseCoinFlipContractProps) {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    const placeBet = useCallback(async (wagerAmount: string, side: CoinFlipSide): Promise<string> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) {
                throw new Error("Contract ID is required.");
            }
            if (!walletAddress) {
                throw new Error("Wallet must be connected to place a bet.");
            }
            if (!wagerAmount || parseFloat(wagerAmount) <= 0) {
                throw new Error("Invalid wager amount.");
            }

            // Simulate ID generation mapping deterministic contract execution
            const gameId = Date.now().toString();

            return gameId;
        } catch (err: any) {
            const wrappedError = new Error(err.message || "Failed to place bet");
            setError(wrappedError);
            throw wrappedError;
        } finally {
            setLoading(false);
        }
    }, [contractId, walletAddress]);

    const resolveBet = useCallback(async (gameId: string): Promise<CoinFlipGame> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) throw new Error("Contract ID is required.");
            if (!walletAddress) throw new Error("Wallet must be connected to resolve a bet.");
            if (!gameId) throw new Error("Invalid game ID.");

            // MOCK mapped logic resolving contract execution natively
            return {
                id: gameId,
                wager: "100",
                side: CoinFlipSide.Heads,
                status: CoinFlipGameState.Resolved,
                winner: walletAddress,
                settledAt: Date.now()
            };
        } catch (err: any) {
            const wrappedError = new Error(err.message || "Failed to resolve bet");
            setError(wrappedError);
            throw wrappedError;
        } finally {
            setLoading(false);
        }
    }, [contractId, walletAddress]);

    const getGame = useCallback(async (gameId: string): Promise<CoinFlipGame | null> => {
        setLoading(true);
        setError(null);
        try {
            if (!contractId) throw new Error("Contract ID is required.");
            if (!gameId) throw new Error("Invalid game ID.");

            // MOCK fetching metadata from backend caching / block RPC directly
            return {
                id: gameId,
                wager: "100",
                side: CoinFlipSide.Heads,
                status: CoinFlipGameState.Placed
            };
        } catch (err: any) {
            setError(new Error(err.message || "Failed to fetch game"));
            return null;
        } finally {
            setLoading(false);
        }
    }, [contractId]);

    return {
        placeBet,
        resolveBet,
        getGame,
        loading,
        error,
        clearError: () => setError(null)
    };
}
