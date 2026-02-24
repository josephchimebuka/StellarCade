import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCoinFlipContract } from '../../../src/hooks/v1/useCoinFlipContract';
import { CoinFlipSide, CoinFlipGameState } from '../../../src/types/contracts/coinFlip';

describe('useCoinFlipContract', () => {

    it('should format default states correctly', () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: 'CC_COIN_FLIP' })
        );

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('should prevent places without contract ID', async () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: '', walletAddress: 'GC_WALLET' })
        );

        await act(async () => {
            await expect(result.current.placeBet('10', CoinFlipSide.Heads)).rejects.toThrow('Contract ID is required');
        });

        expect(result.current.error?.message).toContain('Contract ID is required');
        expect(result.current.loading).toBe(false);
    });

    it('should prevent placing bets without wallet address setup', async () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: 'CC_COIN_FLIP', walletAddress: '' })
        );

        await act(async () => {
            await expect(result.current.placeBet('10', CoinFlipSide.Heads)).rejects.toThrow('Wallet must be connected');
        });

        expect(result.current.error?.message).toContain('Wallet must be connected');
    });

    it('should successfully simulate a bet placement resolving deterministic game state', async () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: 'CC_COIN_FLIP', walletAddress: 'GC_WALLET' })
        );

        let gameId;
        await act(async () => {
            gameId = await result.current.placeBet('10', CoinFlipSide.Heads);
        });

        expect(gameId).toBeTruthy();
        expect(result.current.error).toBeNull();
    });

    it('should prevent resolve parameters validation errors', async () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: 'CC_COIN_FLIP', walletAddress: 'GC_WALLET' })
        );

        await act(async () => {
            await expect(result.current.resolveBet('')).rejects.toThrow('Invalid game ID');
        });

        expect(result.current.error?.message).toContain('Invalid game ID');
    });

    it('should successfully simulate resolution cycle logic', async () => {
        const { result } = renderHook(() =>
            useCoinFlipContract({ contractId: 'CC_COIN_FLIP', walletAddress: 'GC_WALLET' })
        );

        let mappedState;
        await act(async () => {
            mappedState = await result.current.resolveBet('1234');
        });

        expect(result.current.error).toBeNull();
        expect(mappedState?.id).toBe('1234');
        expect(mappedState?.status).toBe(CoinFlipGameState.Resolved);
    });
});
